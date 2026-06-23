// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchItem } from "../../../lib/batch";

vi.mock("../../../lib/messaging", () => ({
	resolveAdminTabId: vi.fn().mockResolvedValue(1),
	getBatchState: vi.fn().mockResolvedValue(null),
	runBatch: vi.fn().mockResolvedValue(null),
	approveSingleItem: vi.fn().mockResolvedValue(null),
	retryBatchItemMsg: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../lib/pending-client", () => ({
	fetchPendingTopics: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../lib/read-tracker", () => ({
	getReadItems: vi.fn().mockResolvedValue(new Set()),
	markItemRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/storage", () => ({
	getSettings: vi.fn().mockResolvedValue({ dailyBatchSize: 5 }),
}));

import {
	approveSingleItem,
	getBatchState,
	resolveAdminTabId,
	retryBatchItemMsg,
	runBatch,
} from "../../../lib/messaging";
import { fetchPendingTopics } from "../../../lib/pending-client";
import { useTodayBatchDomain } from "./useTodayBatchDomain.js";

const ITEM: BatchItem = {
	id: "i1",
	topic: "选题1",
	facts: {},
	status: "awaiting-approval",
};

describe("useTodayBatchDomain — extra branch coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(resolveAdminTabId).mockResolvedValue(1);
		vi.mocked(getBatchState).mockResolvedValue(null);
		vi.mocked(runBatch).mockResolvedValue(null);
		vi.mocked(approveSingleItem).mockResolvedValue(null);
		vi.mocked(retryBatchItemMsg).mockResolvedValue(null);
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("初始化时 activeBatch 有 items → stage=review, items 赋值", async () => {
		vi.mocked(getBatchState).mockResolvedValue({
			id: "batch-1",
			items: [ITEM],
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		expect(result.current.stage).toBe("review");
		expect(result.current.items).toHaveLength(1);
	});

	it("handleDailyBatch: 暂无选题 (topN.length=0) → error 提示，stage=idle", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([]);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.error).toContain("暂无待处理选题");
		expect(result.current.stage).toBe("idle");
		expect(result.current.busy).toBe(false);
	});

	it("handleDailyBatch: runBatch 返回 null → fallback items 从 topics 构建", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([
			{
				id: "t1",
				title: "选题A",
				facts: {},
				score: 1,
				status: "pending",
				createdAt: "2026-01-01T00:00:00.000Z",
				enrichmentText: undefined,
			},
		] as never);
		vi.mocked(runBatch).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.stage).toBe("review");
		expect(result.current.items.length).toBeGreaterThan(0);
		expect(result.current.items[0]?.topic).toBe("选题A");
	});

	it("handleDailyBatch: runBatch 返回 batch → items 从 batch.items", async () => {
		vi.mocked(fetchPendingTopics).mockResolvedValue([
			{
				id: "t1",
				title: "选题A",
				facts: {},
				score: 1,
				status: "pending",
				createdAt: "2026-01-01T00:00:00.000Z",
				enrichmentText: undefined,
			},
		] as never);
		const batchItems: BatchItem[] = [
			{ id: "i1", topic: "选题A", facts: {}, status: "queued" },
		];
		vi.mocked(runBatch).mockResolvedValue({
			id: "batch-1",
			items: batchItems,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.stage).toBe("review");
		expect(result.current.items).toEqual(batchItems);
	});

	it("handleDailyBatch: fetchPendingTopics throws → error 提示，stage=idle", async () => {
		vi.mocked(fetchPendingTopics).mockRejectedValue(new Error("network error"));

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.error).toContain("启动批量失败");
		expect(result.current.stage).toBe("idle");
		expect(result.current.busy).toBe(false);
	});

	it("handlePublish: 成功 → approveSingleItem called, items 更新", async () => {
		const updatedItems: BatchItem[] = [
			{ id: "i1", topic: "选题1", facts: {}, status: "publish-confirmed" },
		];
		vi.mocked(approveSingleItem).mockResolvedValue({
			id: "batch-1",
			items: updatedItems,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handlePublish(ITEM);
		});

		expect(approveSingleItem).toHaveBeenCalledWith(1, "i1");
		expect(result.current.items).toEqual(updatedItems);
	});

	it("handlePublish: approveSingleItem 返回 null → items 不更新", async () => {
		vi.mocked(approveSingleItem).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));
		// Preset items
		act(() =>
			result.current.setItems([
				{ id: "i1", topic: "选题1", facts: {}, status: "awaiting-approval" },
			]),
		);

		await act(async () => {
			await result.current.handlePublish(ITEM);
		});

		// items unchanged
		expect(result.current.items).toHaveLength(1);
		expect(result.current.items[0]?.status).toBe("awaiting-approval");
	});

	it("handlePublish: throws → error 提示", async () => {
		vi.mocked(approveSingleItem).mockRejectedValue(new Error("publish failed"));

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handlePublish(ITEM);
		});

		expect(result.current.error).toContain("发布失败");
	});

	it("handlePublish: adminTabId=null → 早期返回", async () => {
		vi.mocked(resolveAdminTabId).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		await act(async () => {
			await result.current.handlePublish(ITEM);
		});

		expect(approveSingleItem).not.toHaveBeenCalled();
	});

	it("handleApproveAll: adminTabId=null → 早期返回", async () => {
		vi.mocked(resolveAdminTabId).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		await act(async () => {
			await result.current.handleApproveAll([ITEM]);
		});

		expect(approveSingleItem).not.toHaveBeenCalled();
	});

	it("handleApproveAll: approveSingleItem 返回 batch → setItems called", async () => {
		const updatedItems: BatchItem[] = [
			{ id: "i1", topic: "选题1", facts: {}, status: "publish-confirmed" },
		];
		vi.mocked(approveSingleItem).mockResolvedValue({
			id: "batch-1",
			items: updatedItems,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		const targets: BatchItem[] = [
			{ id: "i1", topic: "选题1", facts: {}, status: "awaiting-approval" },
		];

		await act(async () => {
			await result.current.handleApproveAll(targets);
		});

		expect(result.current.items).toEqual(updatedItems);
	});

	it("handleApproveAll: approveSingleItem throws → error 提示, 继续下一条", async () => {
		vi.mocked(approveSingleItem).mockRejectedValue(new Error("failed"));

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		const targets: BatchItem[] = [
			{ id: "i1", topic: "选题1", facts: {}, status: "awaiting-approval" },
			{ id: "i2", topic: "选题2", facts: {}, status: "awaiting-approval" },
		];

		await act(async () => {
			await result.current.handleApproveAll(targets);
		});

		// Called twice - both items attempted
		expect(approveSingleItem).toHaveBeenCalledTimes(2);
		expect(result.current.error).toContain("发布失败");
	});

	it("handleRetry: 成功 → retryBatchItemMsg called, items 更新", async () => {
		const updatedItems: BatchItem[] = [
			{ id: "i1", topic: "选题1", facts: {}, status: "queued" },
		];
		vi.mocked(retryBatchItemMsg).mockResolvedValue({
			id: "batch-1",
			items: updatedItems,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		await act(async () => {
			await result.current.handleRetry("i1");
		});

		expect(retryBatchItemMsg).toHaveBeenCalledWith("i1");
		expect(result.current.items).toEqual(updatedItems);
	});

	it("handleRetry: retryBatchItemMsg 返回 null → items 不更新", async () => {
		vi.mocked(retryBatchItemMsg).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});
		act(() =>
			result.current.setItems([
				{ id: "i1", topic: "选题1", facts: {}, status: "error" },
			]),
		);

		await act(async () => {
			await result.current.handleRetry("i1");
		});

		expect(result.current.items[0]?.status).toBe("error");
	});

	it("handleRetry: throws → error 提示", async () => {
		vi.mocked(retryBatchItemMsg).mockRejectedValue(new Error("retry failed"));

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		await act(async () => {
			await result.current.handleRetry("i1");
		});

		expect(result.current.error).toContain("重试失败");
	});

	it("handleDailyBatch: runBatch throws → catch clears progressPoll + error, stage=idle", async () => {
		// This covers L201-203: progressPollRef.current is set before runBatch, then runBatch throws
		vi.mocked(fetchPendingTopics).mockResolvedValue([
			{
				id: "t1",
				title: "选题A",
				facts: {},
				score: 1,
				status: "pending",
				createdAt: "2026-01-01T00:00:00.000Z",
				enrichmentText: undefined,
			},
		] as never);
		vi.mocked(runBatch).mockRejectedValue(new Error("runBatch crashed"));

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.error).toContain("启动批量失败");
		expect(result.current.stage).toBe("idle");
		expect(result.current.busy).toBe(false);
	});

	it("stage=review pollRef: getBatchState returns null → early return (no setItems)", async () => {
		// L117: if (!batch) return
		vi.useFakeTimers();
		vi.mocked(getBatchState).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {
			await Promise.resolve();
		});

		// Set non-terminal items and stage=review to start pollRef interval
		act(() => {
			result.current.setItems([
				{ id: "i1", topic: "t1", facts: {}, status: "queued" },
			]);
			result.current.setStage("review");
		});

		const prevItems = result.current.items;

		// Advance timer to trigger poll interval
		await act(async () => {
			vi.advanceTimersByTime(1501);
			await Promise.resolve();
		});

		// items unchanged since batch was null
		expect(result.current.items).toEqual(prevItems);

		vi.useRealTimers();
	});

	it("stage=review pollRef: terminal batch → clears interval", async () => {
		// L119-122: isAllTerminal(batch.items) → clearInterval
		vi.useFakeTimers();

		const terminalItems: BatchItem[] = [
			{ id: "i1", topic: "t1", facts: {}, status: "publish-confirmed" },
		];

		// getBatchState returns null on initial load, then terminal batch when poll fires
		vi.mocked(getBatchState).mockResolvedValueOnce(null); // initial mount

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {
			await Promise.resolve();
		});

		// Set non-terminal items and review stage to start poll
		vi.mocked(getBatchState).mockResolvedValue({
			id: "b1",
			items: terminalItems,
			status: "completed",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		act(() => {
			result.current.setItems([
				{ id: "i1", topic: "t1", facts: {}, status: "queued" },
			]);
			result.current.setStage("review");
		});

		// Advance timer to trigger poll
		await act(async () => {
			vi.advanceTimersByTime(1501);
			await Promise.resolve();
		});

		// items should be updated to terminal items
		expect(result.current.items).toEqual(terminalItems);

		vi.useRealTimers();
	});

	it("handleDailyBatch: progressPoll getBatchState returns batch → setItems called during poll", async () => {
		// L164-165: inside progressPoll, if (batch) setItems(batch.items)
		// We use fake timers to trigger the interval callback
		vi.useFakeTimers();
		const polledItems: BatchItem[] = [
			{ id: "p1", topic: "polling-item", facts: {}, status: "queued" },
		];
		vi.mocked(fetchPendingTopics).mockResolvedValue([
			{
				id: "t1",
				title: "选题A",
				facts: {},
				score: 1,
				status: "pending",
				createdAt: "2026-01-01T00:00:00.000Z",
				enrichmentText: undefined,
			},
		] as never);

		// runBatch resolves after a tick (we advance timer to trigger poll first)
		let resolveBatch!: (v: unknown) => void;
		vi.mocked(runBatch).mockReturnValue(
			new Promise((res) => {
				resolveBatch = res;
			}) as never,
		);
		// getBatchState returns batch data on first call (from poll), null on subsequent
		vi.mocked(getBatchState).mockResolvedValue(null); // initial load
		// After handleDailyBatch starts, getBatchState will be called by progressPoll

		const { result } = renderHook(() => useTodayBatchDomain());

		// Wait for initial mount
		await act(async () => {
			await Promise.resolve();
		});

		// Reset getBatchState to return poll data
		vi.mocked(getBatchState).mockResolvedValue({
			id: "b1",
			items: polledItems,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
		} as never);

		// Start handleDailyBatch in background
		const batchPromise = act(async () => {
			const p = result.current.handleDailyBatch();
			// Advance timer 2000ms to trigger progressPoll interval
			await act(async () => {
				vi.advanceTimersByTime(2001);
				await Promise.resolve();
			});
			// Now resolve runBatch
			resolveBatch(null);
			await p;
		});

		await batchPromise;

		vi.useRealTimers();
	});
});
