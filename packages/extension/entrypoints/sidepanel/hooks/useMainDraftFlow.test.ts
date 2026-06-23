// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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

import type { ContentDraft } from "@51publisher/shared";
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
		logError: vi.fn(),
		recordOperation: vi.fn(),
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

describe("useMainDraftFlow", () => {
	afterEach(cleanup);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("初始狀態：mode=empty, topic='', draft=null", () => {
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		expect(result.current.mode).toBe("empty");
		expect(result.current.topic).toBe("");
		expect(result.current.draft).toBeNull();
		expect(result.current.results).toHaveLength(0);
	});

	it("setInitialDraft 切換到 draft 模式", () => {
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setInitialDraft(DRAFT, "系統 prompt");
		});
		expect(result.current.mode).toBe("draft");
		expect(result.current.draft).toEqual(DRAFT);
	});

	it("handleGenerate 主題為空 → handleError、mode 不變", async () => {
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(deps.handleError).toHaveBeenCalledWith("请先输入主题。");
		expect(result.current.mode).toBe("empty");
	});

	it("handleGenerate 成功 → mode=draft, draft 更新, saveDraft 被呼叫", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(result.current.mode).toBe("draft");
		expect(result.current.draft).toEqual(DRAFT);
		expect(deps.saveDraft).toHaveBeenCalledWith(DRAFT);
		expect(deps.loadingState.completeLoading).toHaveBeenCalled();
	});

	it("handleGenerate 失敗(no-key) → handleError 帶提示, mode=empty", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({
			ok: false,
			error: "需要 API Key",
			kind: "no-key",
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		expect(deps.handleError).toHaveBeenCalledWith(
			expect.stringContaining("需要 API Key"),
		);
		expect(result.current.mode).toBe("empty");
	});

	it("cancelGenerate → mode 回到 empty（無先前草稿）", () => {
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		// cancelGenerate 直接把 mode 設回 empty（draft=null 時）
		act(() => {
			result.current.cancelGenerate();
		});
		expect(result.current.mode).toBe("empty");
		expect(deps.loadingState.completeLoading).toHaveBeenCalled();
	});

	it("handleFill 成功無降級 → mode=filled, onToast success", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: true,
			results: [{ field: "title", status: "filled" }],
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		// 先生成草稿
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		expect(result.current.mode).toBe("filled");
		expect(deps.onToast).toHaveBeenCalledWith("填充成功", "success");
	});

	it("handleFill 有降級欄位 → mode=partial", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: true,
			results: [
				{ field: "title", status: "filled" },
				{ field: "tags", status: "degraded" },
			],
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		expect(result.current.mode).toBe("partial");
	});

	it("partial 狀態第一次 handleNext → confirmNext=true 而非重置", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: true,
			results: [{ field: "tags", status: "degraded" }],
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		act(() => {
			result.current.handleNext();
		});
		expect(result.current.confirmNext).toBe(true);
		expect(result.current.draft).not.toBeNull(); // 未重置
	});

	it("filled 狀態 handleNext → 重置到 empty", async () => {
		vi.mocked(requestGenerate).mockResolvedValue({ ok: true, draft: DRAFT });
		vi.mocked(requestFill).mockResolvedValue({
			ok: true,
			results: [{ field: "title", status: "filled" }],
		});
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setTopic("測試選題");
		});
		await act(async () => {
			await result.current.handleGenerate();
		});
		await act(async () => {
			await result.current.handleFill();
		});
		await act(async () => {
			result.current.handleNext();
		});
		await waitFor(() => {
			expect(result.current.mode).toBe("empty");
		});
		expect(result.current.draft).toBeNull();
		expect(result.current.topic).toBe("");
	});

	it("updateDraft 同步更新草稿並呼叫 saveDraft", () => {
		const deps = makeDeps();
		const { result } = renderHook(() => useMainDraftFlow(deps));
		act(() => {
			result.current.setInitialDraft(DRAFT, "");
		});
		const updated = { ...DRAFT, title: "新標題" };
		act(() => {
			result.current.updateDraft(updated);
		});
		expect(result.current.draft?.title).toBe("新標題");
		expect(deps.saveDraft).toHaveBeenCalledWith(updated);
	});
});
