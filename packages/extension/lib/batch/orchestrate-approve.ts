import type {
	ContentDraft,
	DryRunItemResult,
	DryRunReport,
	FactsBlock,
	FieldFillResult,
	FillPageResponse,
	PublishResult,
} from "@51publisher/shared";
import type { Batch } from "../batch";
import {
	markConfirmed,
	markDispatched,
	markFillResultsRecorded,
	markGateFailed,
	markGenerateFailed,
	markPublishFailed,
} from "../batch";
import { computeSlotDiff } from "../draft-diff";
import type { GroundingVerdict } from "../grounding-gate";
import { logger } from "../logger";
import type { GateDecision } from "../publish-orchestrator";
import { isGateBlocked, orchestratePublish } from "../publish-orchestrator";
import type { PublishedPostRecord } from "../published-posts-client";
import type { TrajectoryInput } from "../trajectory";
import {
	defaultSnapshotDropped,
	type FirstFlightGuard,
} from "./first-flight-guard";

export interface ApproveBatchDeps {
	getBatch: () => Promise<Batch | null>;
	save: (batch: Batch) => Promise<void>;
	pinnedHostOk: (batch: Batch) => Promise<boolean>;
	sendFill: (draft: ContentDraft) => Promise<FillPageResponse>;
	evaluateGate: () => Promise<GateDecision>;
	sendGrant: () => Promise<PublishResult>;
	appendTrajectory: (
		input: TrajectoryInput,
	) => Promise<{ snapshotDropped: boolean }>;
	onSnapshotDropped?: (itemId: string) => void;
	saveDryRunReportFn?: (report: DryRunReport) => Promise<void>;
	writeTombstone?: (itemId: string) => Promise<void>;
	clearTombstone?: (itemId: string) => Promise<void>;
	checkGrounding?: (
		draft: ContentDraft,
		facts?: FactsBlock,
	) => GroundingVerdict;
	recordPost?: (record: PublishedPostRecord) => Promise<void>;
	now?: () => string;
	itemIdFilter?: string;
	firstFlightGuard?: FirstFlightGuard;
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
		firstFlightGuard,
	} = deps;

	const loaded = await getBatch();
	if (!loaded) return null;
	let batch: Batch = loaded;
	const dryRunItems: DryRunItemResult[] = [];

	for (const snapshot of batch.items) {
		if (itemIdFilter && snapshot.id !== itemIdFilter) continue;
		const item = batch.items.find((it) => it.id === snapshot.id);
		if (item?.status !== "awaiting-approval" || !item.draft) continue;
		if (!(await pinnedHostOk(batch))) break;

		// 发布前 grounding 硬闸:仅 authorized 档拦截
		if (checkGrounding) {
			const gate = await evaluateGate();
			if (gate.mode === "authorized") {
				if (!item.assembledDraftSnapshot) {
					batch = markGateFailed(
						batch,
						item.id,
						"缺发布快照(assembledDraftSnapshot),请重新生成后再发。",
					);
					await save(batch);
					continue;
				}
				const vSnapshot = checkGrounding(
					item.assembledDraftSnapshot,
					item.facts,
				);
				const vFinal = checkGrounding(item.draft, item.facts);
				if (!vSnapshot.ok || !vFinal.ok) {
					const reasons = [
						...new Set([...vSnapshot.reasons, ...vFinal.reasons]),
					];
					batch = markGateFailed(batch, item.id, reasons.join(" "));
					await save(batch);
					continue;
				}
			}
		}

		// 首飞互锁(fill 决策点)
		if (firstFlightGuard) {
			const gateForHost = await evaluateGate();
			const host = gateForHost.host;
			if (gateForHost.mode === "authorized") {
				if (host == null) continue;
				const fillVerdict = await firstFlightGuard({
					itemId: item.id,
					tabId: batch.tabId,
					host,
					draft: item.draft,
				});
				if (!fillVerdict.allowed) continue;
			}
		}

		// Tombstone 写在 sendFill 之前
		if (writeTombstone) {
			await writeTombstone(item.id).catch(() => {
				/* best-effort */
			});
		}

		const fill = await sendFill(item.draft);

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
		batch = markFillResultsRecorded(batch, item.id, fill.results);
		await save(batch);

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
			...(firstFlightGuard
				? {
						preGrantGuard: () =>
							firstFlightGuard({
								itemId: item.id,
								tabId: batch.tabId,
								host: "", // evaluateGate 會提供 host
								draft: item.draft ?? ({} as ContentDraft),
							}),
					}
				: {}),
			writeConfirmed: async (r: PublishResult) => {
				if (r.dryRun) return;
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
					}).catch(() =>
						logger.warn(
							"batch-orchestrate-approve",
							"recordPost 失败(best-effort)",
						),
					);
				}
			},
		});

		// dry-run 收集
		if (result.dryRun) {
			const cur = batch.items.find((it) => it.id === item.id);
			dryRunItems.push({
				itemId: item.id,
				topic: item.topic,
				fillResults: cur?.fillResults ?? fill.results,
				draftTitle: item.draft?.title,
			});
		}

		// 轨迹:authorized 真发(非 dry-run)才落档
		if (!result.dryRun) {
			const cur = batch.items.find((it) => it.id === item.id);
			const slotDiff =
				cur?.assembledDraftSnapshot && cur?.draft
					? computeSlotDiff(cur.assembledDraftSnapshot, cur.draft)
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

		if (!result.ok && isGateBlocked(result.error)) break;
	}

	// dry-run 结束:持久化填充报告
	if (dryRunItems.length > 0 && saveDryRunReportFn) {
		const report: DryRunReport = {
			batchId: batch.id,
			ts: new Date().toISOString(),
			items: dryRunItems,
		};
		saveDryRunReportFn(report).catch(() =>
			logger.warn(
				"batch-orchestrate-approve",
				"saveDryRunReport 失败(best-effort)",
			),
		);
	}

	return batch;
}
