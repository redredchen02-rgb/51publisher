// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSettings: vi.fn(),
	getApiKey: vi.fn(),
	getBackendToken: vi.fn(),
	saveSettings: vi.fn(),
	saveApiKey: vi.fn(),
	saveBackendToken: vi.fn(),
	deriveFewShotExamples: vi.fn(() => ""),
	fetchPrompts: vi.fn(),
	createPrompt: vi.fn(),
	testConnection: vi.fn(),
}));

vi.mock("../../../lib/storage", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../lib/storage")>();
	return {
		...actual,
		getSettings: mocks.getSettings,
		getApiKey: mocks.getApiKey,
		getBackendToken: mocks.getBackendToken,
		saveSettings: mocks.saveSettings,
		saveApiKey: mocks.saveApiKey,
		saveBackendToken: mocks.saveBackendToken,
		deriveFewShotExamples: mocks.deriveFewShotExamples,
	};
});

vi.mock("../../../lib/api/prompt-client", () => ({
	fetchPrompts: mocks.fetchPrompts,
	createPrompt: mocks.createPrompt,
}));

vi.mock("../../../lib/api/connection-test", () => ({
	testConnection: mocks.testConnection,
}));

import { useSettingsForm } from "./useSettingsForm";

const BASE_SETTINGS = {
	endpoint: "https://api.example.com",
	model: "gpt-4",
	promptTemplate: "Write about {topic}",
	fewShotPairs: [],
	recommendedTags: [],
	fieldMapping: { title: { selector: "input", fieldType: "text" } },
	fallbackModel: undefined,
	backendUrl: "http://localhost:3001",
	reviewCriteriaPrompt: "",
};

describe("useSettingsForm — extra branch coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSettings.mockResolvedValue({ ...BASE_SETTINGS });
		mocks.getApiKey.mockResolvedValue("key");
		mocks.getBackendToken.mockResolvedValue("token");
		mocks.saveSettings.mockResolvedValue(undefined);
		mocks.saveApiKey.mockResolvedValue(undefined);
		mocks.saveBackendToken.mockResolvedValue(undefined);
		mocks.fetchPrompts.mockResolvedValue({ ok: true, prompts: [] });
		mocks.createPrompt.mockResolvedValue({ ok: true });
	});

	it("load() 第二次調用 → no-op (loadedRef guard)", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(mocks.getSettings).toHaveBeenCalledTimes(1);
		await act(async () => {
			await result.current.load();
		});
		// Still only called once - guarded by loadedRef.current
		expect(mocks.getSettings).toHaveBeenCalledTimes(1);
	});

	it("save() mappingText JSON 解析失敗 → 返回錯誤字串", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		act(() => {
			result.current.setFormValue("mappingText", "{ invalid json }");
		});
		let err: string | null = null;
		await act(async () => {
			err = await result.current.save();
		});
		expect(err).not.toBeNull();
		expect(mocks.saveSettings).not.toHaveBeenCalled();
	});

	it("savePromptToBackend() 失敗 → createPrompt called + loadPrompts triggered", async () => {
		// createPrompt fails, then loadPrompts also fails so we can check the final status
		mocks.createPrompt.mockResolvedValue({ ok: false, error: "server error" });
		mocks.fetchPrompts.mockResolvedValue({ ok: false, error: "load error" });
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.savePromptToBackend("test-name");
		});
		// After savePromptToBackend, loadPrompts is called; since that also fails, promptStatus = "加載失敗：load error"
		expect(mocks.createPrompt).toHaveBeenCalledTimes(1);
		expect(mocks.fetchPrompts).toHaveBeenCalledTimes(1);
		// promptStatus is overwritten by loadPrompts result
		expect(result.current.promptStatus).toContain("失敗");
	});

	it("savePromptToBackend() 成功 → promptStatus 含「已儲存」then overwritten by loadPrompts", async () => {
		mocks.createPrompt.mockResolvedValue({ ok: true });
		mocks.fetchPrompts.mockResolvedValue({ ok: true, prompts: [] });
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.savePromptToBackend("test-name");
		});
		// After savePromptToBackend, loadPrompts is called and overwrites status
		expect(mocks.createPrompt).toHaveBeenCalledTimes(1);
		expect(mocks.fetchPrompts).toHaveBeenCalledTimes(1);
	});

	it("loadPrompts() ok=true but prompts missing → promptStatus 含「已加載 0」", async () => {
		mocks.fetchPrompts.mockResolvedValue({ ok: true, prompts: [] });
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.loadPrompts();
		});
		expect(result.current.promptStatus).toContain("已加載");
	});

	it("loadPrompts() 失敗無 error 字段 → promptStatus 含「未知錯誤」", async () => {
		mocks.fetchPrompts.mockResolvedValue({ ok: false });
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.loadPrompts();
		});
		expect(result.current.promptStatus).toContain("未知錯誤");
	});

	it("setApiKey / getApiKey round-trip", () => {
		const { result } = renderHook(() => useSettingsForm());
		act(() => {
			result.current.setApiKey("new-api-key");
		});
		expect(result.current.getApiKey()).toBe("new-api-key");
	});

	it("setBackendToken / getBackendToken round-trip", () => {
		const { result } = renderHook(() => useSettingsForm());
		act(() => {
			result.current.setBackendToken("new-backend-token");
		});
		expect(result.current.getBackendToken()).toBe("new-backend-token");
	});

	it("setFewShotPairs → formValues.fewShotPairs 更新", () => {
		const { result } = renderHook(() => useSettingsForm());
		act(() => {
			result.current.setFewShotPairs([{ input: "Q", output: "A" }]);
		});
		expect(result.current.formValues.fewShotPairs).toEqual([
			{ input: "Q", output: "A" },
		]);
	});
});
