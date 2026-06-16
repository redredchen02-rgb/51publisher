import { useEffect, useRef, useState } from "react";
import { isAuthenticated } from "../../lib/auth-client";
import { getBatchState, resolveAdminTabId } from "../../lib/messaging";
import { DEFAULT_RECIPE } from "../../lib/recipe";
import { getCurrentDraft, getSettings } from "../../lib/storage";
import { AuthView } from "./AuthView";
import { BatchView } from "./BatchView";
import { ErrorDisplay } from "./components/ErrorDisplay";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { ProgressBar } from "./components/ProgressBar";
import { Toast } from "./components/Toast";
import { DraftPreview } from "./DraftPreview";
import { ErrorLogPanel } from "./ErrorLogPanel";
import { FillResultPanel } from "./FillResultPanel";
import { FirstFlightWizard } from "./FirstFlightWizard";
import { GossipView } from "./GossipView";
import { useAutoSave } from "./hooks/useAutoSave";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useMainDraftFlow } from "./hooks/useMainDraftFlow";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { MetricsPanel } from "./MetricsPanel";
import { PendingTopicsView } from "./PendingTopicsView";
import { Settings } from "./Settings";
import { TodayBatchView } from "./TodayBatchView";
import { WorkflowNav } from "./WorkflowNav";

export function App() {
	const [view, setView] = useState<
		| "main"
		| "settings"
		| "batch"
		| "pending"
		| "today"
		| "auth"
		| "gossip"
		| "firstflight"
		| "metrics"
	>("main");
	const [ffEntry, setFfEntry] = useState<{
		tabId: number;
		host: string;
		itemId: string;
	} | null>(null);
	const { error, handleError, clearError } = useErrorHandler();
	const { logs, logError, retrieveLogs, clearLogs, exportLogs } =
		useErrorLogger();
	const [showLogs, setShowLogs] = useState(false);
	const { recordOperation } = useOperationHistory();
	const [toast, setToast] = useState<{
		message: string;
		type: "success" | "error" | "info";
	} | null>(null);
	const [authenticated, setAuthenticated] = useState(false);
	const [authChecking, setAuthChecking] = useState(true);
	const loadingState = useLoadingState();
	const { saveDraft } = useAutoSave();
	const initRef = useRef(false);

	const draftFlow = useMainDraftFlow({
		handleError,
		logError,
		recordOperation: (op) => {
			recordOperation({
				type: op.type as never,
				topic: op.topic,
				success: op.success,
				details: op.details,
			});
		},
		loadingState,
		saveDraft,
		onToast: (msg, type) => setToast({ message: msg, type }),
	});

	useEffect(() => {
		if (initRef.current) return;
		initRef.current = true;
		void (async () => {
			const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
			if (saved) {
				draftFlow.setInitialDraft(saved, s.promptTemplate);
			}
			const authed = await isAuthenticated();
			setAuthenticated(authed);
			setView(authed ? "main" : "auth");
			setAuthChecking(false);
		})();
	}, [draftFlow]);

	// 首飞向导入口
	async function launchFirstFlight() {
		clearError();
		const tabId = await resolveAdminTabId();
		if (tabId == null) {
			handleError("未找到后台发帖页标签——请先在浏览器打开后台发帖页。");
			return;
		}
		const batch = await getBatchState();
		const item = batch?.items.find((it) => it.status === "awaiting-approval");
		if (!item) {
			handleError("当前批次没有待审条目可供首飞,请先生成并审核一条。");
			return;
		}
		setFfEntry({ tabId, host: DEFAULT_RECIPE.host, itemId: item.id });
		setView("firstflight");
	}

	useKeyboardShortcuts({
		onGenerate: draftFlow.handleGenerate,
		onFill: draftFlow.handleFill,
		onNext: draftFlow.handleNext,
		onSave: () => {
			if (draftFlow.draft) {
				saveDraft(draftFlow.draft, true);
			}
		},
	});

	if (authChecking) {
		return <Loading />;
	}

	if (view === "auth") {
		return (
			<Wrap>
				<AuthView
					onLogin={() => {
						setAuthenticated(true);
						setView("main");
					}}
				/>
			</Wrap>
		);
	}

	if (view === "settings")
		return (
			<Wrap>
				<Settings onClose={() => setView("main")} />
			</Wrap>
		);
	if (view === "batch") return <BatchView onBack={() => setView("main")} />;
	if (view === "today")
		return <TodayBatchView onBack={() => setView("main")} />;
	if (view === "pending")
		return (
			<PendingTopicsView
				onBack={() => setView("main")}
				onBatchStarted={() => setView("batch")}
				onError={(msg) => handleError(msg)}
			/>
		);
	if (view === "gossip")
		return (
			<Wrap>
				<GossipView
					onBack={() => setView("main")}
					onTopicAdded={() => setView("pending")}
				/>
			</Wrap>
		);

	if (view === "metrics")
		return <MetricsPanel onBack={() => setView("main")} />;

	if (view === "firstflight" && ffEntry)
		return (
			<FirstFlightWizard
				tabId={ffEntry.tabId}
				host={ffEntry.host}
				itemId={ffEntry.itemId}
				onBack={() => setView("main")}
			/>
		);

	const busy = draftFlow.mode === "generating" || draftFlow.mode === "filling";

	return (
		<Wrap>
			<header className="app-header">
				<div className="app-title-row">
					<div>
						<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>
							51publisher 填充助手
						</h1>
						<div className="text-sm text-secondary" style={{ marginTop: 3 }}>
							从选题到审核发布的一体化工作台
						</div>
					</div>
					<div className="app-actions">
						<button
							type="button"
							onClick={() => {
								if (!authenticated) setView("auth");
							}}
							className={`status-pill ${authenticated ? "success" : "error"}`}
							style={{
								cursor: authenticated ? "default" : "pointer",
								userSelect: "none",
							}}
						>
							{authenticated ? "已登录" : "未登录"}
						</button>
						<button
							type="button"
							onClick={() => setView("settings")}
							className="btn btn-plain btn-sm"
							aria-label="设置"
						>
							⚙ 设置
						</button>
						<KeyboardShortcutsHelp />
						<button
							type="button"
							onClick={() => {
								setShowLogs(!showLogs);
								if (!showLogs) void retrieveLogs();
							}}
							className="btn btn-plain btn-sm"
							aria-label="错误日志"
						>
							📋 日志
						</button>
					</div>
				</div>

				<WorkflowNav
					onToday={() => setView("today")}
					onGossip={() => setView("gossip")}
					onPending={() => setView("pending")}
					onBatch={() => setView("batch")}
					onFirstFlight={() => void launchFirstFlight()}
					onMetrics={() => setView("metrics")}
				/>
			</header>

			{/* Warning banner */}
			<div className="banner-warning" role="note">
				⚠️ 插件不会自动发布,请人工审核后手动发布。
			</div>

			{error && (
				<ErrorDisplay
					message={error}
					onRetry={() => {
						if (
							draftFlow.mode === "generating" ||
							draftFlow.mode === "empty" ||
							draftFlow.mode === "draft"
						) {
							draftFlow.handleGenerate();
						} else if (
							draftFlow.mode === "filling" ||
							draftFlow.mode === "filled" ||
							draftFlow.mode === "partial"
						) {
							draftFlow.handleFill();
						}
					}}
					onDismiss={clearError}
				/>
			)}

			{showLogs && (
				<ErrorLogPanel
					logs={logs}
					onExport={() => {
						const exported = exportLogs();
						void navigator.clipboard?.writeText(exported);
					}}
					onClear={() => void clearLogs()}
				/>
			)}

			{(draftFlow.mode === "empty" ||
				draftFlow.mode === "generating" ||
				(draftFlow.mode === "draft" && !draftFlow.draft)) && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<textarea
						className="field-input"
						style={{ minHeight: 60, padding: "var(--space-lg)" }}
						placeholder="输入选题/主题,例如:介绍某部新番的看点"
						value={draftFlow.topic}
						disabled={busy}
						onChange={(e) => draftFlow.setTopic(e.target.value)}
					/>
				</div>
			)}

			{draftFlow.mode === "generating" && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<ProgressBar
						progress={loadingState.progress}
						label={loadingState.message}
					/>
					<button
						type="button"
						onClick={draftFlow.cancelGenerate}
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-lg)" }}
					>
						取消
					</button>
				</div>
			)}

			{draftFlow.draft && draftFlow.mode !== "generating" && (
				<DraftPreview
					draft={draftFlow.draft}
					onChange={draftFlow.updateDraft}
				/>
			)}

			{draftFlow.mode === "filling" && (
				<div aria-live="polite" style={{ marginBottom: "var(--space-md)" }}>
					<ProgressBar progress={0} indeterminate />
					<div
						className="text-secondary"
						style={{ marginTop: "var(--space-sm)" }}
					>
						正在填充到当前页…
					</div>
				</div>
			)}

			{toast && (
				<Toast
					message={toast.message}
					type={toast.type}
					onClose={() => setToast(null)}
				/>
			)}

			{(draftFlow.mode === "filled" || draftFlow.mode === "partial") && (
				<FillResultPanel results={draftFlow.results} />
			)}

			{draftFlow.mode === "partial" && (
				<div
					style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)" }}
				>
					<button
						type="button"
						onClick={draftFlow.copyBody}
						className="btn btn-plain btn-sm"
					>
						复制正文
					</button>
					<span
						className="text-muted"
						style={{ marginLeft: "var(--space-md)" }}
					>
						正文可能需手动粘贴到编辑器。
					</span>
				</div>
			)}

			{draftFlow.confirmNext && (
				<div
					role="alert"
					className="text-error"
					style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)" }}
				>
					正文尚未确认填入,确定进入下一条?
					<button
						type="button"
						onClick={draftFlow.handleNext}
						className="btn btn-plain btn-sm"
						style={{ marginLeft: "var(--space-lg)" }}
					>
						确定
					</button>
					<button
						type="button"
						onClick={() => draftFlow.setConfirmNext?.(false)}
						className="btn btn-plain btn-sm"
						style={{ marginLeft: "var(--space-sm)" }}
					>
						取消
					</button>
				</div>
			)}

			<div
				style={{
					display: "flex",
					gap: "var(--space-md)",
					marginTop: "var(--space-xl)",
				}}
			>
				{(draftFlow.mode === "empty" ||
					draftFlow.mode === "generating" ||
					draftFlow.mode === "draft") && (
					<button
						type="button"
						onClick={draftFlow.handleGenerate}
						disabled={busy}
						className="btn btn-primary"
					>
						生成草稿
					</button>
				)}
				{draftFlow.draft &&
					(draftFlow.mode === "draft" ||
						draftFlow.mode === "filled" ||
						draftFlow.mode === "partial") && (
						<button
							type="button"
							onClick={draftFlow.handleFill}
							disabled={busy}
							className="btn btn-primary"
						>
							填充到当前页
						</button>
					)}
				{draftFlow.draft && (
					<button
						type="button"
						onClick={draftFlow.handleNext}
						disabled={busy}
						className="btn btn-plain"
					>
						下一条
					</button>
				)}
			</div>
		</Wrap>
	);
}

function Wrap({ children }: { children: React.ReactNode }) {
	return (
		<main
			className="glass-panel fade-in"
			style={{ padding: "var(--space-xl)", margin: "12px auto", maxWidth: 480 }}
		>
			{children}
		</main>
	);
}
