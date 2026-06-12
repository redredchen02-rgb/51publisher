// @vitest-environment jsdom

import type { ContentDraft } from "@51publisher/shared";
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

vi.mock("../../lib/auth-client", () => ({
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
	await screen.findByText("51publisher 填充助手");
}

describe("App", () => {
	beforeEach(() => {
		requestGenerate.mockReset();
		requestFill.mockReset();
		saveCurrentDraftMock.mockReset();
	});
	afterEach(() => cleanup());

	it("常驻显示「不会自动发布」提示", async () => {
		render(<App />);
		await waitForAppReady();
		expect(screen.getByText(/不会自动发布/)).toBeTruthy();
	});

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

	it("填充 → 显示结果面板;有问题字段进入 partial", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		requestFill.mockResolvedValue({
			ok: true,
			results: [
				{ field: "title", status: "filled" },
				{ field: "body", status: "degraded", note: "需手动" },
			],
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		fireEvent.click(screen.getByText("填充到当前页"));
		await waitFor(() => expect(screen.getByText("填充结果")).toBeTruthy());
		expect(screen.getByText(/未完整填入/)).toBeTruthy();
		expect(screen.getByText("复制正文")).toBeTruthy();
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

	it("填充成功 → 显示成功 toast", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		requestFill.mockResolvedValue({
			ok: true,
			results: [{ field: "title", status: "filled" }],
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		fireEvent.click(screen.getByText("填充到当前页"));
		await waitFor(() => {
			expect(screen.getByText("填充成功")).toBeTruthy();
		});
	});

	it("填充失败 → 显示错误 toast", async () => {
		requestGenerate.mockResolvedValue({ ok: true, draft });
		requestFill.mockResolvedValue({
			ok: false,
			error: "填充出错",
		});
		render(<App />);
		await waitForAppReady();
		fireEvent.change(screen.getByPlaceholderText(/输入选题/), {
			target: { value: "某新番" },
		});
		fireEvent.click(screen.getByText("生成草稿"));
		await screen.findByDisplayValue("AI 标题");
		fireEvent.click(screen.getByText("填充到当前页"));
		await waitFor(() => {
			const matches = screen.getAllByText("填充出错");
			expect(matches.length).toBeGreaterThanOrEqual(1);
		});
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
