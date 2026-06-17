import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { useRef, useState } from "react";
import {
	buildPrompt,
	requestFill,
	requestGenerate,
} from "../../../lib/messaging";
import { clearCurrentDraft } from "../../../lib/storage";

type Mode = "empty" | "generating" | "draft" | "filling" | "filled" | "partial";

interface LoadingState {
	progress: number;
	message: string;
	startLoading: (message: string) => void;
	updateProgress: (progress: number) => void;
	completeLoading: () => void;
}

interface UseMainDraftFlowDeps {
	saveDraft: (draft: ContentDraft, explicit?: boolean) => void;
	handleError: (msg: string) => void;
	clearError: () => void;
	logError: (error: Error, context?: Record<string, unknown>) => Promise<void>;
	recordOperation: (op: {
		type: "generate" | "fill" | "publish" | "error";
		topic: string;
		success: boolean;
		details?: Record<string, unknown>;
	}) => Promise<void>;
	loadingState: LoadingState;
	setToast: (toast: { message: string; type: "success" | "error" | "info" } | null) => void;
}

export interface MainDraftFlowReturn {
	mode: Mode;
	topic: string;
	draft: ContentDraft | null;
	results: FieldFillResult[];
	confirmNext: boolean;
	setTopic: (topic: string) => void;
	setMode: (mode: Mode) => void;
	setDraft: (draft: ContentDraft | null) => void;
	promptTemplateRef: React.MutableRefObject<string>;
	updateDraft: (next: ContentDraft) => void;
	handleGenerate: () => Promise<void>;
	cancelGenerate: () => void;
	handleFill: () => Promise<void>;
	handleNext: () => void;
	cancelConfirmNext: () => void;
	copyBody: () => void;
}

export function useMainDraftFlow(deps: UseMainDraftFlowDeps): MainDraftFlowReturn {
	const {
		saveDraft,
		handleError,
		clearError,
		logError,
		recordOperation,
		loadingState,
		setToast,
	} = deps;

	const [mode, setMode] = useState<Mode>("empty");
	const [topic, setTopic] = useState("");
	const [draft, setDraft] = useState<ContentDraft | null>(null);
	const [results, setResults] = useState<FieldFillResult[]>([]);
	const [confirmNext, setConfirmNext] = useState(false);
	const promptTemplateRef = useRef("");
	const genTokenRef = useRef(0);

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

	function cancelConfirmNext() {
		setConfirmNext(false);
	}

	function copyBody() {
		if (draft) void navigator.clipboard?.writeText(draft.body);
	}

	return {
		mode,
		topic,
		draft,
		results,
		confirmNext,
		setTopic,
		setMode,
		setDraft,
		promptTemplateRef,
		updateDraft,
		handleGenerate,
		cancelGenerate,
		handleFill,
		handleNext,
		cancelConfirmNext,
		copyBody,
	};
}
