import { useRef, useState } from "react";
import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import {
	buildPrompt,
	requestFill,
	requestGenerate,
} from "../../../lib/messaging";
import { clearCurrentDraft } from "../../../lib/storage";

export type MainDraftMode =
	| "empty"
	| "generating"
	| "draft"
	| "filling"
	| "filled"
	| "partial";

export interface MainDraftFlowDeps {
	handleError: (msg: string, kind?: string) => void;
	logError: (err: Error, ctx?: Record<string, unknown>) => void;
	recordOperation: (op: {
		type: string;
		topic: string;
		success: boolean;
		details?: Record<string, unknown>;
	}) => void;
	loadingState: {
		progress: number;
		message: string;
		startLoading: (msg: string) => void;
		updateProgress: (p: number) => void;
		completeLoading: () => void;
	};
	saveDraft: (draft: ContentDraft) => void;
	onToast?: (msg: string, type: "success" | "error" | "info") => void;
}

export interface MainDraftFlowReturn {
	mode: MainDraftMode;
	topic: string;
	setTopic: (t: string) => void;
	draft: ContentDraft | null;
	updateDraft: (draft: ContentDraft) => void;
	results: FieldFillResult[];
	confirmNext: boolean;
	setConfirmNext: (v: boolean) => void;
	handleGenerate: () => Promise<void>;
	handleFill: () => Promise<void>;
	handleNext: () => void;
	cancelGenerate: () => void;
	copyBody: () => void;
	setInitialDraft: (draft: ContentDraft, promptTemplate: string) => void;
}

export function useMainDraftFlow(deps: MainDraftFlowDeps): MainDraftFlowReturn {
	const {
		handleError,
		logError,
		recordOperation,
		loadingState,
		saveDraft,
		onToast,
	} = deps;

	const [mode, setMode] = useState<MainDraftMode>("empty");
	const [topic, setTopic] = useState("");
	const [draft, setDraft] = useState<ContentDraft | null>(null);
	const [results, setResults] = useState<FieldFillResult[]>([]);
	const [confirmNext, setConfirmNext] = useState(false);

	const promptTemplateRef = useRef("");
	const genTokenRef = useRef(0);

	function setInitialDraft(savedDraft: ContentDraft, promptTemplate: string) {
		promptTemplateRef.current = promptTemplate;
		setDraft(savedDraft);
		setMode("draft");
	}

	function updateDraft(next: ContentDraft) {
		setDraft(next);
		saveDraft(next);
	}

	async function handleGenerate() {
		if (!topic.trim()) {
			handleError("请先输入主题。");
			return;
		}
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
					res.kind === "no-key"
						? `${res.error}(点右上角设置)`
						: res.error;
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
		setMode("filling");
		const res = await requestFill(draft);
		if (res.ok) {
			setResults(res.results);
			const anyProblem = res.results.some((r) => r.status !== "filled");
			setMode(anyProblem ? "partial" : "filled");
			if (!anyProblem) onToast?.("填充成功", "success");
		} else {
			handleError(res.error);
			setMode("draft");
			onToast?.(res.error, "error");
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
		setMode("empty");
	}

	function copyBody() {
		if (draft) void navigator.clipboard?.writeText(draft.body);
	}

	return {
		mode,
		topic,
		setTopic,
		draft,
		updateDraft,
		results,
		confirmNext,
		setConfirmNext,
		handleGenerate,
		handleFill,
		handleNext,
		cancelGenerate,
		copyBody,
		setInitialDraft,
	};
}