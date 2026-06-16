import type {
	ContentDraft,
	DryRunItemResult,
	DryRunReport,
	FactsBlock,
	FillPageResponse,
	PublishResult,
} from "@51publisher/shared";
import type { Batch } from "./batch";
import {
	markConfirmed,
	markDispatched,
	markFillResultsRecorded,
	markGateFailed,
	markGenerateFailed,
	markPublishFailed,
} from "./batch";
import { computeSlotDiff } from "./draft-diff";
import type { GroundingVerdict } from "./grounding-gate";
import { logger } from "./logger";
import type { GateDecision } from "./publish-orchestrator";
import { isGateBlocked, orchestratePublish } from "./publish-orchestrator";
import type { PublishedPostRecord } from "./published-posts-client";
import type { TrajectoryInput } from "./trajectory";

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
	/**
	 * 首飞互锁守卫(Unit 5):省略=不启用(无标记场景零行为变更)。
	 * 在 fill 决策点 AND grant 前各求值一次(每次重读标记 close TOCTOU)。
	 * allowed=false → 跳过本条(既不 fill 也不 grant),无 fill 副作用、无 grant 泄漏。
	 */
	firstFlightGuard?: (
		ctx: FirstFlightDispatch,
	) => Promise<{ allowed: boolean }>;
}

/** 传给互锁守卫的一笔意图身份(host 由 evaluateGate 给出)。 */
export interface FirstFlightDispatch {
	itemId: string;
	tabId: number;
	host: string;
	draft: ContentDraft;
}

function defaultSnapshotDropped(itemId: string): void {
	logger.warn("batch-orchestrator", "轨迹快照含机密被丢弃", { itemId });
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
		// 每轮从最新 batch 取该项当前状态(前面的转移可能已变)。
		const item = batch.items.find((it) => it.id === snapshot.id);
		if (item?.status !== "awaiting-approval" || !item.draft) continue;
		if (!(await pinnedHostOk(batch))) break;

		// 发布前 grounding 硬闸:仅 authorized 档拦截。
		// 闸必须覆盖「实际将发布的 artifact」—— sendFill 填的是 item.draft(含手编)。
		// 故对 snapshot(防 AI 重写洗【待补】,见 2026-06-11 修复)与最终 draft(防手编注入)
		// 各求值一次,任一不过即拦;snapshot 缺失 fail-closed 直接拦,不回退可编辑 draft。
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

		// 首飞互锁(fill 决策点):标记在场且本条与标记不全等 → 跳过本条(既不 fill 也不 grant)。
		// host 取自闸门判决(背景从 chrome.tabs.get 取),绝不接受消息携带的 host。
		// P0:APPROVE_BATCH 无 filter 会遍历整批,每条非匹配项的 fill 与 grant 都在此被拦。
		if (firstFlightGuard) {
			const gateForHost = await evaluateGate();
			const host = gateForHost.host;
			if (gateForHost.mode === "authorized") {
				if (host == null) continue; // host 不可达 → 不 fill(fail-closed)
				const fillVerdict = await firstFlightGuard({
					itemId: item.id,
					tabId: batch.tabId,
					host,
					draft: item.draft,
				});
				if (!fillVerdict.allowed) continue; // 互锁拦截:无 fill 副作用、无 grant 泄漏
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
			...(firstFlightGuard
				? {
						preGrantGuard: async () => {
							// grant 前重读标记 + 重解析 host(close TOCTOU)。
							const g = await evaluateGate();
							if (g.mode !== "authorized") return { allowed: false };
							if (g.host == null) return { allowed: false };
							const cur = batch.items.find((it) => it.id === item.id);
							const draft = cur?.draft ?? item.draft;
							if (!draft) return { allowed: false };
							return firstFlightGuard({
								itemId: item.id,
								tabId: batch.tabId,
								host: g.host,
								draft,
							});
						},
					}
				: {}),
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
					}).catch(() =>
						logger.warn("batch-orchestrator", "recordPost 失败(best-effort)"),
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
			// 计算 slotDiff:比较 AI 原稿快照(assembledDraftSnapshot)与最终发布草稿(draft)。
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

		// blocked → 暂停,不继续后续条目。
		if (!result.ok && isGateBlocked(result.error)) break;
	}

	// dry-run 结束:持久化填充报告(best-effort,失败不抛出)。
	if (dryRunItems.length > 0 && saveDryRunReportFn) {
		const report: DryRunReport = {
			batchId: batch.id,
			ts: new Date().toISOString(),
			items: dryRunItems,
		};
		saveDryRunReportFn(report).catch(() =>
			logger.warn("batch-orchestrator", "saveDryRunReport 失败(best-effort)"),
		);
	}

	return batch;
}
