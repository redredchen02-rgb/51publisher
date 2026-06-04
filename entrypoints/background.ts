import { storage } from '#imports';
import type { FillPageResponse, GenerateDraftResponse, PublishResult, RuntimeMessage } from '../lib/types';
import {
  getApiKey,
  getSettings,
  getSafetyMode,
  getAuthorizedHosts,
  getBatch,
  saveBatch,
  appendTrajectory,
  getPublishedTopics,
  addPublishedTopics,
} from '../lib/storage';
import { generateDraft } from '../lib/llm';
import { canSubmit } from '../lib/safety-gate';
import { orchestratePublish, type GateDecision } from '../lib/publish-orchestrator';
import { abortBatch, releaseQuarantine, patchBatchDrafts, type Batch } from '../lib/batch';
import { buildPrompt } from '../lib/messaging';
import { runBatch, approveBatch } from '../lib/batch-orchestrator';
import type { ContentDraft } from '../lib/types';

// Background service worker:调度中心 + 发布闸门。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 PUBLISH_PAGE → 闸门求值(host 取自 chrome.tabs.get(tabId).url)→ 仅授权才发准许

export interface BackgroundHandlerDeps {
  getBatch: () => Promise<Batch | null>;
  saveBatch: (batch: Batch) => Promise<void>;
  getSettings: () => Promise<import('../lib/types').Settings>;
  getApiKey: () => Promise<string>;
  getPublishedTopics: () => Promise<string[]>;
  addPublishedTopics: (topics: string[]) => Promise<void>;
  appendTrajectory: typeof appendTrajectory;
  getSafetyMode: () => Promise<import('../lib/types').SafetyMode>;
  getAuthorizedHosts: () => Promise<string[]>;
  tabsGet: (tabId: number) => Promise<chrome.tabs.Tab>;
  tabsSendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  storageGetItem: <T>(key: `local:${string}`) => Promise<T | null>;
  storageSetItem: (key: `local:${string}`, value: unknown) => Promise<void>;
  generateDraftFn: (prompt: string, opts: { settings: import('../lib/types').Settings; apiKey: string }) => Promise<GenerateDraftResponse>;
  buildBatchId: () => string;
  buildItemId: (i: number) => string;
  now: () => string;
}

/** 从 chrome.tabs.get(tabId).url 取 host;tab 关/无 url → null。 */
function makeResolveTabHost(deps: Pick<BackgroundHandlerDeps, 'tabsGet'>) {
  return async (tabId: number): Promise<string | null> => {
    try {
      const tab = await deps.tabsGet(tabId);
      if (!tab?.url) return null;
      return new URL(tab.url).hostname;
    } catch {
      return null;
    }
  };
}

/** content 经消息边界回来的值是 unknown → 校验形状。 */
function asPublishResult(value: unknown): PublishResult {
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.ok === 'boolean' && typeof o.dryRun === 'boolean') {
      return {
        ok: o.ok,
        dryRun: o.dryRun,
        ...(typeof o.url === 'string' ? { url: o.url } : {}),
        ...(typeof o.error === 'string' ? { error: o.error } : {}),
      };
    }
  }
  return { ok: false, dryRun: false, error: 'content-response-invalid' };
}

function markerKey(tabId: number): `local:${string}` {
  return `local:publishMarker:${tabId}`;
}

export function createHandlers(deps: BackgroundHandlerDeps) {
  const resolveTabHost = makeResolveTabHost(deps);

  // TOCTOU fix: 三个异步读在同一个 Promise.all 里并发触发,消除两次 await 之间 tab 可导航的窗口。
  async function evaluateGate(tabId: number): Promise<GateDecision> {
    const [mode, authorizedHosts, host] = await Promise.all([
      deps.getSafetyMode(),
      deps.getAuthorizedHosts(),
      resolveTabHost(tabId),
    ]);
    const allowed = host != null && canSubmit({ host, mode, authorizedHosts });
    return { mode, allowed, host };
  }

  function pinnedHostOk(batch: Batch): Promise<boolean> {
    return resolveTabHost(batch.tabId).then((h) => h !== null && h === batch.authorizedHost);
  }

  async function handleGenerate(prompt: string): Promise<GenerateDraftResponse> {
    try {
      const [settings, apiKey] = await Promise.all([deps.getSettings(), deps.getApiKey()]);
      return await deps.generateDraftFn(prompt, { settings, apiKey });
    } catch (err) {
      console.error('[bg] 生成草稿失败', err);
      return { ok: false, kind: 'network', error: '生成草稿时发生内部错误,请重试。' };
    }
  }

  async function handlePublish(tabId: number): Promise<PublishResult> {
    try {
      return await orchestratePublish({
        evaluateGate: () => evaluateGate(tabId),
        isAlreadyDispatched: async () => (await deps.storageGetItem(markerKey(tabId))) === 'publish-dispatched',
        writeDispatched: () => deps.storageSetItem(markerKey(tabId), 'publish-dispatched'),
        sendGrant: async () => {
          try {
            const res = await deps.tabsSendMessage(tabId, { type: 'PUBLISH_GRANT' });
            return asPublishResult(res);
          } catch {
            return { ok: false, dryRun: false, error: 'content-unreachable' };
          }
        },
        writeConfirmed: (r) =>
          deps.storageSetItem(markerKey(tabId), r.ok ? 'publish-confirmed' : `error:${r.error ?? 'unknown'}`),
      });
    } catch (err) {
      console.error('[bg] 发布编排失败', err);
      return { ok: false, dryRun: false, error: 'internal' };
    }
  }

  let batchSeq = 0;

  async function handleRunBatch(topics: string[], tabId: number): Promise<Batch | null> {
    try {
      const [settings, apiKey, publishedTopics] = await Promise.all([
        deps.getSettings(),
        deps.getApiKey(),
        deps.getPublishedTopics(),
      ]);
      return await runBatch({
        topics,
        tabId,
        resolveHost: () => resolveTabHost(tabId),
        getExistingBatch: deps.getBatch,
        pinnedHostOk,
        generateDraft: (topic) =>
          deps.generateDraftFn(buildPrompt(settings.promptTemplate, topic), { settings, apiKey }),
        save: deps.saveBatch,
        genBatchId: () => { batchSeq += 1; return deps.buildBatchId(); },
        genItemId: deps.buildItemId,
        now: deps.now,
        persistentBlockedTopics: publishedTopics,
      });
    } catch (err) {
      console.error('[bg] 批量生成失败', err);
      return deps.getBatch();
    }
  }

  async function handleApproveBatch(
    tabId: number,
    draftOverrides?: Record<string, ContentDraft>,
  ): Promise<Batch | null> {
    try {
      if (draftOverrides && Object.keys(draftOverrides).length > 0) {
        const current = await deps.getBatch();
        if (current) {
          await deps.saveBatch(patchBatchDrafts(current, draftOverrides));
        }
      }
      const result = await approveBatch({
        getBatch: deps.getBatch,
        save: deps.saveBatch,
        pinnedHostOk,
        sendFill: async (draft: ContentDraft) => {
          try {
            return (await deps.tabsSendMessage(tabId, { type: 'FILL_PAGE', draft })) as FillPageResponse;
          } catch {
            return { ok: false, error: 'fill-unreachable' };
          }
        },
        evaluateGate: () => evaluateGate(tabId),
        sendGrant: async () => {
          try {
            return asPublishResult(await deps.tabsSendMessage(tabId, { type: 'PUBLISH_GRANT' }));
          } catch {
            return { ok: false, dryRun: false, error: 'content-unreachable' };
          }
        },
        appendTrajectory: deps.appendTrajectory,
        onSnapshotDropped: (itemId) =>
          console.warn(`[bg] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`),
      });
      if (result) {
        const confirmedTopics = result.items
          .filter((it) => it.status === 'publish-confirmed')
          .map((it) => it.topic);
        if (confirmedTopics.length > 0) {
          deps.addPublishedTopics(confirmedTopics).catch((e) =>
            console.warn('[bg] addPublishedTopics 写入失败(best-effort)', e),
          );
        }
      }
      return result;
    } catch (err) {
      console.error('[bg] 批量发布失败', err);
      return deps.getBatch();
    }
  }

  async function handleKillBatch(): Promise<Batch | null> {
    const batch = await deps.getBatch();
    if (!batch) return null;
    const next = abortBatch(batch);
    await deps.saveBatch(next);
    return next;
  }

  async function handleReleaseQuarantine(itemId: string): Promise<Batch | null> {
    const batch = await deps.getBatch();
    if (!batch) return null;
    const next = releaseQuarantine(batch, itemId);
    await deps.saveBatch(next);
    return next;
  }

  return {
    handleGenerate,
    handlePublish,
    handleRunBatch,
    handleApproveBatch,
    handleKillBatch,
    handleReleaseQuarantine,
    evaluateGate,
  };
}

export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[bg] setPanelBehavior 失败', err));

  let batchSeq = 0;

  const liveDeps: BackgroundHandlerDeps = {
    getBatch,
    saveBatch,
    getSettings,
    getApiKey,
    getPublishedTopics,
    addPublishedTopics,
    appendTrajectory,
    getSafetyMode,
    getAuthorizedHosts,
    tabsGet: (id) => browser.tabs.get(id),
    tabsSendMessage: (id, msg) => browser.tabs.sendMessage(id, msg),
    storageGetItem: (key) => storage.getItem(key),
    storageSetItem: (key, val) => storage.setItem(key, val),
    generateDraftFn: generateDraft,
    buildBatchId: () => { batchSeq += 1; return `batch_${Date.now()}_${batchSeq}`; },
    buildItemId: (i) => `item_${i}`,
    now: () => new Date().toISOString(),
  };

  const handlers = createHandlers(liveDeps);

  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message?.type === 'GENERATE_DRAFT') return handlers.handleGenerate(message.prompt);
    if (message?.type === 'PUBLISH_PAGE') return handlers.handlePublish(message.tabId);
    if (message?.type === 'RUN_BATCH') return handlers.handleRunBatch(message.topics, message.tabId);
    if (message?.type === 'APPROVE_BATCH') return handlers.handleApproveBatch(message.tabId, message.draftOverrides);
    if (message?.type === 'KILL_BATCH') return handlers.handleKillBatch();
    if (message?.type === 'RELEASE_QUARANTINE') return handlers.handleReleaseQuarantine(message.itemId);
    if (message?.type === 'GET_BATCH') return getBatch();
    return undefined;
  });
});
