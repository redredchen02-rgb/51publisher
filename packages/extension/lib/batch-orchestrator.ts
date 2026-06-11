import type {
  ContentDraft,
  FillPageResponse,
  GenerateDraftResponse,
  PublishResult,
  DryRunReport,
  DryRunItemResult,
} from '@51publisher/shared';
import type { FactsBlock } from '@51publisher/shared';
import type { ReviewDraftResponse, RewriteDraftResponse } from './llm';
import { mergeRewriteResult } from './llm';
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
import type { GroundingVerdict } from './grounding-gate';
import { evaluateGrounding as defaultEvaluateGrounding } from './grounding-gate';
import { markGateFailed } from './batch';

// 批量编排逻辑(效果全注入,无 chrome/browser/* 直接依赖)。
// 参照 lib/publish-orchestrator.ts 模式:background.ts 只做接线,逻辑在此可单测。

// ---- RUN BATCH ----

export interface RunBatchDeps {
  topics: string[];
  /** 与 topics 同序平行的结构化事实(源接地 R4);可省略(纯选题=零事实)。 */
  facts?: (FactsBlock | undefined)[];
  /** 与 topics 同序平行的封面图 URL;可省略。长度不足时对应条目用 ''。 */
  coverImageUrls?: (string | undefined)[];
  tabId: number;
  /** chrome.tabs.get(tabId).hostname;tab 无 url/已关 → null。 */
  resolveHost: () => Promise<string | null>;
  getExistingBatch: () => Promise<Batch | null>;
  /** 当前 tab 的 host 是否仍等于批次创建时记录的 authorizedHost。 */
  pinnedHostOk: (batch: Batch) => Promise<boolean>;
  generateDraft: (topic: string, facts?: FactsBlock) => Promise<GenerateDraftResponse>;
  save: (batch: Batch) => Promise<void>;
  genBatchId: () => string;
  genItemId: (index: number) => string;
  now: () => string;
  /** 持久化已发布选题(跨 session 去重);与 in-memory quarantinedTopics 合并后过滤。 */
  persistentBlockedTopics?: string[];
  /** R8 迭代通道:true 时跳过重入闸(不查 publishedTopics/隔离),允许重跑已发题目对比效果。 */
  bypassReentry?: boolean;
  /** Phase 3 — AI 评审代理;未注入时跳过评审(fail-open)。 */
  reviewDraft?: (draft: ContentDraft, criteriaPrompt?: string) => Promise<ReviewDraftResponse>;
  /** Phase 3 — AI 重写代理;与 reviewDraft 同时注入才生效。 */
  rewriteDraft?: (draft: ContentDraft, failedDims: string[]) => Promise<RewriteDraftResponse>;
  /** Phase 3 — 自定义评审标准 prompt;空=后端用内置四维标准。 */
  reviewCriteriaPrompt?: string;
  /**
   * Phase 5 (U4) — 备稿阶段 grounding gate;省略时使用默认 evaluateGrounding 实现。
   * 可注入 mock 函数供测试隔离。fail-open:若抛出异常,视为通过,不拦截。
   */
  evaluateGrounding?: (draft: ContentDraft, facts?: FactsBlock) => GroundingVerdict;
}

/** 批量生成循环。返回最终 Batch 状态;host 解析失败或所有 topic 均被重入过滤 → null。 */
export async function runBatch(deps: RunBatchDeps): Promise<Batch | null> {
  const {
    topics,
    tabId,
    resolveHost,
    getExistingBatch,
    pinnedHostOk,
    generateDraft,
    save,
    genBatchId,
    genItemId,
    now,
  } = deps;
  // (persistentBlockedTopics 在重入守卫段从 deps 直接读取,不在此解构)

  const host = await resolveHost();
  if (!host) return null;

  // topic → facts 映射(过滤后用 fresh 题目回查对齐;重复题目后者覆盖)。
  const factsByTopic = new Map<string, FactsBlock | undefined>();
  topics.forEach((t, i) => factsByTopic.set(t, deps.facts?.[i]));

  // topic → coverImageUrl 映射(同序平行)。
  const coverUrlsByTopic = new Map<string, string>();
  topics.forEach((t, i) => {
    const u = deps.coverImageUrls?.[i];
    if (u) coverUrlsByTopic.set(t, u);
  });

  // 重入守卫:排除上一批仍被隔离的同选题 + 持久化已发布选题(防跨 session 重发)。
  // R8 迭代通道(bypassReentry)跳过此守卫,允许重跑已发题目对比 prompt/few-shot 效果。
  const existing = await getExistingBatch();
  let fresh: string[];
  if (deps.bypassReentry) {
    fresh = topics;
  } else {
    const inMemoryBlocked = existing ? quarantinedTopics(existing) : [];
    const allBlocked = [...inMemoryBlocked, ...(deps.persistentBlockedTopics ?? [])];
    fresh = filterReentrantTopics(topics, allBlocked);
    if (fresh.length === 0) return existing;
  }

  const freshFacts = fresh.map((t) => factsByTopic.get(t));
  // 封面持久化进 BatchItem:retry 重生成时才能回注(闭包 Map 不跨调用存活)。
  const freshCovers = fresh.map((t) => coverUrlsByTopic.get(t));
  let batch = createBatch(genBatchId(), tabId, host, fresh, now(), genItemId, freshFacts, freshCovers);
  await save(batch);

  for (const item of batch.items) {
    if (!(await pinnedHostOk(batch))) break; // tab 漂移 → 暂停
    batch = markGenerating(batch, item.id);
    await save(batch);

    const gen = await generateDraft(item.topic, item.facts);
    if (!gen.ok) {
      batch = markGenerateFailed(batch, item.id, gen.error);
      await save(batch);
      continue;
    }
    // 注入封面图 URL(统一从持久化的 item.coverImageUrl 读,与 retryItem 同源)。
    let draft = item.coverImageUrl ? { ...gen.draft, coverImageUrl: item.coverImageUrl } : gen.draft;

    // Phase 3 评审重写管道（fail-open：任何失败均跳过，不阻断发布）。
    let reviewMeta: Parameters<typeof markFilled>[5] = undefined;
    if (deps.reviewDraft) {
      const reviewRes = await deps.reviewDraft(draft, deps.reviewCriteriaPrompt);
      if (reviewRes.ok) {
        const failedDims = (reviewRes.result.dimensions ?? []).filter((d) => !d.pass).map((d) => d.name);
        if (failedDims.length === 0) {
          reviewMeta = { triggered: false, reviewCostTokens: reviewRes.reviewCostTokens };
        } else if (deps.rewriteDraft) {
          const rewriteRes = await deps.rewriteDraft(draft, failedDims);
          if (rewriteRes.ok) {
            draft = mergeRewriteResult(draft, rewriteRes.draft, failedDims);
            reviewMeta = { triggered: true, reviewCostTokens: reviewRes.reviewCostTokens };
          }
          // 重写失败 → fail-open，reviewMeta 保持 undefined
        }
        // reviewDraft 注入但 rewriteDraft 未注入 → fail-open
      }
      // reviewRes.ok===false → fail-open，reviewMeta 保持 undefined
    }

    batch = markFilled(batch, item.id, draft, gen.llmCostTokens, undefined, reviewMeta);
    await save(batch);

    // Phase 5 (U4) — 备稿阶段 grounding gate 预筛:
    // filled → gate-failed(内容问题,可重试) 或 保留 filled(末尾 presentForApproval 批量升格)。
    // fail-open:gate 函数抛出异常时视为通过,不拦截本条。
    const gateCheck = deps.evaluateGrounding ?? defaultEvaluateGrounding;
    let verdict: GroundingVerdict;
    try {
      verdict = gateCheck(draft, item.facts);
    } catch {
      verdict = { ok: true, reasons: [] }; // fail-open
    }
    if (!verdict.ok) {
      batch = markGateFailed(batch, item.id, verdict.reasons.join(' '));
      await save(batch);
    }
  }

  // presentForApproval 是 bulk 操作:仅将 filled 状态的 item 升格为 awaiting-approval。
  // gate-failed items 已离开 filled 状态,自然不受此调用影响。
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
  /** 发布前 grounding 硬闸(U4):仅 authorized 档拦截。返回 verdict;省略=不检查。 */
  checkGrounding?: (draft: ContentDraft, facts?: FactsBlock) => GroundingVerdict;
}

/** 批量发布循环。返回最终 Batch;无批次 → null。 */
export async function approveBatch(deps: ApproveBatchDeps): Promise<Batch | null> {
  const {
    getBatch,
    save,
    pinnedHostOk,
    sendFill,
    evaluateGate,
    sendGrant,
    appendTrajectory,
    onSnapshotDropped,
    saveDryRunReportFn,
    writeTombstone,
    clearTombstone,
    checkGrounding,
  } = deps;

  const loaded = await getBatch();
  if (!loaded) return null;
  let batch: Batch = loaded;
  const dryRunItems: DryRunItemResult[] = [];

  for (const snapshot of batch.items) {
    // 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
    const item = batch.items.find((it) => it.id === snapshot.id);
    if (!item || item.status !== 'awaiting-approval' || !item.draft) continue;
    if (!(await pinnedHostOk(batch))) break;

    // 发布前 grounding 硬闸:仅 authorized 档拦截(残留【待补】/无来源连结 → 该条转 error,不 dispatch)。
    if (checkGrounding) {
      const gate = await evaluateGate();
      if (gate.mode === 'authorized') {
        const verdict = checkGrounding(item.draft, item.facts);
        if (!verdict.ok) {
          batch = markGenerateFailed(batch, item.id, `grounding-blocked: ${verdict.reasons.join(' ')}`);
          await save(batch);
          continue;
        }
      }
    }

    // Tombstone 写在 sendFill 之前:若 SW 在 fill 飞行中被回收,重启时扫到 tombstone → 隔离。
    if (writeTombstone) {
      await writeTombstone(item.id).catch(() => {
        /* best-effort */
      });
    }

    // 先填充表单,再门控发布。
    const fill = await sendFill(item.draft);

    // 无论成功失败都清 tombstone:失败 → item 进 error 态,不是 dispatched-limbo。
    if (clearTombstone) {
      await clearTombstone(item.id).catch(() => {
        /* best-effort */
      });
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
        batch = r.ok ? markConfirmed(batch, item.id, r.url) : markPublishFailed(batch, item.id, r.error ?? 'unknown');
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
        ...(cur?.aiReviewTriggered !== undefined ? { aiReviewTriggered: cur.aiReviewTriggered } : {}),
        ...(cur?.reviewCostTokens !== undefined ? { reviewCostTokens: cur.reviewCostTokens } : {}),
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
  generateDraft: (topic: string, facts?: FactsBlock) => Promise<GenerateDraftResponse>;
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

  const gen = await deps.generateDraft(item.topic, item.facts);
  if (!gen.ok) {
    batch = markGenerateFailed(batch, itemId, gen.error);
    await deps.save(batch);
    return batch;
  }

  // 封面回注:批次创建时持久化的 item.coverImageUrl(生成恒置 '');旧批次无此字段则优雅降级。
  const draft = item.coverImageUrl ? { ...gen.draft, coverImageUrl: item.coverImageUrl } : gen.draft;
  batch = markFilled(batch, itemId, draft);
  batch = presentForApproval(batch);
  await deps.save(batch); // flush approval-ready state
  return batch;
}
