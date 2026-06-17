import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { useEffect, useRef, useState } from "react";
import { isAuthenticated } from "../../lib/auth-client";
import {
	buildPrompt,
	getBatchState,
	requestFill,
	requestGenerate,
	resolveAdminTabId,
} from "../../lib/messaging";
import { DEFAULT_RECIPE } from "../../lib/recipe";
import {
	clearCurrentDraft,
	getCurrentDraft,
	getSettings,
} from "../../lib/storage";
import { AuthView } from "./AuthView";
import { BatchView } from "./BatchView";
import { ErrorDisplay } from "./components/ErrorDisplay";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { ProgressBar } from "./components/ProgressBar";
import { Toast } from "./components/Toast";
import { DraftPreview } from "./DraftPreview";
import { FillResultPanel } from "./FillResultPanel";
import { FirstFlightWizard } from "./FirstFlightWizard";
import { useAutoSave } from "./hooks/useAutoSave";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { MetricsPanel } from "./MetricsPanel";
import { PendingTopicsView } from "./PendingTopicsView";
import { Settings } from "./Settings";
import { TodayBatchView } from "./TodayBatchView";

type Mode = "empty" | "generating" | "draft" | "filling" | "filled" | "partial";

export function App() {
	const [view, setView] = useState<
		| "main"
		| "settings"
		| "batch"
		| "pending"
		| "today"
		| "auth"
		| "firstflight"
		| "metrics"
	>("main");
	const [ffEntry, setFfEntry] = useState<{
		tabId: number;
		host: string;
		itemId: string;
	} | null>(null);
	const [mode, setMode] = useState<Mode>("empty");
	const [topic, setTopic] = useState("");
	const [draft, setDraft] = useState<ContentDraft | null>(null);
	const [results, setResults] = useState<FieldFillResult[]>([]);
	const { error, handleError, clearError } = useErrorHandler();
	const { logs, logError, retrieveLogs, clearLogs, exportLogs } =
		useErrorLogger();
	const [showLogs, setShowLogs] = useState(false);
	const { recordOperation } = useOperationHistory();
	const [confirmNext, setConfirmNext] = useState(false);
	const [toast, setToast] = useState<{
		message: string;
		type: "success" | "error" | "info";
	} | null>(null);
	const [authenticated, setAuthenticated] = useState(false);
	const [authChecking, setAuthChecking] = useState(true);
	const loadingState = useLoadingState();
	const { saveDraft } = useAutoSave();
	const promptTemplateRef = useRef("");
	const genTokenRef = useRef(0);

	useEffect(() => {
		void (async () => {
			const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
			promptTemplateRef.current = s.promptTemplate;
			if (saved) {
				setDraft(saved);
				setMode("draft");
			}
			const authed = await isAuthenticated();
			setAuthenticated(authed);
			setView(authed ? "main" : "auth");
			setAuthChecking(false);
		})();
	}, []);

	function updateDraft(next: ContentDraft) {
		setDraft(next);
		saveDraft(next);
	}

	async function handleGenerate() {
		if (!topic.trim()) {
			handleError("请先输入主题。");
			return;
		}
		clearError();
		setResults([]);
		setMode("generating");
		loadingState.startLoading("正在生成草稿...");
		const progressInterval = setInterval(() => {
			loadingState.updateProgress(Math.min(loadingState.progress + 10, 90));
		}, 500);
		try {
			const token = ++genTokenRef.current;
			const res = await requestGenerate(
				buildPrompt(promptTemplateRef.current, topic),
			);
			if (token !== genTokenRef.current) return;
			if (res.ok) {
				updateDraft(res.draft);
				setMode("draft");
				loadingState.completeLoading();
				void recordOperation({ type: "generate", topic, success: true });
			} else {
				const errMsg =
					res.kind === "no-key" ? `${res.error}(点右上角设置)` : res.error;
				handleError(errMsg);
				setMode(draft ? "draft" : "empty");
				loadingState.completeLoading();
				void logError(new Error(errMsg), { topic, action: "generate" });
				void recordOperation({
					type: "generate",
					topic,
					success: false,
					details: { error: errMsg },
				});
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : "生成失败";
			handleError(errMsg);
			setMode(draft ? "draft" : "empty");
			loadingState.completeLoading();
			void logError(err instanceof Error ? err : new Error(errMsg), {
				topic,
				action: "generate",
			});
			void recordOperation({
				type: "generate",
				topic,
				success: false,
				details: { error: errMsg },
			});
		} finally {
			clearInterval(progressInterval);
		}
	}

	function cancelGenerate() {
		genTokenRef.current++;
		setMode(draft ? "draft" : "empty");
		loadingState.completeLoading();
	}

	async function handleFill() {
		if (!draft) return;
		clearError();
		setMode("filling");
		const res = await requestFill(draft);
		if (res.ok) {
			setResults(res.results);
			const anyProblem = res.results.some((r) => r.status !== "filled");
			setMode(anyProblem ? "partial" : "filled");
			if (!anyProblem) setToast({ message: "填充成功", type: "success" });
		} else {
			handleError(res.error);
			setMode("draft");
			setToast({ message: res.error, type: "error" });
			void logError(new Error(res.error), { action: "fill" });
		}
	}

	function handleNext() {
		if (mode === "partial" && !confirmNext) {
			setConfirmNext(true);
			return;
		}
		setConfirmNext(false);
		void clearCurrentDraft();
		setDraft(null);
		setResults([]);
		setTopic("");
		clearError();
		setMode("empty");
	}

	function copyBody() {
		if (draft) void navigator.clipboard?.writeText(draft.body);
	}

	// 首飞向导入口:解析后台 tab + 取当前批次首条 awaiting-approval 条目。
	// host 仅用于展示/防误点;真实授权 host 仍由背景从 chrome.tabs.get 取。
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
		onGenerate: handleGenerate,
		onFill: handleFill,
		onNext: handleNext,
		onSave: () => {
			if (draft) {
				saveDraft(draft, true);
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

	const busy = mode === "generating" || mode === "filling";

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

				<nav className="workflow-grid" aria-label="主要工作流">
					<button
						type="button"
						onClick={() => setView("today")}
						className="workflow-card primary"
					>
						<span className="workflow-card-title">今日流水线</span>
						<span className="workflow-card-desc">
							自动取高分待审选题，生成草稿，逐篇审读后发布
						</span>
					</button>
					<button
						type="button"
						onClick={() => setView("pending")}
						className="workflow-card"
					>
						<span className="workflow-card-title">待审池</span>
						<span className="workflow-card-desc">
							抓取选题、补事实、挑选进入批量生成
						</span>
					</button>
					<button
						type="button"
						onClick={() => setView("batch")}
						className="workflow-card"
					>
						<span className="workflow-card-title">批量审核</span>
						<span className="workflow-card-desc">
							查看当前批次、处理异常、重跑或人工放行
						</span>
					</button>
					<button
						type="button"
						onClick={() => void launchFirstFlight()}
						className="workflow-card"
					>
						<span className="workflow-card-title">首飞向导</span>
						<span className="workflow-card-desc">
							最小授权窗口发布恰好一条,验证闸门时序
						</span>
					</button>
					<button
						type="button"
						onClick={() => setView("metrics")}
						className="workflow-card"
					>
						<span className="workflow-card-title">度量</span>
						<span className="workflow-card-desc">
							发布质量、LLM 用量、编辑率等统计看板
						</span>
					</button>
				</nav>
			</header>

			{/* Warning banner */}
			<div className="banner-warning" role="note">
				⚠️ 插件不会自动发布,请人工审核后手动发布。
			</div>

			{error && (
				<ErrorDisplay
					message={error}
					onRetry={() => {
						if (mode === "generating" || mode === "empty" || mode === "draft") {
							handleGenerate();
						} else if (
							mode === "filling" ||
							mode === "filled" ||
							mode === "partial"
						) {
							handleFill();
						}
					}}
					onDismiss={clearError}
				/>
			)}

			{showLogs && (
				<div
					className="card surface-muted"
					style={{
						maxHeight: 200,
						overflowY: "auto",
						marginBottom: "var(--space-lg)",
					}}
				>
					<div
						className="flex-between"
						style={{ marginBottom: "var(--space-md)" }}
					>
						<span className="font-semibold">错误日志</span>
						<div style={{ display: "flex", gap: "var(--space-md)" }}>
							<button
								type="button"
								onClick={() => {
									const exported = exportLogs();
									void navigator.clipboard?.writeText(exported);
								}}
								className="btn-icon text-info"
								style={{ fontSize: "var(--font-sm)" }}
							>
								导出
							</button>
							<button
								type="button"
								onClick={() => void clearLogs()}
								className="btn-icon text-error"
								style={{ fontSize: "var(--font-sm)" }}
							>
								清空
							</button>
						</div>
					</div>

					{logs.length === 0 ? (
						<div className="text-muted">暂无错误日志</div>
					) : (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "var(--space-md)",
							}}
						>
							{logs.map((log) => (
								<div
									key={log.id}
									className="surface-elevated"
									style={{ padding: "var(--space-md)" }}
								>
									<div
										className="text-error"
										style={{ marginBottom: "var(--space-sm)" }}
									>
										{log.message}
									</div>
									<div className="text-muted text-xs">
										{new Date(log.timestamp).toLocaleString()}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{(mode === "empty" ||
				mode === "generating" ||
				(mode === "draft" && !draft)) && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<textarea
						className="field-input"
						style={{ minHeight: 60, padding: "var(--space-lg)" }}
						placeholder="输入选题/主题,例如:介绍某部新番的看点"
						value={topic}
						disabled={busy}
						onChange={(e) => setTopic(e.target.value)}
					/>
				</div>
			)}

			{mode === "generating" && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<ProgressBar
						progress={loadingState.progress}
						label={loadingState.message}
					/>
					<button
						type="button"
						onClick={cancelGenerate}
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-lg)" }}
					>
						取消
					</button>
				</div>
			)}

			{draft && mode !== "generating" && (
				<DraftPreview draft={draft} onChange={updateDraft} />
			)}

			{mode === "filling" && (
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

			{(mode === "filled" || mode === "partial") && (
				<FillResultPanel results={results} />
			)}

			{mode === "partial" && (
				<div
					style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)" }}
				>
					<button
						type="button"
						onClick={copyBody}
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

			{confirmNext && (
				<div
					role="alert"
					className="text-error"
					style={{ marginTop: "var(--space-md)", fontSize: "var(--font-sm)" }}
				>
					正文尚未确认填入,确定进入下一条?
					<button
						type="button"
						onClick={handleNext}
						className="btn btn-plain btn-sm"
						style={{ marginLeft: "var(--space-lg)" }}
					>
						确定
					</button>
					<button
						type="button"
						onClick={() => setConfirmNext(false)}
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
				{(mode === "empty" || mode === "generating" || mode === "draft") && (
					<button
						type="button"
						onClick={handleGenerate}
						disabled={busy}
						className="btn btn-primary"
					>
						生成草稿
					</button>
				)}
				{draft &&
					(mode === "draft" || mode === "filled" || mode === "partial") && (
						<button
							type="button"
							onClick={handleFill}
							disabled={busy}
							className="btn btn-primary"
						>
							填充到当前页
						</button>
					)}
				{draft && (
					<button
						type="button"
						onClick={handleNext}
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
