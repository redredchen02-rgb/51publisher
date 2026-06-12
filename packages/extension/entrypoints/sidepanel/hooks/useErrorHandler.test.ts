// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useErrorHandler } from "./useErrorHandler.js";

describe("useErrorHandler", () => {
	it("初始状态:无错误,日志为空", () => {
		const { result } = renderHook(() => useErrorHandler());
		expect(result.current.error).toBe("");
		expect(result.current.errorLog).toHaveLength(0);
	});

	it("setError 设置错误信息", () => {
		const { result } = renderHook(() => useErrorHandler());
		act(() => result.current.setError("出错了"));
		expect(result.current.error).toBe("出错了");
	});

	it("setError 追加到日志", () => {
		const { result } = renderHook(() => useErrorHandler());
		act(() => result.current.setError("e1", "E001"));
		act(() => result.current.setError("e2"));
		expect(result.current.errorLog).toHaveLength(2);
		expect(result.current.errorLog[0]?.code).toBe("E001");
	});

	it("clearError 清除当前错误", () => {
		const { result } = renderHook(() => useErrorHandler());
		act(() => result.current.setError("出错了"));
		act(() => result.current.clearError());
		expect(result.current.error).toBe("");
	});

	it("withErrorHandling 成功时返回结果", async () => {
		const { result } = renderHook(() => useErrorHandler());
		const value = await act(async () =>
			result.current.withErrorHandling(async () => 42),
		);
		expect(value).toBe(42);
		expect(result.current.error).toBe("");
	});

	it("withErrorHandling 失败时设置错误并返回 undefined", async () => {
		const { result } = renderHook(() => useErrorHandler());
		const value = await act(async () =>
			result.current.withErrorHandling(async () => {
				throw new Error("网络超时");
			}),
		);
		expect(value).toBeUndefined();
		expect(result.current.error).toBe("网络超时");
	});

	it("withErrorHandling 使用 fallback 错误文本", async () => {
		const { result } = renderHook(() => useErrorHandler());
		await act(async () =>
			result.current.withErrorHandling(async () => {
				throw new Error("原始错误");
			}, "自定义错误信息"),
		);
		expect(result.current.error).toBe("自定义错误信息");
	});
});
