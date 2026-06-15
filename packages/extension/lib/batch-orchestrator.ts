import type {
	ContentDraft,
	DryRunItemResult,
	DryRunReport,
	FactsBlock,
	FillPageResponse,
	GenerateDraftResponse,
	PublishResult,
} from "@51publisher/shared";
import type { Batch } from "./batch";
import {
	createBatch,
	filterReentrantTopics,
	markConfirmed,
	markDispatched,
	markFilled,
	markFillResultsRecorded,
	markGateFailed,
	markGenerateFailed,
	markGenerating,
	markPublishFailed,
	presentForApproval,
	quarantinedTopics,
	retryBatchItem,
	transition,
} from "./batch";
import { computeSlotDiff } from "./draft-diff";
import type { GroundingVerdict } from "./grounding-gate";
import { evaluateGrounding as defaultEvaluateGrounding } from "./grounding-gate";
import type { ReviewDraftResponse, RewriteDraftResponse } from "./llm";
import { mergeRewriteResult } from "./llm";
import type { GateDecision } from "./publish-orchestrator";
import { orchestratePublish } from "./publish-orchestrator";
import type { PublishedPostRecord } from "./published-posts-client";
import type { TrajectoryInput } from "./trajectory";

// 批量编排逻辑(效果全注入,无 chrome/browser/* 直接依赖)。
// 参照 lib/publish-orchestrator.ts 模式:background.ts 只做接线,逻辑在此可单测。

/**
 * 生成阶段并发度:每条 item 的 LLM 工作(generate + review + rewrite)彼此独立,
 * 并发跑可把大批量(100 条 ~1h)压到 ~15min。配合 LLM 层既有 429/5xx 退避,3 路并发对供应商 rate-limit 友好。
 */
const GENERATION_CONCURRENCY = 3;

/**
 * 串行互斥队列:把并发 worker 的状态变更逐个排队执行,保证对共享 batch 累积态的「读→改→save」原子化,
 * 避免多个 worker 持过期 batch 互相覆盖。返回的函数 await 即等到本次变更落盘。
 */
function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const run = tail.then(fn);
		// 吞掉错误以免毒化队列;调用方各自 await run 拿真实结果/异常。
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
}

/** 有界并发 map:最多 limit 个 worker 同时跑,顺序无关。worker 内部异常向上抛(由调用方 fail-open 包裹)。 */
async function mapWithConcurrency<T>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	async function runner(): Promise<void> {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			const item = items[i];
			if (item === undefined) return;
			await worker(item);
		}
	}
	const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
	await Promise.all(runners);
}

// ---- RUN BATCH ----

export interface RunBatchDeps {
	topics: string[];
	/** 与 topics 同序平行的结构化事实(源接地 R4);可省略(纯选题=零事实)。 */
	facts?: (FactsBlock | undefined)[];
	/** 与 topics 同序平行的封面图 URL;可省略。长度不足时对应条目用 ''。 */
	coverImageUrls?: (string | undefined)[];
	/** 与 topics 同序平行的待审池选题 ID(U7 状态回写);可省略(手动批量=无来源选题)。 */
	topicIds?: (string | undefined)[];
	/** 与 topics 同序平行的 web 富化文本（来自 pending-store enrichmentText）;可省略。 */
	enrichments?: (string | undefined)[];
	tabId: number;
	/** chrome.tabs.get(tabId).hostname;tab 无 url/已关 → null。 */
	resolveHost: () => Promise<string | null>;
	getExistingBatch: () => Promise<Batch | null>;
	/** 当前 tab 的 host 是否仍等于批次创建时记录的 authorizedHost。 */
	pinnedHostOk: (batch: Batch) => Promise<boolean>;
	generateDraft: (
		topic: string,
		facts?: FactsBlock,
		enrichment?: string,
	) => Promise<GenerateDraftResponse>;
	save: (batch: Batch) => Promise<void>;
	genBatchId: () => string;
	now: () => string;
	/** 持久化已发布选题(跨 session 去重);与 in-memory quarantinedTopics 合并后过滤。 */
	persistentBlockedTopics?: string[];
	/** R8 迭代通道:true 时跳过重入闸(不查 publishedTopics/隔离),允许重跑已发题目对比效果。 */
	bypassReentry?: boolean;
	/** Phase 3 — AI 评审代理;未注入时跳过评审(fail-open)。 */
	reviewDraft?: (
		draft: ContentDraft,
		criteriaPrompt?: string,
	) => Promise<ReviewDraftResponse>;
	/** Phase 3 — AI 重写代理;与 reviewDraft 同时注入才生效。 */
	rewriteDraft?: (
		draft: ContentDraft,
		failedDims: string[],
	) => Promise<RewriteDraftResponse>;
	/** Phase 3 — 自定义评审标准 prompt;空=后端用内置四维标准。 */
	reviewCriteriaPrompt?: string;
	/**
	 * Phase 5 (U4) — 备稿阶段 grounding gate;省略时使用默认 evaluateGrounding 实现。
	 * 可注入 mock 函数供测试隔离。fail-open:若抛出异常,视为通过,不拦截。
	 */
	evaluateGrounding?: (
		draft: ContentDraft,
		facts?: FactsBlock,
	) => GroundingVerdict;
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
		now,
	} = deps;
	// (persistentBlockedTopics 在重入守卫段从 deps 直接读取,不在此解构)

	const host = await resolveHost();
	if (!host) return null;

	// topic → facts 映射(过滤后用 fresh 题目回查对齐;重复题目后者覆盖)。
	const factsByTopic = new Map<string, FactsBlock | undefined>();
	topics.forEach((t, i) => {
		factsByTopic.set(t, deps.facts?.[i]);
	});

	// topic → coverImageUrl 映射(同序平行)。
	const coverUrlsByTopic = new Map<string, string>();
	topics.forEach((t, i) => {
		const u = deps.coverImageUrls?.[i];
		if (u) coverUrlsByTopic.set(t, u);
	});

	// topic → 待审池选题 ID 映射(同序平行,U7 状态回写)。
	const topicIdsByTopic = new Map<string, string>();
	topics.forEach((t, i) => {
		const tid = deps.topicIds?.[i];
		if (tid) topicIdsByTopic.set(t, tid);
	});

	// topic → 富化文本映射(来自 pending-store enrichmentText,可省略)。
	const enrichmentByTopic = new Map<string, string>();
	topics.forEach((t, i) => {
		const e = deps.enrichments?.[i];
		if (e) enrichmentByTopic.set(t, e);
	});

	// 重入守卫:排除上一批仍被隔离的同选题 + 持久化已发布选题(防跨 session 重发)。
	// R8 迭代通道(bypassReentry)跳过此守卫,允许重跑已发题目对比 prompt/few-shot 效果。
	const existing = await getExistingBatch();
	let fresh: string[];
	if (deps.bypassReentry) {
		fresh = topics;
	} else {
		const inMemoryBlocked = existing ? quarantinedTopics(existing) : [];
		const allBlocked = [
			...inMemoryBlocked,
			...(deps.persistentBlockedTopics ?? []),
		];
		fresh = filterReentrantTopics(topics, allBlocked);
		if (fresh.length === 0) return existing;
	}

	const freshFacts = fresh.map((t) => factsByTopic.get(t));
	// 封面持久化进 BatchItem:retry 重生成时才能回注(闭包 Map 不跨调用存活)。
	const freshCovers = fresh.map((t) => coverUrlsByTopic.get(t));
	const freshTopicIds = fresh.map((t) => topicIdsByTopic.get(t));
	const freshEnrichments = fresh.map((t) => enrichmentByTopic.get(t));
	const batchId = genBatchId();
	let batch = createBatch(
		batchId,
		tabId,
		host,
		fresh,
		now(),
		(i) => `${batchId}:${i}`,
		freshFacts,
		freshCovers,
		freshTopicIds,
		freshEnrichments,
	);
	await save(batch);

	// 并发生成:每条 item 的 LLM 工作并行跑(并发度 GENERATION_CONCURRENCY),
	// 但所有对 batch 累积态的变更经 serialQueue 串行落盘,保证「读→改→save」原子化、零竞态。
	// UI 轮询 getBatchState 仍能看到逐条流式进度(每条完成即 save)。
	const serialQueue = createSerialQueue();
	/**
	 * 原子地套用一次 batch 变更并落盘。并发 worker 各自 await,互不覆盖。
	 * 先算 next、save 成功后才提交内存 batch:避免某条 save 失败后,其未落盘的内存改动
	 * 被后一个 worker 的成功 save 一起持久化,造成磁盘出现「半提交」不一致态。
	 */
	const applyMutation = (fn: (b: Batch) => Batch): Promise<void> =>
		serialQueue(async () => {
			const next = fn(batch);
			await save(next);
			batch = next;
		});

	// tab 漂移 → 暂停:一旦检测到 host 失配,置位 paused,后续 worker 不再启动 LLM 工作(item 留在 queued)。
	let paused = false;
	const workItems = batch.items; // 快照初始 items;mark* 按 id 在当前 batch 内查找,引用稳定。

	await mapWithConcurrency(workItems, GENERATION_CONCURRENCY, async (item) => {
		if (paused) return;
		if (!(await pinnedHostOk(batch))) {
			paused = true;
			return;
		}
		await applyMutation((b) => markGenerating(b, item.id));

		const gen = await generateDraft(
			item.topic,
			item.facts,
			enrichmentByTopic.get(item.topic),
		);
		if (!gen.ok) {
			await applyMutation((b) => markGenerateFailed(b, item.id, gen.error));
			return;
		}
		// 注入封面图 URL(统一从持久化的 item.coverImageUrl 读,与 retryItem 同源)。
		let draft = item.coverImageUrl
			? { ...gen.draft, coverImageUrl: item.coverImageUrl }
			: gen.draft;
		// 保存 assembler 原始草稿,供 grounding gate 检测【待补】占位(重写不能掩盖缺失事实)。
		const assembledDraft = draft;

		// Phase 3 评审重写管道（fail-open：任何失败均跳过，不阻断发布）。
		let reviewMeta: Parameters<typeof markFilled>[5];
		if (deps.reviewDraft) {
			const reviewRes = await deps.reviewDraft(
				draft,
				deps.reviewCriteriaPrompt,
			);
			if (reviewRes.ok) {
				const failedDims = (reviewRes.result.dimensions ?? [])
					.filter((d) => !d.pass)
					.map((d) => d.name);
				if (failedDims.length === 0) {
					reviewMeta = {
						triggered: false,
						reviewCostTokens: reviewRes.reviewCostTokens,
					};
				} else if (deps.rewriteDraft) {
					const rewriteRes = await deps.rewriteDraft(draft, failedDims);
					if (rewriteRes.ok) {
						draft = mergeRewriteResult(draft, rewriteRes.draft, failedDims);
						reviewMeta = {
							triggered: true,
							reviewCostTokens: reviewRes.reviewCostTokens,
						};
					}
					// 重写失败 → fail-open，reviewMeta 保持 undefined
				}
				// reviewDraft 注入但 rewriteDraft 未注入 → fail-open
			}
			// reviewRes.ok===false → fail-open，reviewMeta 保持 undefined
		}

		await applyMutation((b) =>
			markFilled(
				b,
				item.id,
				draft,
				gen.llmCostTokens,
				undefined,
				reviewMeta,
				assembledDraft,
				gen.slots,
			),
		);

		// Phase 5 (U4) — 备稿阶段 grounding gate 预筛:
		// filled → gate-failed(内容问题,可重试) 或 保留 filled(末尾 presentForApproval 批量升格)。
		// fail-open:gate 函数抛出异常时视为通过,不拦截本条。
		const gateCheck = deps.evaluateGrounding ?? defaultEvaluateGrounding;
		let verdict: GroundingVerdict;
		try {
			verdict = gateCheck(assembledDraft, item.facts);
		} catch {
			verdict = { ok: true, reasons: [] }; // fail-open
		}
		if (!verdict.ok) {
			await applyMutation((b) =>
				markGateFailed(b, item.id, verdict.reasons.join(" ")),
			);
		}
	});

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
	appendTrajectory: (
		input: TrajectoryInput,
	) => Promise<{ snapshotDropped: boolean }>;
	/** 轨迹快照丢弃时的告警回调(默认 console.warn)。 */
	onSnapshotDropped?: (itemId: string) => void;
	/** dry-run 批准完成后持久化填充报告(fire-and-forget,可选)。 */
	saveDryRunReportFn?: (report: DryRunReport) => Promise<void>;
	/** sendFill 前写 tombstone;fill ACK 后清除(可选,无 no-op)。 */
	writeTombstone?: (itemId: string) => Promise<void>;
	clearTombstone?: (itemId: string) => Promise<void>;
	/** 发布前 grounding 硬闸(U4):仅 authorized 档拦截。返回 verdict;省略=不检查。 */
	checkGrounding?: (
		draft: ContentDraft,
		facts?: FactsBlock,
	) => GroundingVerdict;
	/** 发布确认后登记已发布帖子(best-effort fire-and-forget,省略=跳过)。 */
	recordPost?: (record: PublishedPostRecord) => Promise<void>;
	/** 当前时间戳生成器;省略=new Date().toISOString()。注入后测试可注入固定值。 */
	now?: () => string;
	/** 存在时只处理 id 匹配的单条;省略=处理全部 awaiting-approval。 */
	itemIdFilter?: string;
}

/** 批量发布循环。返回最终 Batch;无批次 → null。 */
export async function approveBatch(
	deps: ApproveBatchDeps,
): Promise<Batch | null> {
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
		recordPost,
		now = () => new Date().toISOString(),
		itemIdFilter,
	} = deps;

	const loaded = await getBatch();
	if (!loaded) return null;
	let batch: Batch = loaded;
	const dryRunItems: DryRunItemResult[] = [];

	for (const snapshot of batch.items) {
		if (itemIdFilter && snapshot.id !== itemIdFilter) continue;
		// 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
		const item = batch.items.find((it) => it.id === snapshot.id);
		if (item?.status !== "awaiting-approval" || !item.draft) continue;
		if (!(await pinnedHostOk(batch))) break;

		// 发布前 grounding 硬闸:仅 authorized 档拦截(残留【待补】/无来源连结 → 该条转 error,不 dispatch)。
		// 提到块外:① 快照闸(下)与 ② 填充前复检(sendFill 前)共用同一 gate.mode 判定。
		const gate = checkGrounding ? await evaluateGate() : undefined;
		if (checkGrounding && gate?.mode === "authorized") {
			const verdict = checkGrounding(
				item.assembledDraftSnapshot ?? item.draft,
				item.facts,
			);
			if (!verdict.ok) {
				batch = markGenerateFailed(
					batch,
					item.id,
					`grounding-blocked: ${verdict.reasons.join(" ")}`,
				);
				await save(batch);
				continue;
			}
		}

		// 填充前 grounding 复检(纵深防御,R10):上面的快照闸判 `snapshot ?? draft`,但 sendFill 实际填的是
		// item.draft。patchBatchDrafts 可在 awaiting-approval 态只改 draft(不动 snapshot),
		// 故升格后的内联编辑可能把【待补】/无来源连结重新塞进 draft,而快照闸已基于干净快照放行。
		// 在真填充前用同一检测器(四字段)+ 同一 factUrls 源对「实际要填的内容」复检,堵掉这一旁路。
		if (checkGrounding && gate?.mode === "authorized") {
			const verdict = checkGrounding(item.draft, item.facts);
			if (!verdict.ok) {
				batch = markGenerateFailed(
					batch,
					item.id,
					`grounding-blocked: ${verdict.reasons.join(" ")}`,
				);
				await save(batch);
				continue;
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
			batch = markGenerateFailed(batch, item.id, "fill-failed");
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
				return cur?.status === "publish-dispatched";
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
					: markPublishFailed(batch, item.id, r.error ?? "unknown");
				await save(batch);
				if (r.ok && recordPost) {
					recordPost({
						id: crypto.randomUUID(),
						batchItemId: item.id,
						sourceTitle: item.topic,
						publishUrl: r.url ?? "",
						publishedAt: now(),
					}).catch((err) =>
						console.warn(
							"[batch-orchestrator] recordPost 失败(best-effort)",
							err,
						),
					);
				}
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
			// 计算 slotDiff:比较 AI 原稿(publishedDraft)与最终发布草稿(draft)。
			const slotDiff =
				cur?.publishedDraft && cur?.draft
					? computeSlotDiff(cur.publishedDraft, cur.draft)
					: undefined;
			const { snapshotDropped } = await appendTrajectory({
				id: item.id,
				topic: item.topic,
				fields: fill.results,
				publishUrl: result.url,
				status: cur?.status ?? "unknown",
				ts: new Date().toISOString(),
				publishedAsDraft: item.draft?.postStatus === "0",
				...(slotDiff !== undefined ? { slotDiff } : {}),
				...(cur?.aiReviewTriggered !== undefined
					? { aiReviewTriggered: cur.aiReviewTriggered }
					: {}),
				...(cur?.reviewCostTokens !== undefined
					? { reviewCostTokens: cur.reviewCostTokens }
					: {}),
			});
			if (snapshotDropped) {
				(onSnapshotDropped ?? defaultSnapshotDropped)(item.id);
			}
		}

		// blocked → 暂停,不继续后续条目。
		if (!result.ok && result.error === "blocked") break;
	}

	// dry-run 结束:持久化填充报告(best-effort,失败不抛出)。
	if (dryRunItems.length > 0 && saveDryRunReportFn) {
		const report: DryRunReport = {
			batchId: batch.id,
			ts: new Date().toISOString(),
			items: dryRunItems,
		};
		saveDryRunReportFn(report).catch((e) =>
			console.warn(
				"[batch-orchestrator] saveDryRunReport 失败(best-effort)",
				e,
			),
		);
	}

	return batch;
}

function defaultSnapshotDropped(itemId: string): void {
	console.warn(
		`[batch-orchestrator] 轨迹快照含机密被丢弃(record 已落,无快照) itemId=${itemId}`,
	);
}

// ---- DISCARD ITEM ----

/**
 * 操作者主动否决单条待审项(awaiting-approval → aborted)。
 * 与 retryBatchItem 对称:唯一能将 awaiting-approval 打到 aborted 的路径。
 */
export function discardBatchItem(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "awaiting-approval", {
		status: "aborted",
		error: "operator-discarded",
	});
}

// ---- RETRY ITEM ----

/** retryItem 只需 RunBatchDeps 的子集。 */
export interface RetryItemDeps {
	getBatch: () => Promise<Batch | null>;
	save: (batch: Batch) => Promise<void>;
	generateDraft: (
		topic: string,
		facts?: FactsBlock,
		enrichment?: string,
	) => Promise<GenerateDraftResponse>;
}

/**
 * 重试单条 error/aborted 条目:
 * retryBatchItem → save → markGenerating → generateDraft → markFilled →
 * presentForApproval → save → return batch。
 * 其他条目不受影响。generateDraft 失败 → item 回 error,不抛。
 */
export async function retryItem(
	deps: RetryItemDeps,
	itemId: string,
): Promise<Batch | null> {
	const loaded = await deps.getBatch();
	if (!loaded) return null;

	let batch = retryBatchItem(loaded, itemId);
	await deps.save(batch); // flush queued status before any concurrent reader

	const item = batch.items.find((it) => it.id === itemId);
	if (!item) return batch;

	batch = markGenerating(batch, itemId);
	await deps.save(batch);

	const gen = await deps.generateDraft(item.topic, item.facts, item.enrichment);
	if (!gen.ok) {
		batch = markGenerateFailed(batch, itemId, gen.error);
		await deps.save(batch);
		return batch;
	}

	// 封面回注:批次创建时持久化的 item.coverImageUrl(生成恒置 '');旧批次无此字段则优雅降级。
	const draft = item.coverImageUrl
		? { ...gen.draft, coverImageUrl: item.coverImageUrl }
		: gen.draft;
	// retry 无重写流程,draft 即原稿;刷新快照使重试后新原稿成为 gate 判据。
	batch = markFilled(
		batch,
		itemId,
		draft,
		undefined,
		undefined,
		undefined,
		draft,
		gen.slots,
	);
	batch = presentForApproval(batch);
	await deps.save(batch); // flush approval-ready state
	return batch;
}
