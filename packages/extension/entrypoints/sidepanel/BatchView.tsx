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
	releaseQuarantine,
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
	removeLastFewShotPair,
} from "../../lib/storage";
import { BatchReviewPanel } from "./BatchReviewPanel";
import { DryRunReport } from "./DryRunReport";
import { HistoryPanel } from "./HistoryPanel";

const btn: React.CSSProperties = {
	padding: "6px 12px",
	fontSize: 13,
	border: "none",
	borderRadius: 4,
	cursor: "pointer",
};

// 容器:持有批次状态 + 接 messaging;展示交给 BatchReviewPanel(已单测)。
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
	// 人工编辑覆盖(transient;panel reload 后丢失,属已知可接受行为)。
	const [draftOverrides, setDraftOverrides] = useState<
		Map<string, ContentDraft>
	>(new Map());
	const [toast, setToast] = useState<{
		message: string;
		undoable: boolean;
	} | null>(null);
	// U4 已读门控:记录操作者已展开过的 awaiting-approval 条目 id。
	const [readItems, setReadItems] = useState<Set<string>>(new Set());
	const savingItems = useRef(new Set<string>());
	const toastTimer = useRef<number | null>(null);

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
			// tab 健康:钉住的 tab 是否仍停在记录的授权 host。
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

		// storage.watch: background 每次 save(batch) 后推送变更 → 实时更新 UI,无需轮询。
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
		};
	}, [refresh]);

	async function withBusy(fn: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await fn();
		} catch {
			setError("操作失败,请重试。");
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
		// 每行解析"选题 || 事实块"(源接地);按 topic 去重保序,facts 与 topics 同序平行。
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
			// 按 host 全窗口定位发帖页,不赌「当前活动标签」(side panel/DevTools 抢焦点会钉错 tab)。
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

	// R8 迭代:改 prompt/few-shot 后,用当前批次的题目+事实"只生成不发"重跑(绕重入闸)。
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

	// U4 已读门控:只在 awaiting-approval 阶段生效。
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
			style={{ fontFamily: "system-ui, sans-serif", padding: 12, fontSize: 14 }}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<div style={{ display: "flex", gap: 4, alignItems: "center" }}>
					<h1 style={{ fontSize: 16, margin: 0 }}>批量发布</h1>
					<button
						onClick={() => setView("batch")}
						style={{
							...btn,
							padding: "2px 8px",
							fontSize: 12,
							background: view === "batch" ? "#1677ff" : "#f0f0f0",
							color: view === "batch" ? "#fff" : "#333",
						}}
					>
						批次{batchActive ? " •" : ""}
					</button>
					<button
						onClick={() => setView("history")}
						style={{
							...btn,
							padding: "2px 8px",
							fontSize: 12,
							background: view === "history" ? "#1677ff" : "#f0f0f0",
							color: view === "history" ? "#fff" : "#333",
						}}
					>
						历史
					</button>
				</div>
				<button
					onClick={onBack}
					style={{
						...btn,
						background: "#f0f0f0",
						color: "#333",
						padding: "4px 10px",
					}}
				>
					← 单条
				</button>
			</div>

			{error && (
				<p role="alert" style={{ color: "#cf1322", fontSize: 13 }}>
					{error}
				</p>
			)}

			{toast && (
				<div
					role="status"
					aria-live="polite"
					style={{
						background: toast.undoable ? "#f6ffed" : "#fff7e6",
						border: `1px solid ${toast.undoable ? "#b7eb8f" : "#ffd591"}`,
						borderRadius: 4,
						padding: "6px 10px",
						fontSize: 12,
						marginBottom: 8,
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
							style={{
								border: "none",
								background: "none",
								cursor: "pointer",
								fontSize: 12,
								color: "#1677ff",
								padding: "0 4px",
							}}
						>
							撤销
						</button>
					)}
				</div>
			)}

			{quarantineAlert > 0 && (
				<div
					role="alert"
					style={{
						background: "#fff7e6",
						border: "1px solid #ffd591",
						borderRadius: 6,
						padding: "8px 10px",
						marginBottom: 8,
						fontSize: 13,
					}}
				>
					<div style={{ color: "#874d00", fontWeight: 600 }}>
						⚠ {quarantineAlert} 条帖子在上次关机时状态不确定
					</div>
					<div style={{ color: "#874d00", fontSize: 12, marginTop: 2 }}>
						请前往「历史」面板核对后再继续。
					</div>
					<button
						onClick={() => {
							clearPendingQuarantineAlert().catch(() => {});
							setQuarantineAlert(0);
						}}
						style={{
							...btn,
							marginTop: 6,
							padding: "2px 8px",
							fontSize: 12,
							background: "#fff",
							border: "1px solid #ffd591",
							color: "#874d00",
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
								style={{
									fontSize: 12,
									color: allRead ? "#389e0d" : "#874d00",
									marginBottom: 6,
								}}
							>
								{allRead
									? "✓ 全部已读,可发布"
									: `已读 ${readCount}/${awaitingApprovalItems.length} 篇(请展开每条审阅后再发布)`}
							</div>
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
						onApprove={() =>
							void withBusy(async () => {
								// 批准前先做选择器漂移自检(U2):任何关键选择器缺失 → 阻断并展示警告,等人工处理。
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
					<div style={{ marginTop: 8 }}>
						<button
							onClick={() => void handleIterate()}
							disabled={busy}
							title="改了 Settings 的 prompt/few-shot 后,用同批题目重跑生成(只生成不发,可对比效果)"
							style={{
								...btn,
								background: "#f0f0f0",
								color: "#333",
								fontSize: 12,
								padding: "4px 10px",
							}}
						>
							{busy ? "重跑中…" : "↻ 重跑生成(改 prompt 后对比)"}
						</button>
					</div>
				)}

			{view === "batch" && safetyMode === "dry-run" && <DryRunReport />}

			{showStarter && (
				<div style={{ marginTop: 12 }}>
					<div style={{ fontSize: 13, color: "#555", marginBottom: 4 }}>
						选题(每行一条);可附事实防幻觉:
						<code>选题 || 作品名=… | 集数=… | 漢化=… | 無修=…</code>
					</div>
					<textarea
						style={{
							width: "100%",
							boxSizing: "border-box",
							minHeight: 80,
							padding: 6,
							fontSize: 13,
							border: "1px solid #d9d9d9",
							borderRadius: 4,
						}}
						placeholder={
							"某里番作品介绍 || 作品名=◯◯◯ | 集数=6 | 漢化=https://… | 無修=https://…\n某新番看点(纯选题也行,缺的会标【待补】)"
						}
						value={topics}
						disabled={busy}
						onChange={(e) => setTopics(e.target.value)}
					/>
					<button
						onClick={() => void handleStart()}
						disabled={busy}
						style={{
							...btn,
							background: "#1677ff",
							color: "#fff",
							marginTop: 8,
						}}
					>
						{busy ? "生成中…" : "开始批量(生成+填充)"}
					</button>
				</div>
			)}
		</main>
	);
}
