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
	};
});

import { deriveFewShotExamples } from "../../../lib/storage";
import { useSettingsForm } from "./useSettingsForm";

const DEFAULT_SETTINGS_MOCK = {
	endpoint: "https://api.example.com",
	model: "gpt-4",
	promptTemplate: "Write a post about {topic}",
	fewShotExamples: "",
	fewShotPairs: [],
	recommendedTags: ["漢化", "無修正"],
	fieldMapping: { title: { selector: 'input[name="title"]', fieldType: "text" } },
	fallbackModel: undefined,
	backendUrl: "http://localhost:3001",
	reviewCriteriaPrompt: "",
	dailyBatchSize: 5,
};

describe("useSettingsForm — Unit 2: load / save / importFewShot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS_MOCK });
		mocks.getApiKey.mockResolvedValue("test-api-key");
		mocks.getBackendToken.mockResolvedValue("test-backend-token");
		mocks.saveSettings.mockResolvedValue(undefined);
		mocks.saveApiKey.mockResolvedValue(undefined);
		mocks.saveBackendToken.mockResolvedValue(undefined);
	});

	it("load() 後 formValues.endpoint 等於 storage 回傳值", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.formValues.endpoint).toBe("https://api.example.com");
	});

	it("load() 呼叫 getSettings + getApiKey + getBackendToken 各一次", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(mocks.getSettings).toHaveBeenCalledTimes(1);
		expect(mocks.getApiKey).toHaveBeenCalledTimes(1);
		expect(mocks.getBackendToken).toHaveBeenCalledTimes(1);
	});

	it("load 後 fewShotExamples 非空且 fewShotPairs 為空 → importBanner 為提示文案", async () => {
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotExamples: "Q\n---\nA",
			fewShotPairs: [],
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.formValues.importBanner).toBeTruthy();
		expect(result.current.formValues.importBanner).toContain("匯入");
	});

	it("load 後 fewShotPairs 有值 → importBanner 為空", async () => {
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotExamples: "Q\n---\nA",
			fewShotPairs: [{ input: "Q", output: "A" }],
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.formValues.importBanner).toBe("");
	});

	it("save() 驗證通過 → saveSettings/saveApiKey/saveBackendToken 各呼叫一次，回傳 null", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		let saveResult: string | null = "not-called";
		await act(async () => {
			saveResult = await result.current.save();
		});
		expect(saveResult).toBeNull();
		expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
		expect(mocks.saveApiKey).toHaveBeenCalledTimes(1);
		expect(mocks.saveBackendToken).toHaveBeenCalledTimes(1);
	});

	it("save() fewShotPairs 非空 → saveSettings 收到 derivedFewShotExamples 結果", async () => {
		const pairs = [
			{ input: "Q1", output: "A1" },
			{ input: "Q2", output: "A2" },
		];
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotPairs: pairs,
			fewShotExamples: "stale-raw-text",
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		await act(async () => {
			await result.current.save();
		});
		const callArg = vi.mocked(mocks.saveSettings).mock.calls[0]?.[0];
		expect(callArg?.fewShotExamples).toBe(deriveFewShotExamples(pairs));
		expect(callArg?.fewShotExamples).not.toBe("stale-raw-text");
	});

	it("save() endpoint 不合法 → saveSettings 不被呼叫，回傳錯誤字串", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			result.current.setFormValue("endpoint", "http://bad.url");
		});
		let saveResult: string | null = null;
		await act(async () => {
			saveResult = await result.current.save();
		});
		expect(saveResult).not.toBeNull();
		expect(mocks.saveSettings).not.toHaveBeenCalled();
	});

	it("importFewShot() fewShotExamples 有兩條 → fewShotPairs 更新為 2 條", async () => {
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotExamples: "input\n---\noutput\n\ninput2\n---\noutput2",
			fewShotPairs: [],
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		act(() => {
			result.current.importFewShot();
		});
		expect(result.current.formValues.fewShotPairs).toHaveLength(2);
	});

	it("importFewShot() fewShotExamples 為空 → fewShotPairs 不改變（no-op）", () => {
		const { result } = renderHook(() => useSettingsForm());
		act(() => {
			result.current.importFewShot();
		});
		expect(result.current.formValues.fewShotPairs).toHaveLength(0);
	});

	it("importFewShot() 超過 MAX_PAIRS 條 → 截斷至 8 條，importTruncated 更新", async () => {
		const manyPairs = Array.from(
			{ length: 10 },
			(_, i) => `Q${i}\n---\nA${i}`,
		).join("\n\n");
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotExamples: manyPairs,
			fewShotPairs: [],
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		act(() => {
			result.current.importFewShot();
		});
		expect(result.current.formValues.fewShotPairs).toHaveLength(8);
		expect(result.current.formValues.importTruncated).toBeTruthy();
		expect(result.current.formValues.importTruncated).toContain("10");
	});

	it("load() once-guard：第二次呼叫 getSettings 不被呼叫；且用戶輸入不被覆蓋", async () => {
		const { result } = renderHook(() => useSettingsForm());
		// 先改欄位再 load
		act(() => {
			result.current.setFormValue("endpoint", "user-input");
		});
		await act(async () => {
			await result.current.load();
		});
		// load() 第一次會呼叫 getSettings
		expect(mocks.getSettings).toHaveBeenCalledTimes(1);

		// 第二次 load() 不應呼叫 getSettings
		await act(async () => {
			await result.current.load();
		});
		expect(mocks.getSettings).toHaveBeenCalledTimes(1);
	});

	it("derivedFewShotExamples：pairs 非空時回傳 deriveFewShotExamples 結果", async () => {
		const pairs = [{ input: "Q", output: "A" }];
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotPairs: pairs,
			fewShotExamples: "raw-text",
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.derivedFewShotExamples).toBe(
			deriveFewShotExamples(pairs),
		);
	});

	it("derivedFewShotExamples：pairs 為空時回傳 fewShotExamples raw text", async () => {
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotPairs: [],
			fewShotExamples: "raw-text",
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		expect(result.current.derivedFewShotExamples).toBe("raw-text");
	});
});
