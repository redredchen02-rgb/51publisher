import type { ContentDraft, FactsBlock, GenerateDraftResponse } from "@51publisher/shared";
import type { Batch } from "./batch";
import {
	markFilled,
	markGateFailed,
	markGenerateFailed,
	markGenerating,
	presentForApproval,
	retryBatchItem,
	transition,
} from "./batch";
import type { GroundingVerdict } from "./grounding-gate";

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

/** regenItemWithFacts 只需 RunBatchDeps 的子集(不含 review/rewrite)。 */
export interface RegenItemWithFactsDeps {
	getBatch: () => Promise<Batch | null>;
	save: (batch: Batch) => Promise<void>;
	generateDraft: (
		topic: string,
		facts?: FactsBlock,
		enrichment?: string,
	) => Promise<GenerateDraftResponse>;
	/** grounding 闸(可选):传入后成功生成的草稿必须通过闸才能进入 awaiting-approval;未传时跳过校验。 */
	evaluateGrounding?: (
		draft: ContentDraft,
		facts?: FactsBlock,
		qualityScore?: number,
		recommendedTags?: string[],
	) => GroundingVerdict;
}

/**
 * 操作者在 FactsEdit 修改事实后重新 LLM 生成草稿。
 *
 * 原子性不变式:generateDraft 成功后才一次 save 写入 facts+draft+snapshot;
 * 失败时 facts 不变(item → error)。
 *
 * 有效起始状态:gate-failed / awaiting-approval / filled。其余状态 no-op 返回原 batch。
 */
export async function regenItemWithFacts(
	deps: RegenItemWithFactsDeps,
	itemId: string,
	newFacts: FactsBlock,
): Promise<Batch | null> {
	const loaded = await deps.getBatch();
	if (!loaded) return null;

	const item = loaded.items.find((it) => it.id === itemId);
	if (!item) return loaded;

	// 仅允许从 gate-failed / awaiting-approval / filled 出发
	const REGEN_FROM = ["gate-failed", "awaiting-approval", "filled"] as const;
	type RegenFrom = (typeof REGEN_FROM)[number];
	if (!REGEN_FROM.includes(item.status as RegenFrom)) return loaded;

	// reset → queued → generating (两步 transition,复用既有守卫逻辑)
	let batch = transition(loaded, itemId, item.status as RegenFrom, {
		status: "queued" as const,
		gateFailReason: undefined,
		error: undefined,
	});
	batch = markGenerating(batch, itemId);
	await deps.save(batch);

	const gen = await deps.generateDraft(item.topic, newFacts, item.enrichment);
	if (!gen.ok) {
		// 失败:facts 不写入,item → error
		batch = markGenerateFailed(batch, itemId, gen.error);
		await deps.save(batch);
		return batch;
	}

	// 成功:原子写 facts+draft+snapshot (一次 save,不可分割)
	const draft = item.coverImageUrl
		? { ...gen.draft, coverImageUrl: item.coverImageUrl }
		: gen.draft;
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
	// 把 newFacts 注入同一批次对象(在 save 之前,保证原子性)
	batch = {
		...batch,
		items: batch.items.map((it) =>
			it.id === itemId ? { ...it, facts: newFacts } : it,
		),
	};

	// grounding 闸:若调用方注入了 evaluateGrounding,对新草稿运行一次闸检查。
	// 通过 → presentForApproval;失败 → markGateFailed(facts 仍已写入;操作者可再次 FactsEdit)。
	if (deps.evaluateGrounding) {
		const verdict = deps.evaluateGrounding(draft, newFacts);
		if (!verdict.ok) {
			batch = markGateFailed(batch, itemId, verdict.reasons.join(" "));
			await deps.save(batch);
			return batch;
		}
	}

	batch = presentForApproval(batch);
	await deps.save(batch);
	return batch;
}

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
