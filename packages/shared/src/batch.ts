import type { FactsBlock } from "./facts.js";
import type { ContentDraft, FieldFillResult } from "./types.js";

export type BatchItemStatus =
	| "queued"
	| "generating"
	| "filled"
	| "gate-failed"
	| "awaiting-approval"
	| "publish-dispatched"
	| "publish-confirmed"
	| "needs-human-verification"
	| "aborted"
	| "error";

export interface BatchItem {
	id: string;
	topic: string;
	facts?: FactsBlock;
	status: BatchItemStatus;
	coverImageUrl?: string;
	draft?: ContentDraft;
	publishUrl?: string;
	error?: string;
	fillResults?: FieldFillResult[];
	userEdited?: boolean;
	llmCostTokens?: { prompt: number; completion: number; estimated?: boolean };
	generationDurationMs?: number;
	publishedDraft?: ContentDraft;
	aiReviewTriggered?: boolean;
	reviewCostTokens?: {
		prompt: number;
		completion: number;
		estimated?: boolean;
	};
	gateFailReason?: string;
	assembledDraftSnapshot?: ContentDraft;
	pendingTopicId?: string;
}

export interface Batch {
	id: string;
	tabId: number;
	authorizedHost: string;
	items: BatchItem[];
	createdAt: string;
	updatedAt?: string;
}

export const TERMINAL: ReadonlySet<BatchItemStatus> = new Set([
	"publish-confirmed",
	"aborted",
	"error",
	"needs-human-verification",
]);

export function isTerminal(s: BatchItemStatus): boolean {
	return TERMINAL.has(s);
}

export function recoverBatch(batch: Batch): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.status === "publish-dispatched"
				? {
						...it,
						status: "needs-human-verification" as const,
						error: "recovered-dispatched-no-confirm",
					}
				: it,
		),
	};
}
