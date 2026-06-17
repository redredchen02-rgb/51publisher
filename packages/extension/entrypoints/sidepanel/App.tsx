import { lazy, Suspense, useEffect, useState } from "react";
import { isAuthenticated } from "../../lib/api/auth-client";
import { getCurrentDraft, getSettings } from "../../lib/storage";
import { AuthView } from "./AuthView";
import { ErrorDisplay } from "./components/ErrorDisplay";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { ProgressBar } from "./components/ProgressBar";
import { Toast } from "./components/Toast";
import { DraftPreview } from "./DraftPreview";
import { ErrorLogPanel } from "./ErrorLogPanel";
import { useAutoSave } from "./hooks/useAutoSave";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useMainDraftFlow } from "./hooks/useMainDraftFlow";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { WorkflowNav } from "./WorkflowNav";

const MetricsPanel = lazy(() =>
	import("./MetricsPanel").then((m) => ({ default: m.MetricsPanel })),
);
const Settings = lazy(() =>
	import("./Settings").then((m) => ({ default: m.Settings })),
);

export function App() {
	const [view, setView] = useState<"main" | "settings" | "auth" | "metrics">(
		"main",
	);
	const [toast, setToast] = useState<{
		message: string;
		type: "success" | "error" | "info";
	} | null>(null);
	const [authenticated, setAuthenticated] = useState(false);
	const [authChecking, setAuthChecking] = useState(true);
	const [showLogs, setShowLogs] = useState(false);

	const { error, handleError, clearError } = useErrorHandler();
	const { logs, logError, retrieveLogs, clearLogs, exportLogs } =
		useErrorLogger();
	const { recordOperation } = useOperationHistory();
	const loadingState = useLoadingState();
	const { saveDraft } = useAutoSave();

	const {
		mode,
		topic,
		draft,
		setTopic,
		promptTemplateRef,
		setInitialDraft,
		updateDraft,
		handleGenerate,
		cancelGenerate,
	} = useMainDraftFlow({
		saveDraft,
		handleError,
		logError,
		recordOperation,
		loadingState,
		onToast: (message, type) => setToast({ message, type }),
	});

	useEffect(() => {
		void (async () => {
			const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
			if (saved) {
				setInitialDraft(saved, s.promptTemplate);
			} else {
				promptTemplateRef.current = s.promptTemplate;
			}
			const authed = await isAuthenticated();
			setAuthenticated(authed);
			setView(authed ? "main" : "auth");
			setAuthChecking(false);
		})();
	}, [promptTemplateRef, setInitialDraft]);

	useKeyboardShortcuts({
		onGenerate: handleGenerate,
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
				<Suspense fallback={<Loading />}>
					<Settings onClose={() => setView("main")} />
				</Suspense>
			</Wrap>
		);
	if (view === "metrics")
		return (
			<Suspense fallback={<Loading />}>
				<MetricsPanel onBack={() => setView("main")} />
			</Suspense>
		);

	const busy = mode === "generating";

	return (
		<Wrap>
			<header className="app-header">
				<div className="app-title-row">
					<div>
						<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>
							51guapi 吃瓜小幫手
						</h1>
						<div className="text-sm text-secondary" style={{ marginTop: 3 }}>
							從選題到審核的一體化工作台
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

				<WorkflowNav onMetrics={() => setView("metrics")} />
			</header>

			{error && (
				<ErrorDisplay
					message={error}
					onRetry={() => {
						if (mode === "generating" || mode === "empty" || mode === "draft") {
							void handleGenerate();
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

			{toast && (
				<Toast
					message={toast.message}
					type={toast.type}
					onClose={() => setToast(null)}
				/>
			)}

			{(mode === "empty" || mode === "generating" || mode === "draft") && (
				<div
					style={{
						display: "flex",
						gap: "var(--space-md)",
						marginTop: "var(--space-xl)",
					}}
				>
					<button
						type="button"
						onClick={() => void handleGenerate()}
						disabled={busy}
						className="btn btn-primary"
					>
						生成草稿
					</button>
				</div>
			)}
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
