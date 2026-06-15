import type { ContentDraft, SafetyMode } from "@51publisher/shared";
import { type FactsBlock, parseTopicLine } from "@51publisher/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser, storage } from "#imports";
import type { Batch } from "../../lib/batch";
import { batchPhase } from "../../lib/batch";
import {
	approveBatch,
	checkSelectors,
	discardBatchItem,
	getBatchState,
	killBatch,
	markItemEdited,
	refillItemFacts,
	releaseQuarantine,
	releaseQuarantineBatch,
	resolveAdminTabId,
	retryBatchItemMsg,
	runBatch,
} from "../../lib/messaging";
import type { DriftReport } from "../../lib/selectors";
import {
	addFewShotPair,
	clearPendingQuarantineAlert,
	getPendingQuarantineAlert,
	getSafetyMode,
	setSafetyMode as persistSafetyMode,
	removeLastFewShotPair,
} from "../../lib/storage";
import { BatchReviewPanel } from "./BatchReviewPanel";
import { BatchResultSummary } from "./components/BatchResultSummary";
import { DryRunReport } from "./DryRunReport";
import { HistoryPanel } from "./HistoryPanel";

export function BatchView({ onBack }: { onBack: () => void }) {
	const [batch, setBatch] = useState<Batch | null>(null);
	const [safetyMode, setSafetyMode] = useState<SafetyMode>("off");
	const [tabHealthy, setTabHealthy] = useState(true);
	const [topics, setTopics] = useState("");
	const [busy, setBusy] = useState(false);
	const [drift, setDrift] = useState<DriftReport | null>(null);
	const [error, setError] = useState("");
	const [view, setView] = useState<"batch" | "history">("batch");
	const [quarantineAlert, setQuarantineAlert] = useState(0);
	const [draftOverrides, setDraftOverrides] = useState<
		Map<string, ContentDraft>
	>(new Map());
	const [toast, setToast] = useState<{
		message: string;
		undoable: boolean;
	} | null>(null);
	const [readItems, setReadItems] = useState<Set<string>>(new Set());
	const savingItems = useRef(new Set<string>());
	const toastTimer = useRef<number | null>(null);
	const [operationResults, _setOperationResults] = useState<
		Array<{ id: string; success: boolean; error?: string }>
	>([]);

	const refresh = useCallback(async () => {
		const [b, mode, alertCount] = await Promise.all([
			getBatchState(),
			getSafetyMode(),
			getPendingQuarantineAlert(),
		]);
		setSafetyMode(mode);
		setBatch(b);
		setQuarantineAlert(alertCount);
		if (b) {
			try {
				const tab = await browser.tabs.get(b.tabId);
				const host = tab?.url ? new URL(tab.url).hostname : "";
				setTabHealthy(host === b.authorizedHost);
			} catch {
				setTabHealthy(false);
			}
		}
	}, []);

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		void refresh();

		const unwatch = storage.watch<import("../../lib/batch").Batch | null>(
			"local:batch",
			(newBatch) => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => {
					setBatch(newBatch ?? null);
				}, 100);
			},
		);

		return () => {
			unwatch();
			if (debounceRef.current) clearTimeout(debounceRef.current);
			if (toastTimer.current !== null) clearTimeout(toastTimer.current);
		};
	}, [refresh]);

	async function withBusy(fn: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await fn();
		} catch (e) {
			setError(e instanceof Error ? e.message : "操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	function showToast(message: string, undoable: boolean) {
		if (toastTimer.current !== null) clearTimeout(toastTimer.current);
		setToast({ message, undoable });
		toastTimer.current = window.setTimeout(() => setToast(null), 5000);
	}

	async function handleSaveAsFewShot(itemId: string) {
		if (savingItems.current.has(itemId)) return;
		const b = batch;
		if (!b) return;
		const item = b.items.find((it) => it.id === itemId);
		if (!item?.draft) return;
		savingItems.current.add(itemId);
		try {
			const result = await addFewShotPair({
				input: item.topic,
				output: item.draft.body,
			});
			if (!result.ok) {
				showToast("范例已满（8/8），请先在设置中删除旧条目", false);
				return;
			}
			showToast("已保存为范例", true);
		} catch (e) {
			showToast(e instanceof Error ? e.message : "保存范例失败", false);
		} finally {
			savingItems.current.delete(itemId);
		}
	}

	async function handleUndoFewShot() {
		await removeLastFewShotPair();
		setToast(null);
	}

	const onItemRead = useCallback((id: string) => {
		setReadItems((prev) => {
			const n = new Set(prev);
			n.add(id);
			return n;
		});
	}, []);

	const onDiscardItem = useCallback(
		(
			itemId: string,
			rejectionReason?: import("@51publisher/shared").RejectionReason,
		) => {
			setBusy(true);
			setError("");
			discardBatchItem(itemId, rejectionReason)
				.then(() => refresh())
				.catch(() => setError("操作失败,请重试。"))
				.finally(() => setBusy(false));
		},
		[refresh],
	);

	async function handleStart() {
		const byTopic = new Map<string, FactsBlock>();
		for (const line of topics.split("\n")) {
			const p = parseTopicLine(line);
			if (p && !byTopic.has(p.topic)) byTopic.set(p.topic, p.facts);
		}
		const list = [...byTopic.keys()];
		const factsList = [...byTopic.values()];
		if (list.length === 0) {
			setError("请先输入选题(每行一条)。");
			return;
		}
		await withBusy(async () => {
			const adminTabId = await resolveAdminTabId();
			if (adminTabId == null) {
				setError("未找到后台发帖页标签——请先打开后台发帖页。");
				return;
			}
			await runBatch(list, adminTabId, factsList);
			setTopics("");
			await refresh();
		});
	}

	async function handleIterate() {
		if (!batch) return;
		await withBusy(async () => {
			const list = batch.items.map((it) => it.topic);
			const factsList = batch.items.map((it) => it.facts ?? {});
			await runBatch(list, batch.tabId, factsList, undefined, true);
			await refresh();
		});
	}

	const showStarter =
		view === "batch" &&
		(!batch || batchPhase(batch) === "done" || batchPhase(batch) === "empty");
	const batchActive =
		batch && batchPhase(batch) !== "done" && batchPhase(batch) !== "empty";

	const awaitingApprovalItems = batch
		? batch.items.filter((it) => it.status === "awaiting-approval")
		: [];
	const allRead =
		awaitingApprovalItems.length > 0 &&
		awaitingApprovalItems.every((it) => readItems.has(it.id));
	const readCount = awaitingApprovalItems.filter((it) =>
		readItems.has(it.id),
	).length;

	return (
		<main
			className="fade-in"
			style={{
				fontFamily: "system-ui, sans-serif",
				padding: "var(--space-lg)",
				fontSize: "var(--font-md)",
			}}
		>
			<nav className="flex-between mb-md">
				<div className="flex gap-sm" style={{ alignItems: "center" }}>
					<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>批量发布</h1>
					<button
						type="button"
						onClick={() => setView("batch")}
						className={`tab-btn ${view === "batch" ? "active" : ""}`}
					>
						批次{batchActive ? " •" : ""}
					</button>
					<button
						type="button"
						onClick={() => setView("history")}
						className={`tab-btn ${view === "history" ? "active" : ""}`}
					>
						历史
					</button>
				</div>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 单条
				</button>
			</nav>

			{error && (
				<p role="alert" className="text-error">
					{error}
				</p>
			)}

			{toast && (
				<div
					role="status"
					aria-live="polite"
					className={toast.undoable ? "banner-success" : "banner-warning"}
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<span>{toast.message}</span>
					{toast.undoable && (
						<button
							type="button"
							onClick={() => void handleUndoFewShot()}
							className="btn-icon text-info"
							style={{
								fontSize: "var(--font-sm)",
								padding: "0 var(--space-sm)",
							}}
						>
							撤销
						</button>
					)}
				</div>
			)}

			{quarantineAlert > 0 && (
				<div className="banner-warning" role="alert">
					<div className="text-warning-deep font-semibold">
						⚠ {quarantineAlert} 条帖子在上次关机时状态不确定
					</div>
					<div
						className="text-warning-deep"
						style={{ fontSize: "var(--font-sm)", marginTop: "var(--space-xs)" }}
					>
						请前往「历史」面板核对后再继续。
					</div>
					<button
						type="button"
						onClick={() => {
							clearPendingQuarantineAlert().catch(() => {});
							setQuarantineAlert(0);
						}}
						className="btn btn-plain btn-sm"
						style={{
							marginTop: "var(--space-lg)",
							borderColor: "var(--color-warning-border)",
							color: "var(--color-warning-deep)",
						}}
					>
						我知道了
					</button>
				</div>
			)}

			{view === "history" && <HistoryPanel />}

			{view === "batch" && batch && batchPhase(batch) !== "empty" && (
				<>
					{batchPhase(batch) === "awaiting-approval" &&
						awaitingApprovalItems.length > 0 && (
							<div
								className={allRead ? "text-success" : "text-warning-deep"}
								style={{
									fontSize: "var(--font-sm)",
									marginBottom: "var(--space-lg)",
								}}
							>
								{allRead
									? "✓ 全部已读,可发布"
									: `已读 ${readCount}/${awaitingApprovalItems.length} 篇(请展开每条审阅后再发布)`}
							</div>
						)}
					{operationResults.length > 0 && (
						<BatchResultSummary results={operationResults} />
					)}
					<BatchReviewPanel
						batch={batch}
						draftOverrides={draftOverrides}
						safetyMode={safetyMode}
						authorizedHost={batch.authorizedHost}
						tabHealthy={tabHealthy}
						busy={busy}
						driftResult={drift}
						readItems={readItems}
						onItemRead={onItemRead}
						onDiscardItem={onDiscardItem}
						allRead={allRead}
						onModeChange={(mode) => {
							void persistSafetyMode(mode).then(() => refresh());
						}}
						onApprove={() =>
							void withBusy(async () => {
								const report = await checkSelectors(batch.tabId);
								setDrift(report);
								if (!report.ok) {
									setError(
										`选择器自检失败,缺失:${report.missing.join("、")}。请点"漂移自检"了解详情,或在目标页修复后重试。`,
									);
									return;
								}
								const overrides =
									draftOverrides.size > 0
										? Object.fromEntries(draftOverrides)
										: undefined;
								await approveBatch(batch.tabId, overrides);
								setDraftOverrides(new Map());
								await refresh();
							})
						}
						onApproveBypass={() =>
							void withBusy(async () => {
								const overrides =
									draftOverrides.size > 0
										? Object.fromEntries(draftOverrides)
										: undefined;
								await approveBatch(batch.tabId, overrides);
								setDraftOverrides(new Map());
								await refresh();
							})
						}
						onDraftChange={(itemId, draft) =>
							setDraftOverrides((prev) => new Map(prev).set(itemId, draft))
						}
						onRefillFacts={(itemId, facts) =>
							void withBusy(async () => {
								// U6:补全缺失事实 → 后台合并/重组装/重跑闸门;通过则提升到 awaiting-approval。
								// facts-refill 整稿重生 draft,故同时清掉该条的内联编辑覆盖(R11:refill 优先)。
								await refillItemFacts(itemId, facts);
								setDraftOverrides((prev) => {
									if (!prev.has(itemId)) return prev;
									const next = new Map(prev);
									next.delete(itemId);
									return next;
								});
								await refresh();
							})
						}
						onKill={() =>
							void withBusy(async () => {
								await killBatch();
								setDraftOverrides(new Map());
								await refresh();
							})
						}
						onRelease={(itemId) =>
							void withBusy(async () => {
								await releaseQuarantine(itemId);
								await refresh();
							})
						}
						onReleaseAll={() =>
							void withBusy(async () => {
								await releaseQuarantineBatch();
								await refresh();
							})
						}
						onRetryItem={(itemId) =>
							void withBusy(async () => {
								await retryBatchItemMsg(itemId);
								await refresh();
							})
						}
						onDriftCheck={() =>
							void withBusy(async () => {
								setDrift(await checkSelectors(batch.tabId));
							})
						}
						onResume={() => void refresh()}
						onItemEdited={(itemId) => {
							void (async () => {
								await markItemEdited(itemId);
								await refresh();
							})();
						}}
						onSaveAsFewShot={(itemId) => {
							void handleSaveAsFewShot(itemId);
						}}
					/>
				</>
			)}

			{view === "batch" &&
				batch &&
				batchPhase(batch) === "awaiting-approval" && (
					<div style={{ marginTop: "var(--space-md)" }}>
						<button
							type="button"
							onClick={() => void handleIterate()}
							disabled={busy}
							title="改了 Settings 的 prompt/few-shot 后,用同批题目重跑生成(只生成不发,可对比效果)"
							className="btn btn-plain btn-sm"
						>
							{busy ? "重跑中…" : "↻ 重跑生成(改 prompt 后对比)"}
						</button>
					</div>
				)}

			{view === "batch" && safetyMode === "dry-run" && <DryRunReport />}

			{showStarter && (
				<div style={{ marginTop: "var(--space-xl)" }}>
					<div
						className="text-secondary"
						style={{ marginBottom: "var(--space-sm)" }}
					>
						选题(每行一条);可附事实防幻觉:
						<code>选题 || 作品名=… | 集数=… | 漢化=… | 無修=…</code>
					</div>
					<textarea
						className="field-input"
						style={{ minHeight: 80 }}
						placeholder={
							"某里番作品介绍 || 作品名=◯◯◯ | 集数=6 | 漢化=https://… | 無修=https://…\n某新番看点(纯选题也行,缺的会标【待补】)"
						}
						value={topics}
						disabled={busy}
						onChange={(e) => setTopics(e.target.value)}
					/>
					<button
						type="button"
						onClick={() => void handleStart()}
						disabled={busy}
						className="btn btn-primary"
						style={{ marginTop: "var(--space-md)" }}
					>
						{busy ? "生成中…" : "开始批量(生成+填充)"}
					</button>
				</div>
			)}
		</main>
	);
}
