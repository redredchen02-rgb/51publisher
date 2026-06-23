// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrajectoryRecord } from "../../lib/trajectory";
import { HistoryPanel } from "./HistoryPanel";

vi.mock("../../lib/storage", () => ({
	getTrajectory: vi.fn(async () => []),
}));
vi.mock("../../lib/trajectory", async (importActual) => {
	const actual = await importActual<typeof import("../../lib/trajectory")>();
	return {
		...actual,
		verifyTrajectory: vi.fn(() => true),
		rollbackTargets: vi.fn(
			(list: import("../../lib/trajectory").TrajectoryRecord[]) =>
				list.filter((r) => r.publishUrl),
		),
	};
});
vi.mock("../../lib/publish-feedback", () => ({
	getFeedback: vi.fn(async () => []),
	saveFeedback: vi.fn(async () => {}),
}));

import { getFeedback, saveFeedback } from "../../lib/publish-feedback";
import { getTrajectory } from "../../lib/storage";

function makeRecord(
	id: string,
	topic: string,
	opts: Partial<TrajectoryRecord> = {},
): TrajectoryRecord {
	return {
		id,
		topic,
		status: "publish-confirmed",
		ts: "2026-06-04T10:00:00.000Z",
		publishedAsDraft: false,
		fields: [],
		seq: 1,
		hash: "aabbccdd",
		...opts,
	};
}

describe("HistoryPanel", () => {
	afterEach(() => {
		cleanup();
		vi.mocked(getTrajectory).mockReset();
		vi.mocked(getFeedback).mockReset();
		vi.mocked(saveFeedback).mockReset();
	});

	it("empty trajectory → 暂无发布记录 empty state", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([]);
		const { findByText } = render(<HistoryPanel />);
		await findByText("暂无发布记录。");
	});

	it("3 records → renders 3 rows with topics", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-a"),
			makeRecord("r2", "topic-b"),
			makeRecord("r3", "topic-c"),
		]);
		render(<HistoryPanel />);
		expect(await screen.findByText(/topic-a/)).toBeTruthy();
		expect(screen.getByText(/topic-b/)).toBeTruthy();
		expect(screen.getByText(/topic-c/)).toBeTruthy();
	});

	it("record with publishUrl → 查看帖子 link rendered", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-x", { publishUrl: "https://example.com/post/1" }),
		]);
		render(<HistoryPanel />);
		const link = (await screen.findByText("查看帖子")) as HTMLAnchorElement;
		expect(link.href).toContain("example.com");
	});

	it("record without publishUrl → no broken link", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-x", { publishUrl: undefined }),
		]);
		render(<HistoryPanel />);
		await screen.findByText(/topic-x/);
		expect(screen.queryByText("查看帖子")).toBeNull();
	});

	it("25 records → only 20 shown; 加载更多 button visible", async () => {
		const records = Array.from({ length: 25 }, (_, i) =>
			makeRecord(`r${i}`, `topic-${i}`),
		);
		vi.mocked(getTrajectory).mockResolvedValue(records);
		render(<HistoryPanel />);
		await screen.findByText(/topic-24/); // newest-first: index 24 shown first
		const moreBtn = screen.getByText("加载更多");
		expect(moreBtn).toBeTruthy();
		// Only 20 visible initially (25 - 5 beyond page = not visible)
		expect(screen.queryByText(/topic-0/)).toBeNull(); // oldest, not shown yet
		fireEvent.click(moreBtn);
		expect(await screen.findByText(/topic-0/)).toBeTruthy();
	});

	it("chain intact → ✓ 链完整 banner (single record)", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([makeRecord("r1", "t")]);
		render(<HistoryPanel />);
		await screen.findByText(/链完整/);
	});

	it("publish-confirmed record → 三个评分按钮可见", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-a", { status: "publish-confirmed" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		render(<HistoryPanel />);
		await screen.findByText(/topic-a/);
		expect(screen.getByRole("button", { name: "good" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "ok" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "bad" })).toBeTruthy();
	});

	it("needs-human-verification record → 无评分按钮", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-b", { status: "needs-human-verification" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		render(<HistoryPanel />);
		await screen.findByText(/topic-b/);
		expect(screen.queryByRole("button", { name: "good" })).toBeNull();
	});

	it("error/aborted records → 无评分按钮", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "t1", { status: "error" }),
			makeRecord("r2", "t2", { status: "aborted" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		render(<HistoryPanel />);
		await screen.findByText(/t1/);
		expect(screen.queryByRole("button", { name: "good" })).toBeNull();
	});

	it("已有评分记录时 mount 后对应按钮为选中色", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-c", { status: "publish-confirmed" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([
			{
				itemId: "r1",
				topic: "topic-c",
				rating: "good",
				ts: "2026-06-16T00:00:00Z",
			},
		]);
		render(<HistoryPanel />);
		await screen.findByText(/topic-c/);
		const goodBtn = screen.getByRole("button", {
			name: "good",
		}) as HTMLButtonElement;
		expect(goodBtn.style.fontWeight).toBe("700");
	});

	it("点击评分 → 调用 saveFeedback 并传入正确参数", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-d", { status: "publish-confirmed" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		vi.mocked(saveFeedback).mockResolvedValue();
		render(<HistoryPanel />);
		await screen.findByText(/topic-d/);
		fireEvent.click(screen.getByRole("button", { name: "good" }));
		expect(vi.mocked(saveFeedback)).toHaveBeenCalledWith(
			expect.objectContaining({
				itemId: "r1",
				topic: "topic-d",
				rating: "good",
			}),
		);
	});

	it("saveFeedback 失败 → UI 回滚到未评分状态", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-e", { status: "publish-confirmed" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		vi.mocked(saveFeedback).mockRejectedValue(new Error("storage error"));
		render(<HistoryPanel />);
		await screen.findByText(/topic-e/);
		const goodBtn = screen.getByRole("button", { name: "good" });
		fireEvent.click(goodBtn);
		// 等待 promise reject 处理
		await new Promise((r) => setTimeout(r, 0));
		expect((goodBtn as HTMLButtonElement).style.fontWeight).toBe("400");
	});

	it("同一条目二次点击不同 rating → feedbackMap 更新为新值", async () => {
		vi.mocked(getTrajectory).mockResolvedValue([
			makeRecord("r1", "topic-f", { status: "publish-confirmed" }),
		]);
		vi.mocked(getFeedback).mockResolvedValue([]);
		vi.mocked(saveFeedback).mockResolvedValue();
		render(<HistoryPanel />);
		await screen.findByText(/topic-f/);
		fireEvent.click(screen.getByRole("button", { name: "good" }));
		fireEvent.click(screen.getByRole("button", { name: "bad" }));
		const calls = vi.mocked(saveFeedback).mock.calls;
		const lastCall = calls[calls.length - 1];
		expect(lastCall).toBeDefined();
		expect(lastCall?.[0]).toMatchObject({ rating: "bad" });
	});
});
