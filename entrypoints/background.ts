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

// Background service worker:调度中心 + 发布闸门。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此;key 绝不进 content)
// - 路由 PUBLISH_PAGE → 闸门求值(host 取自 chrome.tabs.get(tabId).url)→ 仅授权才发准许
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[bg] setPanelBehavior 失败', err));

  // webextension-polyfill 语义:监听器返回 Promise 即把其结果作为响应回传。
  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message?.type === 'GENERATE_DRAFT') {
      return handleGenerate(message.prompt);
    }
    if (message?.type === 'PUBLISH_PAGE') {
      return handlePublish(message.tabId);
    }
    if (message?.type === 'RUN_BATCH') {
      return handleRunBatch(message.topics, message.tabId);
    }
    if (message?.type === 'APPROVE_BATCH') {
      return handleApproveBatch(message.tabId, message.draftOverrides);
    }
    if (message?.type === 'KILL_BATCH') {
      return handleKillBatch();
    }
    if (message?.type === 'RELEASE_QUARANTINE') {
      return handleReleaseQuarantine(message.itemId);
    }
    if (message?.type === 'GET_BATCH') {
      return getBatch();
    }
    // 其余消息(如 FILL_PAGE)由 content script 处理,这里不认领。
    return undefined;
  });
});

async function handleGenerate(prompt: string): Promise<GenerateDraftResponse> {
  // storage 读取或生成异常都要降级成结构化错误,否则 side panel 会一直等不到响应而卡死。
  try {
    const [settings, apiKey] = await Promise.all([getSettings(), getApiKey()]);
    return await generateDraft(prompt, { settings, apiKey });
  } catch (err) {
    console.error('[bg] 生成草稿失败', err);
    return { ok: false, kind: 'network', error: '生成草稿时发生内部错误,请重试。' };
  }
}

/** 从 chrome.tabs.get(tabId).url 取 host;**绝不**接受消息携带的 host。tab 关/无 url → null。 */
async function resolveTabHost(tabId: number): Promise<string | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab?.url) return null;
    return new URL(tab.url).hostname;
  } catch {
    return null;
  }
}

async function evaluateGate(tabId: number): Promise<GateDecision> {
  const [mode, authorizedHosts] = await Promise.all([getSafetyMode(), getAuthorizedHosts()]);
  const host = await resolveTabHost(tabId);
  const allowed = host != null && canSubmit({ host, mode, authorizedHosts });
  return { mode, allowed, host };
}

// U2 用最小 publish 标记落实"dispatched 前 await 写盘"的幂等顺序。
function markerKey(tabId: number): `local:${string}` {
  return `local:publishMarker:${tabId}`;
}

/** content 经消息边界回来的值是 unknown(polyfill Promise<any>)→ 校验形状,绝不盲信。 */
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

async function handlePublish(tabId: number): Promise<PublishResult> {
  try {
    return await orchestratePublish({
      evaluateGate: () => evaluateGate(tabId),
      isAlreadyDispatched: async () => (await storage.getItem(markerKey(tabId))) === 'publish-dispatched',
      writeDispatched: () => storage.setItem(markerKey(tabId), 'publish-dispatched'),
      sendGrant: async () => {
        try {
          const res = await browser.tabs.sendMessage(tabId, { type: 'PUBLISH_GRANT' });
          return asPublishResult(res);
        } catch {
          return { ok: false, dryRun: false, error: 'content-unreachable' };
        }
      },
      writeConfirmed: (r) =>
        storage.setItem(markerKey(tabId), r.ok ? 'publish-confirmed' : `error:${r.error ?? 'unknown'}`),
    });
  } catch (err) {
    console.error('[bg] 发布编排失败', err);
    return { ok: false, dryRun: false, error: 'internal' };
  }
}

// ---- 批量编排接线 ----
// 生成/发布逻辑已移至 lib/batch-orchestrator.ts(可独立单测);
// 此处只做 chrome API adapter 注入。

let batchSeq = 0;

/** 钉 tab 断言:当前 tab 的 host 仍等于批次创建时记录的 authorizedHost。 */
function pinnedHostOk(batch: Batch): Promise<boolean> {
  return resolveTabHost(batch.tabId).then((h) => h !== null && h === batch.authorizedHost);
}

async function handleRunBatch(topics: string[], tabId: number): Promise<Batch | null> {
  try {
    const [settings, apiKey, publishedTopics] = await Promise.all([getSettings(), getApiKey(), getPublishedTopics()]);
    return await runBatch({
      topics,
      tabId,
      resolveHost: () => resolveTabHost(tabId),
      getExistingBatch: getBatch,
      pinnedHostOk,
      generateDraft: (topic) => generateDraft(buildPrompt(settings.promptTemplate, topic), { settings, apiKey }),
      save: saveBatch,
      genBatchId: () => { batchSeq += 1; return `batch_${Date.now()}_${batchSeq}`; },
      genItemId: (i) => `item_${i}`,
      now: () => new Date().toISOString(),
      persistentBlockedTopics: publishedTopics,
    });
  } catch (err) {
    console.error('[bg] 批量生成失败', err);
    return getBatch();
  }
}

async function handleApproveBatch(
  tabId: number,
  draftOverrides?: Record<string, import('../lib/types').ContentDraft>,
): Promise<Batch | null> {
  try {
    // 若有人工编辑覆盖,先写入 storage 再批准(保证 approveBatch 读到最新草稿)。
    if (draftOverrides && Object.keys(draftOverrides).length > 0) {
      const current = await getBatch();
      if (current) {
        await saveBatch(patchBatchDrafts(current, draftOverrides));
      }
    }
    const result = await approveBatch({
      getBatch,
      save: saveBatch,
      pinnedHostOk,
      sendFill: async (draft) => {
        try {
          return (await browser.tabs.sendMessage(tabId, { type: 'FILL_PAGE', draft })) as FillPageResponse;
        } catch {
          return { ok: false, error: 'fill-unreachable' };
        }
      },
      evaluateGate: () => evaluateGate(tabId),
      sendGrant: async () => {
        try {
          return asPublishResult(await browser.tabs.sendMessage(tabId, { type: 'PUBLISH_GRANT' }));
        } catch {
          return { ok: false, dryRun: false, error: 'content-unreachable' };
        }
      },
      appendTrajectory,
      onSnapshotDropped: (itemId) => console.warn(`[bg] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`),
    });
    // 持久化已确认选题(fire-and-forget;best-effort,SW 重启时可能丢失当次写入,已文档化为可接受)。
    if (result) {
      const confirmedTopics = result.items
        .filter((it) => it.status === 'publish-confirmed')
        .map((it) => it.topic);
      if (confirmedTopics.length > 0) {
        addPublishedTopics(confirmedTopics).catch((e) =>
          console.warn('[bg] addPublishedTopics 写入失败(best-effort)', e),
        );
      }
    }
    return result;
  } catch (err) {
    console.error('[bg] 批量发布失败', err);
    return getBatch();
  }
}

async function handleKillBatch(): Promise<Batch | null> {
  const batch = await getBatch();
  if (!batch) return null;
  const next = abortBatch(batch);
  await saveBatch(next);
  return next;
}

async function handleReleaseQuarantine(itemId: string): Promise<Batch | null> {
  const batch = await getBatch();
  if (!batch) return null;
  const next = releaseQuarantine(batch, itemId);
  await saveBatch(next);
  return next;
}
