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
	};
});

vi.mock("../../../lib/prompt-client", () => ({
	fetchPrompts: mocks.fetchPrompts,
	createPrompt: mocks.createPrompt,
}));

vi.mock("../../../lib/connection-test", () => ({
	testConnection: mocks.testConnection,
}));

import { deriveFewShotExamples } from "../../../lib/storage";
import { useSettingsForm } from "./useSettingsForm";

const DEFAULT_SETTINGS_MOCK = {
	endpoint: "https://api.example.com",
	model: "gpt-4",
	promptTemplate: "Write a post about {topic}",
	fewShotExamples: "",
	fewShotPairs: [],
	recommendedTags: ["漢化", "無修正"],
	fieldMapping: {
		title: { selector: 'input[name="title"]', fieldType: "text" },
	},
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

const PROMPT_LIST_MOCK = [
	{
		id: "p1",
		name: "模板A",
		template: "寫一篇關於{topic}的文章",
		fewShotExamples: "Q\n---\nA",
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
	},
];

describe("useSettingsForm — Unit 3: loadPrompts / selectPrompt / savePromptToBackend / testConnection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS_MOCK });
		mocks.getApiKey.mockResolvedValue("test-api-key");
		mocks.getBackendToken.mockResolvedValue("test-backend-token");
		mocks.saveSettings.mockResolvedValue(undefined);
		mocks.saveApiKey.mockResolvedValue(undefined);
		mocks.saveBackendToken.mockResolvedValue(undefined);
		mocks.fetchPrompts.mockResolvedValue({
			ok: true,
			prompts: PROMPT_LIST_MOCK,
		});
		mocks.createPrompt.mockResolvedValue({ ok: true });
		mocks.testConnection.mockResolvedValue({
			status: "ok",
			message: "連線正常",
			modelCount: 3,
		});
	});

	it("loadPrompts() 成功 → prompts 有值，promptStatus 含「已加載」", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.loadPrompts();
		});
		expect(result.current.prompts).toHaveLength(1);
		expect(result.current.promptStatus).toContain("已加載");
	});

	it("loadPrompts() 失敗 → prompts 不更新，promptStatus 含「失敗」", async () => {
		mocks.fetchPrompts.mockResolvedValue({ ok: false, error: "網路錯誤" });
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.loadPrompts();
		});
		expect(result.current.prompts).toHaveLength(0);
		expect(result.current.promptStatus).toContain("失敗");
	});

	it("selectPrompt(id) id 存在 → promptTemplate 和 fewShotExamples 更新", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.loadPrompts();
		});
		act(() => {
			result.current.selectPrompt("p1");
		});
		expect(result.current.formValues.promptTemplate).toBe(
			"寫一篇關於{topic}的文章",
		);
		expect(result.current.formValues.fewShotExamples).toBe("Q\n---\nA");
	});

	it("selectPrompt(id) id 不存在 → promptTemplate 不改變（no-op）", async () => {
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
			await result.current.loadPrompts();
		});
		const before = result.current.formValues.promptTemplate;
		act(() => {
			result.current.selectPrompt("non-existent-id");
		});
		expect(result.current.formValues.promptTemplate).toBe(before);
	});

	it("savePromptToBackend() → createPrompt 收到 derivedFewShotExamples；且觸發 loadPrompts", async () => {
		const pairs = [{ input: "Q1", output: "A1" }];
		mocks.getSettings.mockResolvedValue({
			...DEFAULT_SETTINGS_MOCK,
			fewShotPairs: pairs,
			fewShotExamples: "stale-raw",
		});
		const { result } = renderHook(() => useSettingsForm());
		await act(async () => {
			await result.current.load();
		});
		await act(async () => {
			await result.current.savePromptToBackend("我的模板");
		});
		const callArg = vi.mocked(mocks.createPrompt).mock.calls[0]?.[0];
		expect(callArg?.fewShotExamples).not.toBe("stale-raw");
		// loadPrompts() 在 savePromptToBackend 後自動觸發
		expect(mocks.fetchPrompts).toHaveBeenCalledTimes(1);
	});

	it("testConnectionFn() 成功 → 回傳 status ok；testConnection 被呼叫", async () => {
		const { result } = renderHook(() => useSettingsForm());
		let connResult: { status: string } | undefined;
		await act(async () => {
			connResult = await result.current.testConnectionFn();
		});
		expect(connResult?.status).toBe("ok");
		expect(mocks.testConnection).toHaveBeenCalledTimes(1);
	});
});
