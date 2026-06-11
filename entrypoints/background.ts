import { storage } from '#imports';
import type { ContentDraft, FillPageResponse, GenerateDraftResponse, PublishResult, RuntimeMessage } from '../lib/types';
import {
  getApiKey,
  getSettings,
  getSafetyMode,
  getAuthorizedHosts,
  getBatch,
  saveBatch,
  appendTrajectory,
} from '../lib/storage';
import { generateDraft } from '../lib/llm';
import { canSubmit } from '../lib/safety-gate';
import { orchestratePublish, type GateDecision } from '../lib/publish-orchestrator';
import {
  type Batch,
  createBatch,
  markGenerating,
  markFilled,
  markGenerateFailed,
  markDispatched,
  markConfirmed,
  markPublishFailed,
  storeFillResults,
  presentForApproval,
  abortBatch,
  releaseQuarantine,
  quarantinedTopics,
  filterReentrantTopics,
} from '../lib/batch';
import { buildPrompt } from '../lib/messaging';
import { computeSlotDiff } from '../lib/draft-diff';
import { recordPublishedPost, type PublishedPostRecord } from '../lib/published-posts-client';

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
      return handleApproveBatch(message.tabId);
    }
    if (message?.type === 'KILL_BATCH') {
      return handleKillBatch();
    }
    if (message?.type === 'RELEASE_QUARANTINE') {
      return handleReleaseQuarantine(message.itemId);
    }
    if (message?.type === 'MARK_ITEM_EDITED') {
      return handleMarkItemEdited(message.itemId);
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

// U2 用最小 publish 标记落实"dispatched 前 await 写盘"的幂等顺序;
// 完整批量状态机(needs-human-verification 等)在 U4。
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
      // 在途守卫:标记仍为 publish-dispatched(无回执)→ 拒绝重入,绝不二次发准许。
      isAlreadyDispatched: async () => (await storage.getItem(markerKey(tabId))) === 'publish-dispatched',
      writeDispatched: () => storage.setItem(markerKey(tabId), 'publish-dispatched'),
      sendGrant: async () => {
        try {
          const res = await browser.tabs.sendMessage(tabId, { type: 'PUBLISH_GRANT' });
          return asPublishResult(res);
        } catch {
          // content 不可达(脚本未注入 / 页面无监听):**未触发**提交。
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

// ---- 批量编排(U4)----
// 生成阶段:逐条生成草稿并**存进 batch item**(后台只有一个表单,不能同时填 N 条)。
// 批准阶段:逐条把存的草稿填进表单 → 门控发布。每步前断言钉住的 tab 仍是同一授权 host。

let batchSeq = 0;
function genBatchId(): string {
  batchSeq += 1;
  return `batch_${Date.now()}_${batchSeq}`;
}

/** 钉 tab 断言:当前 tab 的 host 仍等于批次创建时记录的授权 host。 */
async function pinnedHostOk(batch: Batch): Promise<boolean> {
  const host = await resolveTabHost(batch.tabId);
  return host !== null && host === batch.authorizedHost;
}

async function handleRunBatch(topics: string[], tabId: number): Promise<Batch | null> {
  try {
    const host = await resolveTabHost(tabId);
    if (!host) return null; // tab 无 url / 已关:不开批

    // 重入守卫:排除上一批仍被隔离的同选题(绝不自动重入)。
    const existing = await getBatch();
    const blocked = existing ? quarantinedTopics(existing) : [];
    const fresh = filterReentrantTopics(topics, blocked);
    if (fresh.length === 0) return existing;

    const now = new Date().toISOString();
    let batch = createBatch(genBatchId(), tabId, host, fresh, now, (i) => `item_${i}`);
    await saveBatch(batch);

    const [settings, apiKey] = await Promise.all([getSettings(), getApiKey()]);
    for (const item of batch.items) {
      if (!(await pinnedHostOk(batch))) break; // tab 漂移 → 暂停,UI 提示切回
      batch = markGenerating(batch, item.id);
      await saveBatch(batch);

      const genStart = Date.now();
      const gen = await generateDraft(buildPrompt(settings.promptTemplate, item.topic), { settings, apiKey });
      const genDurationMs = Date.now() - genStart;
      if (!gen.ok) {
        batch = markGenerateFailed(batch, item.id, gen.error);
        await saveBatch(batch);
        continue;
      }
      batch = markFilled(batch, item.id, gen.draft, gen.llmCostTokens, genDurationMs);
      await saveBatch(batch);
    }

    batch = presentForApproval(batch);
    await saveBatch(batch);
    return batch;
  } catch (err) {
    console.error('[bg] 批量生成失败', err);
    return getBatch();
  }
}

async function handleApproveBatch(tabId: number): Promise<Batch | null> {
  try {
    const loaded = await getBatch();
    if (!loaded) return null;
    let batch: Batch = loaded;

    // 档位在批次运行期间稳定,取一次即可。
    const currentMode = await getSafetyMode();

    for (const snapshot of batch.items) {
      // 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
      const item = batch.items.find((it) => it.id === snapshot.id);
      if (!item || item.status !== 'awaiting-approval' || !item.draft) continue;
      if (!(await pinnedHostOk(batch))) break; // tab 漂移 → 暂停

      // 先把这条草稿填进表单(填充不经闸门),再门控发布当前表单。
      const fill = await sendFill(tabId, item.draft);
      if (!fill.ok) {
        batch = markGenerateFailed(batch, item.id, 'fill-failed');
        await saveBatch(batch);
        continue;
      }

      // 存填充结果(degrade 聚合 U4 数据源)。
      batch = storeFillResults(batch, item.id, fill.results);
      await saveBatch(batch);

      const result = await orchestratePublish({
        evaluateGate: () => evaluateGate(tabId),
        isAlreadyDispatched: async () => itemStatus(batch, item.id) === 'publish-dispatched',
        writeDispatched: async () => {
          batch = markDispatched(batch, item.id);
          await saveBatch(batch);
        },
        sendGrant: async () => {
          try {
            return asPublishResult(await browser.tabs.sendMessage(tabId, { type: 'PUBLISH_GRANT' }));
          } catch {
            return { ok: false, dryRun: false, error: 'content-unreachable' };
          }
        },
        writeConfirmed: async (r) => {
          // dry-run 不改条目状态(无准许、未发);仅 authorized 真发才落 confirmed/error。
          if (r.dryRun) return;
          batch = r.ok ? markConfirmed(batch, item.id, r.url) : markPublishFailed(batch, item.id, r.error ?? 'unknown');
          await saveBatch(batch);
        },
      });

      // 轨迹:全档位落档(R6a)。
      {
        const freshItem = batch.items.find((it) => it.id === item.id);
        const status = result.dryRun
          ? 'dry-run-completed'
          : result.error === 'blocked'
            ? 'fill-completed'
            : (itemStatus(batch, item.id) ?? 'unknown');
        const slotDiff = currentMode === 'authorized'
          ? computeSlotDiff(freshItem?.publishedDraft, item.draft)
          : undefined;
        const { snapshotDropped } = await appendTrajectory({
          id: item.id,
          topic: item.topic,
          fields: fill.results,
          publishUrl: result.url,
          status,
          ts: new Date().toISOString(),
          publishedAsDraft: item.draft.postStatus === '0',
          mode: currentMode,
          hasManualEdit: currentMode === 'authorized' ? (freshItem?.userEdited ?? false) : undefined,
          llmCostTokens: freshItem?.llmCostTokens,
          generationDurationMs: freshItem?.generationDurationMs,
          slotDiff,
        });
        if (snapshotDropped) console.warn('[bg] 轨迹快照含机密被丢弃(record 已落,无快照)');
        // best-effort 后端双写（失败静默；trajectory 是本地 source of truth）
        if (currentMode === 'authorized' && result.ok) {
          void recordPublishedPost({
            id: item.id,
            batchItemId: item.id,
            sourceTitle: item.topic,
            publishUrl: result.url,
            publishUrlSource: result.urlSource,
            publishedAt: new Date().toISOString(),
            outcome: 'publish-confirmed',
          });
        }
      }

      // dry-run / blocked:不推进条目(留在 awaiting-approval),让 UI 报告。
      if (!result.ok && result.error === 'blocked') break;
    }

    return batch;
  } catch (err) {
    console.error('[bg] 批量发布失败', err);
    return getBatch();
  }
}

function itemStatus(batch: Batch, itemId: string): string | undefined {
  return batch.items.find((it) => it.id === itemId)?.status;
}

async function sendFill(tabId: number, draft: ContentDraft): Promise<FillPageResponse> {
  try {
    return (await browser.tabs.sendMessage(tabId, { type: 'FILL_PAGE', draft })) as FillPageResponse;
  } catch {
    return { ok: false, error: 'fill-unreachable' };
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

async function handleMarkItemEdited(itemId: string): Promise<void> {
  const batch = await getBatch();
  if (!batch) return;
  const item = batch.items.find((it) => it.id === itemId);
  if (!item || item.userEdited) return; // 已标记则幂等跳过
  const next = { ...batch, items: batch.items.map((it) => it.id === itemId ? { ...it, userEdited: true } : it) };
  await saveBatch(next);
}
