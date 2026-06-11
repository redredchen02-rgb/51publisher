import { storage } from '#imports';
import type { FillPageResponse, GenerateDraftResponse, PublishResult, RuntimeMessage } from '@51publisher/shared';
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
  refreshRemoteMappings,
} from '../lib/storage';
import { generateDraft, reviewDraft, rewriteDraft } from '../lib/llm';
import { canSubmit } from '../lib/safety-gate';
import { orchestratePublish, type GateDecision } from '../lib/publish-orchestrator';
import { abortBatch, releaseQuarantine, patchBatchDrafts, storeFillResults, type Batch } from '../lib/batch';
import { buildPrompt } from '../lib/messaging';
import { computeSlotDiff } from '../lib/draft-diff';
import { recordPublishedPost, type PublishedPostRecord } from '../lib/published-posts-client';
import { runBatch, approveBatch, retryItem, discardBatchItem } from '../lib/batch-orchestrator';
import { evaluateGrounding } from '../lib/grounding-gate';
import { withBackendSync } from '../lib/batch-sync';
import {
  saveDryRunReport,
  writeFillTombstone,
  clearFillTombstone,
  getFillTombstones,
  clearAllFillTombstones,
  setPendingQuarantineAlert,
  getBatch as getBatchRaw,
} from '../lib/storage';
import type { ContentDraft } from '@51publisher/shared';
import type { FactsBlock } from '@51publisher/shared';

// Background service worker:调度中心 + 发布闸门。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 PUBLISH_PAGE → 闸门求值(host 取自 chrome.tabs.get(tabId).url)→ 仅授权才发准许

export interface BackgroundHandlerDeps {
  getBatch: () => Promise<Batch | null>;
  saveBatch: (batch: Batch) => Promise<void>;
  getSettings: () => Promise<import('@51publisher/shared').Settings>;
  getApiKey: () => Promise<string>;
  getPublishedTopics: () => Promise<string[]>;
  addPublishedTopics: (topics: string[]) => Promise<void>;
  appendTrajectory: typeof appendTrajectory;
  getSafetyMode: () => Promise<import('@51publisher/shared').SafetyMode>;
  getAuthorizedHosts: () => Promise<string[]>;
  tabsGet: (tabId: number) => Promise<{ url?: string; id?: number }>;
  tabsSendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
  storageGetItem: <T>(key: `local:${string}`) => Promise<T | null>;
  storageSetItem: (key: `local:${string}`, value: unknown) => Promise<void>;
  generateDraftFn: (
    prompt: string,
    opts: { settings: import('@51publisher/shared').Settings; apiKey: string; facts?: FactsBlock },
  ) => Promise<GenerateDraftResponse>;
  buildBatchId: () => string;
  buildItemId: (i: number) => string;
  now: () => string;
  saveDryRunReportFn?: (report: import('@51publisher/shared').DryRunReport) => Promise<void>;
  writeTombstone?: (itemId: string) => Promise<void>;
  clearTombstone?: (itemId: string) => Promise<void>;
}

/** 构造 prompt 末尾的分类/标签约束块。recommendedTags 为空时只含分类约束。 */
export function buildConstraintSuffix(recommendedTags: string[]): string {
  const category = '分类约束：只能选「漫畫文章」或「動漫文章」，不能使用其他分类。';
  if (recommendedTags.length === 0) return `\n\n---\n${category}`;
  const tags = recommendedTags.join('，');
  return `\n\n---\n${category}\n标签约束：只能从以下列表中选择标签（如无匹配可留空，不要自造新词）：${tags}`;
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
      const constrainedPrompt = prompt + buildConstraintSuffix(settings.recommendedTags ?? []);
      return await deps.generateDraftFn(constrainedPrompt, { settings, apiKey });
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

  async function handleRunBatch(
    topics: string[],
    tabId: number,
    facts?: FactsBlock[],
    iterate?: boolean,
    coverImageUrls?: string[],
  ): Promise<Batch | null> {
    try {
      const [settings, apiKey, publishedTopics] = await Promise.all([
        deps.getSettings(),
        deps.getApiKey(),
        deps.getPublishedTopics(),
      ]);
      return await runBatch({
        topics,
        facts,
        coverImageUrls,
        tabId,
        resolveHost: () => resolveTabHost(tabId),
        getExistingBatch: deps.getBatch,
        pinnedHostOk,
        generateDraft: (topic, itemFacts) => {
          const prompt =
            buildPrompt(settings.promptTemplate, topic, itemFacts, settings.fewShotExamples) +
            buildConstraintSuffix(settings.recommendedTags ?? []);
          return deps.generateDraftFn(prompt, { settings, apiKey, facts: itemFacts });
        },
        save: deps.saveBatch,
        genBatchId: () => {
          batchSeq += 1;
          return deps.buildBatchId();
        },
        genItemId: deps.buildItemId,
        now: deps.now,
        persistentBlockedTopics: publishedTopics,
        bypassReentry: iterate,
        reviewDraft: (draft, criteriaPrompt) => reviewDraft(draft, criteriaPrompt, { settings, apiKey }),
        rewriteDraft: (draft, failedDims) => rewriteDraft(draft, failedDims, { settings, apiKey }),
        reviewCriteriaPrompt: settings.reviewCriteriaPrompt,
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
        onSnapshotDropped: (itemId) => console.warn(`[bg] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`),
        saveDryRunReportFn: deps.saveDryRunReportFn,
        writeTombstone: deps.writeTombstone,
        clearTombstone: deps.clearTombstone,
        checkGrounding: evaluateGrounding,
      });
      if (result) {
        const confirmedTopics = result.items.filter((it) => it.status === 'publish-confirmed').map((it) => it.topic);
        if (confirmedTopics.length > 0) {
          deps
            .addPublishedTopics(confirmedTopics)
            .catch((e) => console.warn('[bg] addPublishedTopics 写入失败(best-effort)', e));
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

  async function handleMarkItemEdited(itemId: string): Promise<void> {
    const batch = await deps.getBatch();
    if (!batch) return;
    const item = batch.items.find((it) => it.id === itemId);
    if (!item || item.userEdited) return; // 已标记则幂等跳过
    const next = { ...batch, items: batch.items.map((it) => (it.id === itemId ? { ...it, userEdited: true } : it)) };
    await deps.saveBatch(next);
  }

  async function handleRetryBatchItem(itemId: string): Promise<Batch | null> {
    try {
      const [settings, apiKey] = await Promise.all([deps.getSettings(), deps.getApiKey()]);
      return await retryItem(
        {
          getBatch: deps.getBatch,
          save: deps.saveBatch,
          generateDraft: (topic, itemFacts) => {
            const prompt =
              buildPrompt(settings.promptTemplate, topic, itemFacts, settings.fewShotExamples) +
              buildConstraintSuffix(settings.recommendedTags ?? []);
            return deps.generateDraftFn(prompt, { settings, apiKey, facts: itemFacts });
          },
        },
        itemId,
      );
    } catch (err) {
      console.error('[bg] 重试条目失败', err);
      return deps.getBatch();
    }
  }

  async function handleDiscardBatchItem(itemId: string): Promise<Batch | null> {
    const batch = await deps.getBatch();
    if (!batch) return null;
    try {
      const next = discardBatchItem(batch, itemId);
      await deps.saveBatch(next);
      return next;
    } catch {
      // Item may have already transitioned (concurrent approveBatch race). Treat as no-op.
      return batch;
    }
  }

  return {
    handleGenerate,
    handlePublish,
    handleRunBatch,
    handleApproveBatch,
    handleKillBatch,
    handleReleaseQuarantine,
    handleMarkItemEdited,
    handleRetryBatchItem,
    handleDiscardBatchItem,
    evaluateGate,
  };
}

async function runStartupTombstoneScan(): Promise<void> {
  try {
    const [batch, tombstones] = await Promise.all([getBatchRaw(), getFillTombstones()]);
    const tombstoneIds = Object.keys(tombstones);
    if (tombstoneIds.length === 0) return;

    // 清理无对应 batch 条目的残留 tombstone(重置/新批次后的孤儿)。
    if (batch) {
      const batchItemIds = new Set(batch.items.map((it) => it.id));
      const stale = tombstoneIds.filter((id) => !batchItemIds.has(id));
      for (const id of stale) {
        await clearFillTombstone(id).catch(() => {});
      }
    } else {
      await clearAllFillTombstones().catch(() => {});
    }

    // 统计 needs-human-verification 条目;有则设通知计数。
    const nhvCount = batch ? batch.items.filter((it) => it.status === 'needs-human-verification').length : 0;
    if (nhvCount > 0) {
      await setPendingQuarantineAlert(nhvCount);
    }
  } catch (e) {
    console.warn('[bg] tombstone startup scan 失败', e);
  }
}

export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[bg] setPanelBehavior 失败', err));

  // SW 启动扫描:检测上次 fill 飞行中 SW 被回收的残留 tombstone → 设隔离通知。
  void runStartupTombstoneScan();

  // 启动时拉取后端最新字段映射(选择器配置热更新)。
  // 后端不可达时 fail-closed,不覆盖本地已有映射。
  refreshRemoteMappings()
    .then(({ remote }) => {
      if (remote) console.log('[bg] 远程映射配置已刷新');
      else console.log('[bg] 使用本地默认映射(后端不可达)');
    })
    .catch((e) => console.warn('[bg] 刷新远程映射失败', e));

  // SW Keep-Alive 机制: 定时唤醒，防止超大批次时背景因闲置被杀。
  browser.alarms.create('keep-alive', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm: { name: string }) => {
    if (alarm.name === 'keep-alive') {
      console.log('[bg] keep-alive ping');
    }
  });

  let batchSeq = 0;

  const liveDeps: BackgroundHandlerDeps = {
    getBatch,
    saveBatch: withBackendSync(saveBatch),
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
    buildBatchId: () => {
      batchSeq += 1;
      return `batch_${Date.now()}_${batchSeq}`;
    },
    buildItemId: (i) => `item_${i}`,
    now: () => new Date().toISOString(),
    saveDryRunReportFn: saveDryRunReport,
    writeTombstone: (itemId) => writeFillTombstone(itemId, { tabId: 0, ts: new Date().toISOString() }),
    clearTombstone: clearFillTombstone,
  };

  const handlers = createHandlers(liveDeps);

  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message?.type === 'GENERATE_DRAFT') return handlers.handleGenerate(message.prompt);
    if (message?.type === 'PUBLISH_PAGE') return handlers.handlePublish(message.tabId);
    if (message?.type === 'RUN_BATCH')
      return handlers.handleRunBatch(
        message.topics,
        message.tabId,
        message.facts,
        message.iterate,
        message.coverImageUrls,
      );
    if (message?.type === 'APPROVE_BATCH') return handlers.handleApproveBatch(message.tabId, message.draftOverrides);
    if (message?.type === 'KILL_BATCH') return handlers.handleKillBatch();
    if (message?.type === 'RELEASE_QUARANTINE') return handlers.handleReleaseQuarantine(message.itemId);
    if (message?.type === 'MARK_ITEM_EDITED') return handlers.handleMarkItemEdited(message.itemId);
    if (message?.type === 'RETRY_BATCH_ITEM') return handlers.handleRetryBatchItem(message.itemId);
    if (message?.type === 'DISCARD_BATCH_ITEM') return handlers.handleDiscardBatchItem(message.itemId);
    if (message?.type === 'GET_BATCH') return getBatch();
    return undefined;
  });
});
