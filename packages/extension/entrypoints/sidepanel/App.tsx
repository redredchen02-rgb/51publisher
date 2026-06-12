import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { useEffect, useRef, useState } from "react";
import { isAuthenticated } from "../../lib/auth-client";
import { buildPrompt, requestFill, requestGenerate } from "../../lib/messaging";
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
import { useAutoSave } from "./hooks/useAutoSave";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { PendingTopicsView } from "./PendingTopicsView";
import { Settings } from "./Settings";
import { TodayBatchView } from "./TodayBatchView";

type Mode = "empty" | "generating" | "draft" | "filling" | "filled" | "partial";

export function App() {
	const [view, setView] = useState<
		"main" | "settings" | "batch" | "pending" | "today" | "auth"
	>("main");
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
	const genTokenRef = useRef(0); // 取消用:递增后旧请求结果作废

	// 挂载:载入 prompt 模板 + 恢复上一条未完成草稿(崩溃恢复) + 检查登录状态。
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
			if (token !== genTokenRef.current) return; // 已取消
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
				// 记录错误日志
				void logError(new Error(errMsg), { topic, action: "generate" });
				void recordOperation({
					type: "generate",
					topic,
					success: false,
					details: { error: errMsg },
				});
			}
		} catch (err) {
			// 处理未预期的异常（如网络超时、SW 崩溃等）
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
			// 记录错误日志
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

	const busy = mode === "generating" || mode === "filling";

	return (
		<Wrap>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<h1 style={{ fontSize: 16, margin: 0 }}>51publisher 填充助手</h1>
				<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
					<button
						type="button"
						onClick={() => {
							if (!authenticated) setView("auth");
						}}
						onKeyDown={(e) => {
							if (!authenticated && (e.key === "Enter" || e.key === " ")) {
								setView("auth");
							}
						}}
						style={{
							fontSize: 11,
							color: authenticated ? "#389e0d" : "#cf1322",
							cursor: authenticated ? "default" : "pointer",
							userSelect: "none",
							background: "none",
							border: "none",
							padding: 0,
							fontFamily: "inherit",
						}}
					>
						{authenticated ? "已登录" : "未登录"}
					</button>
					<button type="button"
						onClick={() => setView("pending")}
						className="btn btn-plain"
						aria-label="待审核"
					>
						◎ 待审
					</button>
					<button type="button"
						onClick={() => setView("today")}
						className="btn btn-plain"
						aria-label="今日备稿"
					>
						☀ 今日
					</button>
					<button type="button"
						onClick={() => setView("batch")}
						className="btn btn-plain"
						aria-label="批量"
					>
						≣ 批量
					</button>
					<button type="button"
						onClick={() => setView("settings")}
						className="btn btn-plain"
						aria-label="设置"
					>
						⚙ 设置
					</button>
					<KeyboardShortcutsHelp />
					<button type="button"
						onClick={() => {
							setShowLogs(!showLogs);
							if (!showLogs) void retrieveLogs();
						}}
						className="btn btn-plain"
						aria-label="错误日志"
					>
						📋 日志
					</button>
				</div>
			</div>

			<div
				role="note"
				style={{
					background: "#fff7e6",
					border: "1px solid #ffd591",
					borderRadius: 6,
					padding: "8px 10px",
					fontSize: 13,
					marginBottom: 12,
				}}
			>
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
					style={{
						background: "#f5f5f5",
						border: "1px solid #d9d9d9",
						borderRadius: 6,
						padding: 12,
						marginBottom: 12,
						maxHeight: 200,
						overflowY: "auto",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							marginBottom: 8,
						}}
					>
						<span style={{ fontWeight: 600 }}>错误日志</span>
						<div style={{ display: "flex", gap: 8 }}>
							<button type="button"
								onClick={() => {
									const exported = exportLogs();
									void navigator.clipboard?.writeText(exported);
								}}
								style={{
									border: "none",
									background: "none",
									cursor: "pointer",
									fontSize: 12,
									color: "#1677ff",
								}}
							>
								导出
							</button>
							<button type="button"
								onClick={() => void clearLogs()}
								style={{
									border: "none",
									background: "none",
									cursor: "pointer",
									fontSize: 12,
									color: "#ff4d4f",
								}}
							>
								清空
							</button>
						</div>
					</div>

					{logs.length === 0 ? (
						<div style={{ fontSize: 13, color: "#8c8c8c" }}>暂无错误日志</div>
					) : (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{logs.map((log) => (
								<div
									key={log.id}
									style={{
										background: "white",
										border: "1px solid #d9d9d9",
										borderRadius: 4,
										padding: 8,
										fontSize: 12,
									}}
								>
									<div style={{ color: "#cf1322", marginBottom: 4 }}>
										{log.message}
									</div>
									<div style={{ color: "#8c8c8c" }}>
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
				<div style={{ marginBottom: 12 }}>
					<textarea
						style={{
							width: "100%",
							boxSizing: "border-box",
							minHeight: 60,
							padding: 6,
							fontSize: 13,
							border: "1px solid #d9d9d9",
							borderRadius: 4,
						}}
						placeholder="输入选题/主题,例如:介绍某部新番的看点"
						value={topic}
						disabled={busy}
						onChange={(e) => setTopic(e.target.value)}
					/>
				</div>
			)}

			{mode === "generating" && (
				<div style={{ marginBottom: 12 }}>
					<ProgressBar
						progress={loadingState.progress}
						label={loadingState.message}
					/>
					<button type="button"
						onClick={cancelGenerate}
						className="btn btn-plain"
						style={{ padding: "2px 8px", marginTop: 6 }}
					>
						取消
					</button>
				</div>
			)}

			{draft && mode !== "generating" && (
				<DraftPreview draft={draft} onChange={updateDraft} />
			)}

			{mode === "filling" && (
				<div aria-live="polite" style={{ marginBottom: 8 }}>
					<ProgressBar progress={0} indeterminate />
					<div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
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
				<div style={{ marginTop: 8, fontSize: 12 }}>
					<button type="button" onClick={copyBody} className="btn btn-plain">
						复制正文
					</button>
					<span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
						正文可能需手动粘贴到编辑器。
					</span>
				</div>
			)}

			{confirmNext && (
				<div
					role="alert"
					style={{ marginTop: 8, fontSize: 12, color: "#cf1322" }}
				>
					正文尚未确认填入,确定进入下一条?
					<button type="button"
						onClick={handleNext}
						className="btn btn-plain"
						style={{ padding: "2px 8px", marginLeft: 6 }}
					>
						确定
					</button>
					<button type="button"
						onClick={() => setConfirmNext(false)}
						className="btn btn-plain"
						style={{ padding: "2px 8px", marginLeft: 4 }}
					>
						取消
					</button>
				</div>
			)}

			<div style={{ display: "flex", gap: 8, marginTop: 14 }}>
				{(mode === "empty" || mode === "generating" || mode === "draft") && (
					<button type="button"
						onClick={handleGenerate}
						disabled={busy}
						className="btn btn-primary"
					>
						生成草稿
					</button>
				)}
				{draft &&
					(mode === "draft" || mode === "filled" || mode === "partial") && (
						<button type="button"
							onClick={handleFill}
							disabled={busy}
							className="btn btn-primary"
						>
							填充到当前页
						</button>
					)}
				{draft && (
					<button type="button"
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
			className="glass-panel"
			style={{ padding: 16, margin: "12px auto", maxWidth: 480 }}
		>
			{children}
		</main>
	);
}
