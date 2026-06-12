import type {
	ContentDraft,
	FactsBlock,
	FieldFillResult,
} from "@51publisher/shared";
import {
	type Batch,
	type BatchItem,
	type BatchItemStatus,
	isTerminal,
	recoverBatch,
	TERMINAL,
} from "@51publisher/shared";

export type { Batch, BatchItem, BatchItemStatus };
export { isTerminal, recoverBatch, TERMINAL };

// 批量发布队列状态机(纯函数,无副作用/不碰 chrome)。
// background 拿它做编排,把异步效果(生成/填充/发布)的结果喂进来推进状态。
//
// 注意:后台只有**一个**新增表单,N 条草稿不能同时填进去(会互相覆盖)。
// 故批量在生成阶段**存草稿**(item.draft),审核看存的草稿数据;批准时再逐条
// 填进表单 → 发布。'filled' 在此语境 = "草稿已生成、待审",真正的表单填充发生在发布前。
//
// 安全脊柱(评审 reliability/adversarial 收敛):
//   - 幂等:发布前 background await 写 publish-dispatched,再发准许(见 publish-orchestrator)。
//   - 崩溃恢复:重启见 publish-dispatched 无回执 → needs-human-verification 隔离,**绝不自动重发**。
//   - 隔离退出:needs-human-verification 只能经显式人工动作离开;新批次不得重入已隔离同选题。
//   - 急停:KILL 把未发布项打到 aborted;已 confirmed 不回退;在途 dispatched 不动(在飞)。

export type BatchPhase =
	| "empty"
	| "generating"
	| "awaiting-approval"
	| "publishing"
	| "done";

export function createBatch(
	id: string,
	tabId: number,
	authorizedHost: string,
	topics: string[],
	now: string,
	genItemId: (index: number) => string,
	facts?: (FactsBlock | undefined)[],
	coverImageUrls?: (string | undefined)[],
	pendingTopicIds?: (string | undefined)[],
): Batch {
	return {
		id,
		tabId,
		authorizedHost,
		createdAt: now,
		items: topics.map((topic, i) => {
			const f = facts?.[i];
			const cover = coverImageUrls?.[i];
			const tid = pendingTopicIds?.[i];
			return {
				id: genItemId(i),
				topic,
				status: "queued" as const,
				...(f ? { facts: f } : {}),
				...(cover ? { coverImageUrl: cover } : {}),
				...(tid ? { pendingTopicId: tid } : {}),
			};
		}),
	};
}

/** 不可变更新某一项;patch 合并进该项。其余项不动。 */
function patchItem(
	batch: Batch,
	itemId: string,
	patch: Partial<BatchItem>,
): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.id === itemId ? { ...it, ...patch } : it,
		),
	};
}

/** 仅当该项处于 expected 状态之一才推进(否则原样返回,防越级转移)。 */
export function transition(
	batch: Batch,
	itemId: string,
	from: BatchItemStatus | BatchItemStatus[],
	patch: Partial<BatchItem>,
): Batch {
	const froms = Array.isArray(from) ? from : [from];
	const item = batch.items.find((it) => it.id === itemId);
	if (!item || !froms.includes(item.status)) return batch;
	return patchItem(batch, itemId, patch);
}

export function markGenerating(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "queued", {
		status: "generating",
		userEdited: false,
	});
}

export function markFilled(
	batch: Batch,
	itemId: string,
	draft: ContentDraft,
	llmCostTokens?: BatchItem["llmCostTokens"],
	generationDurationMs?: number,
	reviewMeta?: {
		triggered?: boolean;
		reviewCostTokens?: BatchItem["reviewCostTokens"];
	},
	assembledDraftSnapshot?: ContentDraft,
): Batch {
	return transition(batch, itemId, ["generating", "queued"], {
		status: "filled",
		draft,
		publishedDraft: { ...draft },
		...(assembledDraftSnapshot !== undefined
			? { assembledDraftSnapshot: { ...assembledDraftSnapshot } }
			: {}),
		...(llmCostTokens !== undefined ? { llmCostTokens } : {}),
		...(generationDurationMs !== undefined ? { generationDurationMs } : {}),
		// reviewMeta 为 undefined 时完全不写入，保持三态语义。
		...(reviewMeta?.triggered !== undefined
			? { aiReviewTriggered: reviewMeta.triggered }
			: {}),
		...(reviewMeta?.reviewCostTokens !== undefined
			? { reviewCostTokens: reviewMeta.reviewCostTokens }
			: {}),
	});
}

/** 记录填充结果(degrade 聚合数据源)。不改变状态,仅 patch fillResults。别名: markFillResultsRecorded。 */
export function storeFillResults(
	batch: Batch,
	itemId: string,
	fillResults: FieldFillResult[],
): Batch {
	return patchItem(batch, itemId, { fillResults });
}

export function markGenerateFailed(
	batch: Batch,
	itemId: string,
	error: string,
): Batch {
	// 单条生成/填充失败标 error,不阻断其余。
	return transition(batch, itemId, ["queued", "generating", "filled"], {
		status: "error",
		error,
	});
}

/**
 * 接地闸门拦截:filled → gate-failed。
 * 草稿内容存在【待补】占位符或无来源链接时触发,用户可重新生成（retryFromGateFailed）。
 * gate-failed 不进 TERMINAL,可重试。
 */
export function markGateFailed(
	batch: Batch,
	itemId: string,
	gateFailReason: string,
): Batch {
	return transition(batch, itemId, "filled", {
		status: "gate-failed",
		gateFailReason,
	});
}

/**
 * 用户点"重新生成"后从 gate-failed 退回 queued。
 * 清除 gateFailReason 和 fillResults,重置为初始待生成状态。
 */
export function retryFromGateFailed(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "gate-failed", {
		status: "queued",
		gateFailReason: undefined,
		fillResults: undefined,
	});
}

/** 全部 filled 项 → awaiting-approval(批量呈现给人审)。 */
export function presentForApproval(batch: Batch): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.status === "filled"
				? { ...it, status: "awaiting-approval" as const }
				: it,
		),
	};
}

/** 填充完成后记录每字段结果(不改 status;不限制 from,任意非 terminal 状态均可更新)。 */
export function markFillResultsRecorded(
	batch: Batch,
	itemId: string,
	fillResults: FieldFillResult[],
): Batch {
	return patchItem(batch, itemId, { fillResults });
}

/**
 * 批量覆盖草稿(人工编辑路径,U7)。
 * overrides 键为 itemId,值为人工编辑后的完整草稿;仅覆盖 awaiting-approval 状态的条目。
 */
export function patchBatchDrafts(
	batch: Batch,
	overrides: Record<string, ContentDraft>,
): Batch {
	if (Object.keys(overrides).length === 0) return batch;
	return {
		...batch,
		items: batch.items.map((it) =>
			it.status === "awaiting-approval" && it.id in overrides
				? { ...it, draft: overrides[it.id] }
				: it,
		),
	};
}

export function markDispatched(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "awaiting-approval", {
		status: "publish-dispatched",
	});
}

export function markConfirmed(
	batch: Batch,
	itemId: string,
	publishUrl?: string,
): Batch {
	return transition(batch, itemId, "publish-dispatched", {
		status: "publish-confirmed",
		...(publishUrl ? { publishUrl } : {}),
	});
}

/** 已回执但确未触发(no-publish-target / content-unreachable)→ 清回 error,不隔离。 */
export function markPublishFailed(
	batch: Batch,
	itemId: string,
	error: string,
): Batch {
	return transition(batch, itemId, "publish-dispatched", {
		status: "error",
		error,
	});
}

/** 急停:未发布项 → aborted;已 confirmed/terminal 不回退;在途 dispatched 不动(在飞)。 */
export function abortBatch(batch: Batch): Batch {
	const ABORTABLE: ReadonlySet<BatchItemStatus> = new Set([
		"queued",
		"generating",
		"filled",
		"gate-failed",
		"awaiting-approval",
	]);
	return {
		...batch,
		items: batch.items.map((it) =>
			ABORTABLE.has(it.status) ? { ...it, status: "aborted" as const } : it,
		),
	};
}

/** 显式人工退出隔离(人工已在后台核对)→ aborted 终态,v1 不自动重发。 */
export function releaseQuarantine(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "needs-human-verification", {
		status: "aborted",
		error: "quarantine-released",
	});
}

/**
 * 运营商强制重试单条 error/aborted 条目。
 * 直接调用 patchItem 绕过 transition 守卫 — 这是显式的运营商操作路径,
 * 只能经由 RETRY_BATCH_ITEM 消息触发。
 * error 和 aborted 仍在 TERMINAL 中,对所有自动化路径保持不可变。
 */
export function retryBatchItem(batch: Batch, itemId: string): Batch {
	return patchItem(batch, itemId, {
		status: "queued",
		error: undefined,
		fillResults: undefined,
	});
}

/** 已隔离项的选题集合(新批次须排除,防自动重入同选题)。 */
export function quarantinedTopics(batch: Batch): string[] {
	return batch.items
		.filter((it) => it.status === "needs-human-verification")
		.map((it) => it.topic);
}

/** 从候选选题里剔除被隔离的同选题(去重保序)。 */
export function filterReentrantTopics(
	topics: string[],
	blocked: string[],
): string[] {
	const blockedSet = new Set(blocked);
	return topics.filter((t) => !blockedSet.has(t));
}

export function batchPhase(batch: Batch): BatchPhase {
	if (batch.items.length === 0) return "empty";
	const statuses = batch.items.map((it) => it.status);
	if (statuses.some((s) => s === "queued" || s === "generating"))
		return "generating";
	if (statuses.some((s) => s === "publish-dispatched")) return "publishing";
	// gate-failed 视为待人工处理（可重试），与 filled/awaiting-approval 同属审批阶段。
	if (
		statuses.some(
			(s) => s === "filled" || s === "awaiting-approval" || s === "gate-failed",
		)
	)
		return "awaiting-approval";
	return "done"; // 全部 terminal
}

export interface BatchSummary {
	total: number;
	awaitingApproval: number;
	confirmed: number;
	errored: number;
	quarantined: number;
	aborted: number;
}

export function batchSummary(batch: Batch): BatchSummary {
	const count = (s: BatchItemStatus) =>
		batch.items.filter((it) => it.status === s).length;
	return {
		total: batch.items.length,
		awaitingApproval: count("awaiting-approval"),
		confirmed: count("publish-confirmed"),
		errored: count("error"),
		quarantined: count("needs-human-verification"),
		aborted: count("aborted"),
	};
}
