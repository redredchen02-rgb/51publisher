import type { FactsBlock, GenerateDraftResponse } from "@51publisher/shared";
import type { Batch } from "./batch";
import {
	markFilled,
	markGenerateFailed,
	markGenerating,
	presentForApproval,
	retryBatchItem,
	transition,
} from "./batch";

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
