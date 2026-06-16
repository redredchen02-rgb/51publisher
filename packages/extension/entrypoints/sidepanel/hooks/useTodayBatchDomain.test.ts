// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useTodayBatchDomain } from "./useTodayBatchDomain.js";

describe("useTodayBatchDomain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("初始状态：stage=idle, busy=false, items=[]", async () => {
		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});
		expect(result.current.stage).toBe("idle");
		expect(result.current.busy).toBe(false);
		expect(result.current.items).toHaveLength(0);
		expect(result.current.error).toBe("");
	});

	it("初始化加载 dailyBatchSize 和 adminTabId", async () => {
		const { getSettings } = await import("../../../lib/storage");
		vi.mocked(getSettings).mockResolvedValue({ dailyBatchSize: 10 } as never);
		const { resolveAdminTabId } = await import("../../../lib/messaging");
		vi.mocked(resolveAdminTabId).mockResolvedValue(42);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		expect(result.current.dailyBatchSize).toBe(10);
		expect(result.current.adminTabId).toBe(42);
	});

	it("adminTabId=null 时 tabError 有提示", async () => {
		const { resolveAdminTabId } = await import("../../../lib/messaging");
		vi.mocked(resolveAdminTabId).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		expect(result.current.tabError).toMatch(/未找到后台发帖页/);
	});

	it("handleDailyBatch: adminTabId=null 时提前返回, stage 保持 idle", async () => {
		const { resolveAdminTabId } = await import("../../../lib/messaging");
		vi.mocked(resolveAdminTabId).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});
		await act(async () => {
			await result.current.handleDailyBatch();
		});

		expect(result.current.stage).toBe("idle");
		expect(result.current.busy).toBe(false);
	});

	it("handleToggleRead: 标记已读并更新 readItems", async () => {
		const { markItemRead } = await import("../../../lib/read-tracker");
		vi.mocked(markItemRead).mockResolvedValue(undefined);

		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});
		await act(async () => {
			result.current.handleToggleRead("item-1");
		});

		expect(markItemRead).toHaveBeenCalledWith("item-1");
		expect(result.current.readItems.has("item-1")).toBe(true);
	});

	it("handleApproveAll 逐條呼叫 approveSingleItem", async () => {
		const { approveSingleItem, resolveAdminTabId } = await import("../../../lib/messaging");
		vi.mocked(resolveAdminTabId).mockResolvedValue(1);
		const mockApprove = vi.mocked(approveSingleItem).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		const targets = [
			{ id: "a1", topic: "t1", facts: {}, status: "awaiting-approval" as const },
			{ id: "a2", topic: "t2", facts: {}, status: "awaiting-approval" as const },
		];

		await act(async () => {
			await result.current.handleApproveAll(targets);
		});

		expect(mockApprove).toHaveBeenCalledTimes(2);
		expect(mockApprove).toHaveBeenCalledWith(1, "a1");
		expect(mockApprove).toHaveBeenCalledWith(1, "a2");
	});

	it("handleApproveAll 跳過非 awaiting-approval 條目", async () => {
		const { approveSingleItem, resolveAdminTabId } = await import("../../../lib/messaging");
		vi.mocked(resolveAdminTabId).mockResolvedValue(1);
		const mockApprove = vi.mocked(approveSingleItem).mockResolvedValue(null);

		const { result } = renderHook(() => useTodayBatchDomain());
		await waitFor(() => expect(result.current.adminTabId).toBe(1));

		const mixed = [
			{ id: "b1", topic: "t1", facts: {}, status: "awaiting-approval" as const },
			{ id: "b2", topic: "t2", facts: {}, status: "filled" as const },
		];

		await act(async () => {
			await result.current.handleApproveAll(mixed);
		});

		expect(mockApprove).toHaveBeenCalledTimes(1);
		expect(mockApprove).toHaveBeenCalledWith(1, "b1");
	});

	it("setStage / setItems / setError 正确更新状态", async () => {
		const { result } = renderHook(() => useTodayBatchDomain());
		await act(async () => {});

		act(() => result.current.setStage("review"));
		expect(result.current.stage).toBe("review");

		act(() => result.current.setError("测试错误"));
		expect(result.current.error).toBe("测试错误");

		act(() =>
			result.current.setItems([
				{ id: "x", topic: "t", facts: {}, status: "queued" },
			]),
		);
		expect(result.current.items).toHaveLength(1);
	});
});
