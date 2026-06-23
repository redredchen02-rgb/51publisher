// @vitest-environment jsdom

import type { ContentDraft } from "@51publisher/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/messaging", () => ({
	buildPrompt: vi.fn(
		(template: string, topic: string) => `${template}:${topic}`,
	),
	requestGenerate: vi.fn(),
	requestFill: vi.fn(),
}));

vi.mock("../../../lib/storage", () => ({
	clearCurrentDraft: vi.fn().mockResolvedValue(undefined),
}));

import { requestFill, requestGenerate } from "../../../lib/messaging";
import { useMainDraftFlow } from "./useMainDraftFlow";

const DRAFT: ContentDraft = {
	id: "draft-1",
	title: "测试标题",
	subtitle: "",
	body: "<p>正文</p>",
	description: "摘要",
	tags: [],
	category: "",
	coverImageUrl: "",
	postStatus: "1",
	publishedAt: "2026-06-16",
	mediaId: "",
	status: "draft",
	createdAt: "2026-06-16T00:00:00.000Z",
};

function makeDeps() {
	return {
		handleError: vi.fn(),
		logError: vi.fn().mockResolvedValue(undefined),
		recordOperation: vi.fn().mockResolvedValue(undefined),
		loadingState: {
			progress: 0,
			message: "",
			startLoading: vi.fn(),
			updateProgress: vi.fn(),
			completeLoading: vi.fn(),
		},
		saveDraft: vi.fn(),
		onToast: vi.fn(),
	};
}

describe("useMainDraftFlow — extra branch coverage", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handleGenerate catch: throw non-Error value → errMsg = '生成失败'", async () => {
		// throw a string (not instanceof Error) → the false branch of `err instanceof Error`
		vi.mocked(requestGenerate).mockRejectedValue("string error, not Error");
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(deps.handleError).toHaveBeenCalledWith("生成失败");
		// logError should be called with a new Error wrapping the generic message
		expect(deps.logError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "生成失败" }),
			expect.objectContaining({ action: "generate" }),
		);
	});

	it("handleGenerate catch: throw Error with draft present → mode='draft'", async () => {
		vi.mocked(requestGenerate).mockResolvedValueOnce({
			ok: true,
			draft: DRAFT,
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		// first generate succeeds → draft is set
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(result.current.draft).not.toBeNull();

		// second generate throws → mode should revert to "draft" (because draft != null)
		vi.mocked(requestGenerate).mockRejectedValueOnce(
			new Error("network error"),
		);
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(result.current.mode).toBe("draft");
	});

	it("handleGenerate fail (non no-key kind) → handleError with plain error, mode=empty", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: false,
			error: "LLM 超时",
			kind: "network",
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(deps.handleError).toHaveBeenCalledWith("LLM 超时");
		expect(result.current.mode).toBe("empty");
	});

	it("handleFill: ok=false → handleError, mode=draft, onToast error, logError called", async () => {
		// First generate to get a draft
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: false,
			error: "连接失败",
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		expect(deps.handleError).toHaveBeenCalledWith("连接失败");
		expect(result.current.mode).toBe("draft");
		expect(deps.onToast).toHaveBeenCalledWith("连接失败", "error");
		expect(deps.logError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "连接失败" }),
			expect.objectContaining({ action: "fill" }),
		);
	});

	it("cancelGenerate with existing draft → mode reverts to 'draft'", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(result.current.draft).not.toBeNull();
		// now cancel while in draft mode
		act(() => {
			result.current.cancelGenerate();
		});
		expect(result.current.mode).toBe("draft");
	});

	it("copyBody: draft exists → clipboard.writeText called", () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setInitialDraft(DRAFT, "");
		});
		act(() => {
			result.current.copyBody();
		});
		expect(writeText).toHaveBeenCalledWith(DRAFT.body);
	});

	it("cancelConfirmNext: sets confirmNext=false", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: true,
			results: [{ field: "tags", status: "degraded" }],
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("选题");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		// trigger confirmNext=true
		act(() => {
			result.current.handleNext();
		});
		expect(result.current.confirmNext).toBe(true);
		// now cancel
		act(() => {
			result.current.cancelConfirmNext();
		});
		expect(result.current.confirmNext).toBe(false);
	});
});
