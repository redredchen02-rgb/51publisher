// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLoadingState } from "./useLoadingState";

describe("useLoadingState", () => {
	afterEach(cleanup);

	it("initializes with idle state", () => {
		const { result } = renderHook(() => useLoadingState());
		expect(result.current.state).toBe("idle");
		expect(result.current.progress).toBe(0);
	});

	it("transitions to loading state", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		expect(result.current.state).toBe("loading");
		expect(result.current.message).toBe("正在生成草稿...");
	});

	it("updates progress", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		act(() => {
			result.current.updateProgress(50);
		});
		expect(result.current.progress).toBe(50);
	});

	it("completes loading", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		act(() => {
			result.current.completeLoading();
		});
		expect(result.current.state).toBe("idle");
		expect(result.current.progress).toBe(0);
	});

	it("handles error", () => {
		const { result } = renderHook(() => useLoadingState());
		act(() => {
			result.current.startLoading("正在生成草稿...");
		});
		act(() => {
			result.current.handleError("生成失败");
		});
		expect(result.current.state).toBe("error");
		expect(result.current.error).toBe("生成失败");
	});
});
