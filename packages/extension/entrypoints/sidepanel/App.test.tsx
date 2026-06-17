// @vitest-environment jsdom

import type { ContentDraft } from "@51guapi/shared";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const draft: ContentDraft = {
	id: "d1",
	title: "AI 标题",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>正文</p>",
	tags: ["奇幻"],
	description: "",
	postStatus: "1",
	publishedAt: "",
	mediaId: "",
	status: "draft",
	createdAt: "2026-06-03T00:00:00.000Z",
};

const requestGenerate = vi.fn();
const requestFill = vi.fn();
const saveCurrentDraftMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);

vi.mock("../../lib/api/auth-client", () => ({
	isAuthenticated: vi.fn(async () => true),
	login: vi.fn(),
	getToken: vi.fn(),
	clearToken: vi.fn(),
	setToken: vi.fn(),
}));

vi.mock("../../lib/messaging", () => ({
	requestGenerate: (...a: unknown[]) => requestGenerate(...a),
	requestFill: (...a: unknown[]) => requestFill(...a),
	buildPrompt: (_t: string, topic: string) => topic,
}));

vi.mock("../../lib/storage", () => ({
	getSettings: async () => ({
		promptTemplate: "{{topic}}",
		endpoint: "",
		model: "",
		fieldMapping: {},
	}),
	getCurrentDraft: async () => null,
	saveCurrentDraft: saveCurrentDraftMock,
	clearCurrentDraft: async () => {},
}));

import { App } from "./App";

async function waitForAppReady() {
	await screen.findByText("51guapi 吃瓜小幫手");
}

describe("App", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		requestFill.mockReset();
		saveCurrentDraftMock.mockReset();
	});
	afterEach(() => cleanup());

	it("空主题点生成 → 提示输入主题", async () => {
		render(<App />);
		await waitForAppReady();
		fireEvent.click(screen.getByText("生成草稿"));
		expect(await screen.findByText(/请先输入主题/)).toBeTruthy();
		expect(requestGenerate).not.toHaveBeenCalled();
	});

	it("输入主题生成 → 渲染可编辑草稿预览", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		const titleInput = await screen.findByDisplayValue("AI 标题");
		expect(titleInput).toBeTruthy();
		expect(requestGenerate).toHaveBeenCalledWith("某新番");
	});

	it("生成失败(no-key)→ 显示去设置的提示", async () => {
		requestGenerate.mockResolvedValue({
			ok: false,
			kind: "no-key",
			error: "请先配置 key",
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		expect(await screen.findByText(/点右上角设置/)).toBeTruthy();
	});

	it("生成中显示进度条", async () => {
		requestGenerate.mockImplementation(() => new Promise(() => {}));
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		const progressbar = await screen.findByRole("progressbar");
		expect(progressbar).toBeTruthy();
	});

	it("生成完成后进度条消失", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		expect(screen.queryByRole("progressbar")).toBeNull();
	});

	it("生成失败时显示错误信息", async () => {
		requestGenerate.mockResolvedValue({
			ok: false,
			error: "网络超时，请重试",
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		expect(await screen.findByText("网络超时，请重试")).toBeTruthy();
	});
});

describe("App keyboard shortcuts and auto-save", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		requestFill.mockReset();
		saveCurrentDraftMock.mockClear();
	});
	afterEach(() => cleanup());

	it("Ctrl+Enter 触发生成草稿", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
		await waitFor(() => {
			expect(requestGenerate).toHaveBeenCalled();
		});
	});

	it("Ctrl+S 触发保存草稿", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		saveCurrentDraftMock.mockClear();
		fireEvent.keyDown(window, { key: "s", ctrlKey: true });
		await waitFor(() => {
			expect(saveCurrentDraftMock).toHaveBeenCalled();
		});
	});

	it("草稿变更时通过 useAutoSave 自动保存", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		saveCurrentDraftMock.mockClear();
		fireEvent.change(screen.getByDisplayValue("AI 标题"), {
			target: { value: "新标题" },
		});
		await waitFor(
			() => {
				expect(saveCurrentDraftMock).toHaveBeenCalled();
			},
			{ timeout: 2000 },
		);
	});
});

describe("App with error handling", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		requestFill.mockReset();
	});
	afterEach(() => cleanup());

	it("shows ErrorDisplay component when error occurs", async () => {
		requestGenerate.mockResolvedValue({
			ok: false,
			error: "网络错误",
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "测试选题" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await waitFor(() => {
			expect(screen.getByText("网络错误")).toBeTruthy();
		});
	});

	it("retry button triggers handleGenerate again", async () => {
		requestGenerate
			.mockResolvedValueOnce({ ok: false, error: "网络错误" })
			.mockResolvedValueOnce({ ok: true, draft });
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "测试选题" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await waitFor(() => {
			expect(screen.getByText("网络错误")).toBeTruthy();
		});
		fireEvent.click(screen.getByText("重试"));
		await waitFor(() => {
			expect(screen.getByDisplayValue("AI 标题")).toBeTruthy();
		});
	});
});

describe("App with keyboard shortcuts help", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		requestFill.mockReset();
		saveCurrentDraftMock.mockClear();
	});
	afterEach(() => cleanup());

	it("shows keyboard shortcuts help button", async () => {
		render(<App />);
		await waitForAppReady();
		expect(screen.getByLabelText("快捷键帮助")).toBeTruthy();
	});

	it("opens keyboard shortcuts dialog when clicked", async () => {
		render(<App />);
		await waitForAppReady();
		fireEvent.click(screen.getByLabelText("快捷键帮助"));
		expect(screen.getByText("快捷键帮助", { selector: "h3" })).toBeTruthy();
	});
});
