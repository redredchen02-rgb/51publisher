// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave.js";

afterEach(() => vi.useRealTimers());

describe("useAutoSave", () => {
	it("首次挂载不触发保存", () => {
		vi.useFakeTimers();
		const onSave = vi.fn();
		renderHook(() => useAutoSave({ value: "initial", onSave, debounceMs: 200 }));
		vi.advanceTimersByTime(300);
		expect(onSave).not.toHaveBeenCalled();
	});

	it("value 变化后 debounce 触发保存", () => {
		vi.useFakeTimers();
		const onSave = vi.fn();
		const { rerender } = renderHook(
			({ value }: { value: string }) =>
				useAutoSave({ value, onSave, debounceMs: 200 }),
			{ initialProps: { value: "a" } },
		);
		rerender({ value: "b" });
		vi.advanceTimersByTime(200);
		expect(onSave).toHaveBeenCalledWith("b");
	});

	it("快速连续变化只触发一次保存", () => {
		vi.useFakeTimers();
		const onSave = vi.fn();
		const { rerender } = renderHook(
			({ value }: { value: string }) =>
				useAutoSave({ value, onSave, debounceMs: 200 }),
			{ initialProps: { value: "a" } },
		);
		rerender({ value: "b" });
		rerender({ value: "c" });
		rerender({ value: "d" });
		vi.advanceTimersByTime(200);
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave).toHaveBeenCalledWith("d");
	});

	it("disabled 时不触发保存", () => {
		vi.useFakeTimers();
		const onSave = vi.fn();
		const { rerender } = renderHook(
			({ value, enabled }: { value: string; enabled: boolean }) =>
				useAutoSave({ value, onSave, debounceMs: 200, enabled }),
			{ initialProps: { value: "a", enabled: false } },
		);
		rerender({ value: "b", enabled: false });
		vi.advanceTimersByTime(300);
		expect(onSave).not.toHaveBeenCalled();
	});
});
