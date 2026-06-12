// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import type { PendingTopic } from "../../lib/pending-client";
import { TodayBatchView } from "./TodayBatchView";

// ---- mocks ----

vi.mock("../../lib/pending-client", () => ({
	fetchPendingTopics: vi.fn(async () => []),
}));

vi.mock("../../lib/messaging", () => ({
	resolveAdminTabId: vi.fn(async () => 1),
	runBatch: vi.fn(async () => null),
}));

vi.mock("../../lib/storage", () => ({
	getSettings: vi.fn(async () => ({ dailyBatchSize: 5 })),
}));

import { resolveAdminTabId, runBatch } from "../../lib/messaging";
import { fetchPendingTopics } from "../../lib/pending-client";
import { getSettings } from "../../lib/storage";

function makeTopic(
	id: string,
	overrides: Partial<PendingTopic> = {},
): PendingTopic {
	return {
		id,
		sourceUrl: `https://example.com/${id}`,
		siteName: "test-site",
		title: `选题 ${id}`,
		facts: {
			作品名: "测试作品",
			集数: "01",
			制作: "",
			漢化: "",
			無修: "",
			题材: "",
			简介: "",
		},
		confidence: 0.9,
		status: "pending",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

beforeEach(async () => {
	fakeBrowser.reset();
	await fakeBrowser.tabs.create({ url: "https://example.com", active: true });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

// ================================================================
// U8 — TodayBatchView
// ================================================================

describe("U8 — TodayBatchView", () => {
	it("渲染「一键备稿」按钮", async () => {
		render(<TodayBatchView onBack={vi.fn()} />);
		await waitFor(() => expect(screen.getByText("一键备稿")).toBeTruthy());
	});

	it("resolveAdminTabId 返回 null 时显示 tab 错误", async () => {
		vi.mocked(resolveAdminTabId).mockResolvedValue(null);
		render(<TodayBatchView onBack={vi.fn()} />);
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"未找到后台发帖页",
			),
		);
	});

	it("点击「一键备稿」时以正确的 topicIds 调用 runBatch", async () => {
		const topics = [makeTopic("t1"), makeTopic("t2"), makeTopic("t3")];
		vi.mocked(fetchPendingTopics).mockResolvedValue(topics);
		vi.mocked(resolveAdminTabId).mockResolvedValue(42);

		render(<TodayBatchView onBack={vi.fn()} />);

		// Wait for async effect to fully resolve — batch size text confirms settings loaded
		await waitFor(() => {
			expect(screen.getByText("5")).toBeTruthy();
		});

		fireEvent.click(screen.getByText("一键备稿"));

		await waitFor(() => expect(runBatch).toHaveBeenCalled());
		const [calledTopics, calledTabId, calledFacts, , , calledTopicIds] = (
			runBatch as ReturnType<typeof vi.fn>
		).mock.calls[0] as [
			string[],
			number,
			Record<string, string>[],
			undefined,
			undefined,
			string[],
		];

		expect(calledTabId).toBe(42);
		expect(calledTopics).toEqual(["选题 t1", "选题 t2", "选题 t3"]);
		expect(calledTopicIds).toEqual(["t1", "t2", "t3"]);
		expect(calledFacts).toHaveLength(3);
	});

	it("遵守 dailyBatchSize:只发送 N 条选题", async () => {
		// 后端返回 10 条,设置限 3 条。
		vi.mocked(getSettings).mockResolvedValue({ dailyBatchSize: 3 } as never);
		const allTopics = Array.from({ length: 10 }, (_, i) => makeTopic(`t${i}`));
		vi.mocked(fetchPendingTopics).mockResolvedValue(allTopics);
		vi.mocked(resolveAdminTabId).mockResolvedValue(1);

		render(<TodayBatchView onBack={vi.fn()} />);
		await waitFor(() => screen.getByText("一键备稿"));

		fireEvent.click(screen.getByText("一键备稿"));

		await waitFor(() => expect(runBatch).toHaveBeenCalled());
		const [calledTopics] = (runBatch as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string[]];
		expect(calledTopics).toHaveLength(3);
	});
});
