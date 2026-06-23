import type {
	ContentDraft,
	FactsBlock,
	GenerateDraftResponse,
} from "@51publisher/shared";
import type { Batch } from "./batch";
import {
	createBatch,
	filterReentrantTopics,
	markFilled,
	markGateFailed,
	markGenerateFailed,
	markGenerating,
	presentForApproval,
	quarantinedTopics,
} from "./batch";
import type { GroundingVerdict } from "./grounding-gate";
import { evaluateGrounding as defaultEvaluateGrounding } from "./grounding-gate";
import type { ReviewDraftResponse, RewriteDraftResponse } from "./llm";
import { mergeRewriteResult } from "./llm";

/**
 * 生成阶段并发度:每条 item 的 LLM 工作(generate + review + rewrite)彼此独立,
 * 并发跑可把大批量(100 条 ~1h)压到 ~15min。配合 LLM 层既有 429/5xx 退避,3 路并发对供应商 rate-limit 友好。
 */
const GENERATION_CONCURRENCY = 3;

/**
 * 串行互斥队列:把并发 worker 的状态变更逐个排队执行,保证对共享 batch 累积态的「读→改→save」原子化,
 * 避免多个 worker 持过期 batch 互相覆盖。返回的函数 await 即等到本次变更落盘。
 */
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
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
		qualityScore?: number,
		recommendedTags?: string[],
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
