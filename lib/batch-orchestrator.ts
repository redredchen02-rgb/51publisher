import type { ContentDraft, FillPageResponse, GenerateDraftResponse, PublishResult } from './types';
import type { GateDecision } from './publish-orchestrator';
import type { TrajectoryInput } from './trajectory';
import type { Batch } from './batch';
import {
  createBatch,
  markGenerating,
  markFilled,
  markGenerateFailed,
  markDispatched,
  markConfirmed,
  markPublishFailed,
  presentForApproval,
  quarantinedTopics,
  filterReentrantTopics,
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
}

/** 批量生成循环。返回最终 Batch 状态;host 解析失败或所有 topic 均被重入过滤 → null。 */
export async function runBatch(deps: RunBatchDeps): Promise<Batch | null> {
  const { topics, tabId, resolveHost, getExistingBatch, pinnedHostOk, generateDraft, save, genBatchId, genItemId, now } = deps;

  const host = await resolveHost();
  if (!host) return null;

  // 重入守卫:排除上一批仍被隔离的同选题。
  const existing = await getExistingBatch();
  const blocked = existing ? quarantinedTopics(existing) : [];
  const fresh = filterReentrantTopics(topics, blocked);
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
}

/** 批量发布循环。返回最终 Batch;无批次 → null。 */
export async function approveBatch(deps: ApproveBatchDeps): Promise<Batch | null> {
  const { getBatch, save, pinnedHostOk, sendFill, evaluateGate, sendGrant, appendTrajectory, onSnapshotDropped } = deps;

  const loaded = await getBatch();
  if (!loaded) return null;
  let batch: Batch = loaded;

  for (const snapshot of batch.items) {
    // 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
    const item = batch.items.find((it) => it.id === snapshot.id);
    if (!item || item.status !== 'awaiting-approval' || !item.draft) continue;
    if (!(await pinnedHostOk(batch))) break;

    // 先填充表单,再门控发布。
    const fill = await sendFill(item.draft);
    if (!fill.ok) {
      batch = markGenerateFailed(batch, item.id, 'fill-failed');
      await save(batch);
      continue;
    }

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

  return batch;
}

function defaultSnapshotDropped(itemId: string): void {
  console.warn(`[batch-orchestrator] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`);
}
