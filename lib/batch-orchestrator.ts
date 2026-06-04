import type { ContentDraft, FillPageResponse, GenerateDraftResponse, PublishResult, DryRunReport, DryRunItemResult } from './types';
import type { GateDecision } from './publish-orchestrator';
import type { TrajectoryInput } from './trajectory';
import type { Batch } from './batch';
import {
  createBatch,
  markGenerating,
  markFilled,
  markGenerateFailed,
  markFillResultsRecorded,
  markDispatched,
  markConfirmed,
  markPublishFailed,
  presentForApproval,
  quarantinedTopics,
  filterReentrantTopics,
  retryBatchItem,
} from './batch';
import { orchestratePublish } from './publish-orchestrator';

// 批量编排逻辑(效果全注入,无 chrome/browser/* 直接依赖)。
// 参照 lib/publish-orchestrator.ts 模式:background.ts 只做接线,逻辑在此可单测。

// ---- RUN BATCH ----

export interface RunBatchDeps {
  topics: string[];
  tabId: number;
  /** chrome.tabs.get(tabId).hostname;tab 无 url/已关 → null。 */
  resolveHost: () => Promise<string | null>;
  getExistingBatch: () => Promise<Batch | null>;
  /** 当前 tab 的 host 是否仍等于批次创建时记录的 authorizedHost。 */
  pinnedHostOk: (batch: Batch) => Promise<boolean>;
  generateDraft: (topic: string) => Promise<GenerateDraftResponse>;
  save: (batch: Batch) => Promise<void>;
  genBatchId: () => string;
  genItemId: (index: number) => string;
  now: () => string;
  /** 持久化已发布选题(跨 session 去重);与 in-memory quarantinedTopics 合并后过滤。 */
  persistentBlockedTopics?: string[];
}

/** 批量生成循环。返回最终 Batch 状态;host 解析失败或所有 topic 均被重入过滤 → null。 */
export async function runBatch(deps: RunBatchDeps): Promise<Batch | null> {
  const { topics, tabId, resolveHost, getExistingBatch, pinnedHostOk, generateDraft, save, genBatchId, genItemId, now } = deps;
  // (persistentBlockedTopics 在重入守卫段从 deps 直接读取,不在此解构)

  const host = await resolveHost();
  if (!host) return null;

  // 重入守卫:排除上一批仍被隔离的同选题 + 持久化已发布选题(防跨 session 重发)。
  const existing = await getExistingBatch();
  const inMemoryBlocked = existing ? quarantinedTopics(existing) : [];
  const allBlocked = [...inMemoryBlocked, ...(deps.persistentBlockedTopics ?? [])];
  const fresh = filterReentrantTopics(topics, allBlocked);
  if (fresh.length === 0) return existing;

  let batch = createBatch(genBatchId(), tabId, host, fresh, now(), genItemId);
  await save(batch);

  for (const item of batch.items) {
    if (!(await pinnedHostOk(batch))) break; // tab 漂移 → 暂停
    batch = markGenerating(batch, item.id);
    await save(batch);

    const gen = await generateDraft(item.topic);
    if (!gen.ok) {
      batch = markGenerateFailed(batch, item.id, gen.error);
      await save(batch);
      continue;
    }
    batch = markFilled(batch, item.id, gen.draft);
    await save(batch);
  }

  batch = presentForApproval(batch);
  await save(batch);
  return batch;
}

// ---- APPROVE BATCH ----

export interface ApproveBatchDeps {
  getBatch: () => Promise<Batch | null>;
  save: (batch: Batch) => Promise<void>;
  pinnedHostOk: (batch: Batch) => Promise<boolean>;
  sendFill: (draft: ContentDraft) => Promise<FillPageResponse>;
  evaluateGate: () => Promise<GateDecision>;
  /** 发一次性准许到 content,返回执行结果。 */
  sendGrant: () => Promise<PublishResult>;
  appendTrajectory: (input: TrajectoryInput) => Promise<{ snapshotDropped: boolean }>;
  /** 轨迹快照丢弃时的告警回调(默认 console.warn)。 */
  onSnapshotDropped?: (itemId: string) => void;
  /** dry-run 批准完成后持久化填充报告(fire-and-forget,可选)。 */
  saveDryRunReportFn?: (report: DryRunReport) => Promise<void>;
  /** sendFill 前写 tombstone;fill ACK 后清除(可选,无 no-op)。 */
  writeTombstone?: (itemId: string) => Promise<void>;
  clearTombstone?: (itemId: string) => Promise<void>;
}

/** 批量发布循环。返回最终 Batch;无批次 → null。 */
export async function approveBatch(deps: ApproveBatchDeps): Promise<Batch | null> {
  const { getBatch, save, pinnedHostOk, sendFill, evaluateGate, sendGrant, appendTrajectory, onSnapshotDropped, saveDryRunReportFn, writeTombstone, clearTombstone } = deps;

  const loaded = await getBatch();
  if (!loaded) return null;
  let batch: Batch = loaded;
  const dryRunItems: DryRunItemResult[] = [];

  for (const snapshot of batch.items) {
    // 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
    const item = batch.items.find((it) => it.id === snapshot.id);
    if (!item || item.status !== 'awaiting-approval' || !item.draft) continue;
    if (!(await pinnedHostOk(batch))) break;

    // Tombstone 写在 sendFill 之前:若 SW 在 fill 飞行中被回收,重启时扫到 tombstone → 隔离。
    if (writeTombstone) {
      await writeTombstone(item.id).catch(() => {/* best-effort */});
    }

    // 先填充表单,再门控发布。
    const fill = await sendFill(item.draft);

    // 无论成功失败都清 tombstone:失败 → item 进 error 态,不是 dispatched-limbo。
    if (clearTombstone) {
      await clearTombstone(item.id).catch(() => {/* best-effort */});
    }

    if (!fill.ok) {
      batch = markGenerateFailed(batch, item.id, 'fill-failed');
      await save(batch);
      continue;
    }
    // 持久化填充结果(供批量审核 UI 展示降级警告)。
    batch = markFillResultsRecorded(batch, item.id, fill.results);
    await save(batch);

    // 为当前 item 动态构造 OrchestratorDeps,闭合可变 batch 引用。
    const result = await orchestratePublish({
      evaluateGate,
      isAlreadyDispatched: async () => {
        const cur = batch.items.find((it) => it.id === item.id);
        return cur?.status === 'publish-dispatched';
      },
      writeDispatched: async () => {
        batch = markDispatched(batch, item.id);
        await save(batch);
      },
      sendGrant,
      writeConfirmed: async (r: PublishResult) => {
        if (r.dryRun) return; // dry-run 不落状态
        batch = r.ok
          ? markConfirmed(batch, item.id, r.url)
          : markPublishFailed(batch, item.id, r.error ?? 'unknown');
        await save(batch);
      },
    });

    // dry-run:收集填充结果供报告展示。
    if (result.dryRun) {
      const cur = batch.items.find((it) => it.id === item.id);
      dryRunItems.push({
        itemId: item.id,
        topic: item.topic,
        fillResults: cur?.fillResults ?? fill.results,
        draftTitle: item.draft?.title,
      });
    }

    // 轨迹:authorized 真发(非 dry-run)才落档。
    if (!result.dryRun) {
      const cur = batch.items.find((it) => it.id === item.id);
      const { snapshotDropped } = await appendTrajectory({
        id: item.id,
        topic: item.topic,
        fields: fill.results,
        publishUrl: result.url,
        status: cur?.status ?? 'unknown',
        ts: new Date().toISOString(),
        publishedAsDraft: item.draft.postStatus === '0',
      });
      if (snapshotDropped) {
        (onSnapshotDropped ?? defaultSnapshotDropped)(item.id);
      }
    }

    // blocked → 暂停,不继续后续条目。
    if (!result.ok && result.error === 'blocked') break;
  }

  // dry-run 结束:持久化填充报告(best-effort,失败不抛出)。
  if (dryRunItems.length > 0 && saveDryRunReportFn) {
    const report: DryRunReport = { batchId: batch.id, ts: new Date().toISOString(), items: dryRunItems };
    saveDryRunReportFn(report).catch((e) => console.warn('[batch-orchestrator] saveDryRunReport 失败(best-effort)', e));
  }

  return batch;
}

function defaultSnapshotDropped(itemId: string): void {
  console.warn(`[batch-orchestrator] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`);
}

// ---- RETRY ITEM ----

/** retryItem 只需 RunBatchDeps 的子集。 */
export interface RetryItemDeps {
  getBatch: () => Promise<Batch | null>;
  save: (batch: Batch) => Promise<void>;
  generateDraft: (topic: string) => Promise<GenerateDraftResponse>;
}

/**
 * 重试单条 error/aborted 条目:
 * retryBatchItem → save → markGenerating → generateDraft → markFilled →
 * presentForApproval → save → return batch。
 * 其他条目不受影响。generateDraft 失败 → item 回 error,不抛。
 */
export async function retryItem(deps: RetryItemDeps, itemId: string): Promise<Batch | null> {
  const loaded = await deps.getBatch();
  if (!loaded) return null;

  let batch = retryBatchItem(loaded, itemId);
  await deps.save(batch); // flush queued status before any concurrent reader

  const item = batch.items.find((it) => it.id === itemId);
  if (!item) return batch;

  batch = markGenerating(batch, itemId);
  await deps.save(batch);

  const gen = await deps.generateDraft(item.topic);
  if (!gen.ok) {
    batch = markGenerateFailed(batch, itemId, gen.error);
    await deps.save(batch);
    return batch;
  }

  batch = markFilled(batch, itemId, gen.draft);
  batch = presentForApproval(batch);
  await deps.save(batch); // flush approval-ready state
  return batch;
}
