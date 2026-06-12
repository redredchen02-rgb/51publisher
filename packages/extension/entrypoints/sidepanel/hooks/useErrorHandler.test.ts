// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useErrorHandler } from "./useErrorHandler";

describe("useErrorHandler", () => {
	it("initializes with no error", () => {
		const { result } = renderHook(() => useErrorHandler());
		expect(result.current.error).toBeNull();
		expect(result.current.isRetrying).toBe(false);
	});

	it("captures error", () => {
		const { result } = renderHook(() => useErrorHandler());

		act(() => {
			result.current.handleError(new Error("测试错误"));
		});

		expect(result.current.error).toBe("测试错误");
	});

	it("clears error", () => {
		const { result } = renderHook(() => useErrorHandler());

		act(() => {
			result.current.handleError(new Error("测试错误"));
		});

		act(() => {
			result.current.clearError();
		});

		expect(result.current.error).toBeNull();
	});

	it("retries operation", async () => {
		const { result } = renderHook(() => useErrorHandler());
		const mockOperation = vi
			.fn()
			.mockRejectedValueOnce(new Error("第一次失败"))
			.mockResolvedValueOnce("成功");

		await act(async () => {
			await result.current.retry(mockOperation);
		});

		expect(mockOperation).toHaveBeenCalledTimes(2);
		expect(result.current.error).toBeNull();
	});

	it("handles retry failure", async () => {
		const { result } = renderHook(() => useErrorHandler());
		const mockOperation = vi.fn().mockRejectedValue(new Error("持续失败"));

		await act(async () => {
			await result.current.retry(mockOperation);
		});

		expect(mockOperation).toHaveBeenCalledTimes(3);
		expect(result.current.error).toBe("持续失败");
	});

	it("respects max retries", async () => {
		const { result } = renderHook(() => useErrorHandler());
		const mockOperation = vi.fn().mockRejectedValue(new Error("失败"));

		await act(async () => {
			await result.current.retry(mockOperation, 2);
		});

		expect(mockOperation).toHaveBeenCalledTimes(2);
	});
});
