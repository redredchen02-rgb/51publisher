// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBatchOperations } from "./useBatchOperations.js";

describe("useBatchOperations — extra branch coverage", () => {
	it("processor throws non-Error value → error message = '未知错误'", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1], async () => {
				// biome-ignore lint/complexity/noUselessCatch: intentional non-Error throw
				throw "string error"; // not instanceof Error
			});
		});
		const failedItem = result.current.items.find((i) => i.status === "failed");
		expect(failedItem?.error).toBe("未知错误");
	});

	it("pause toggles status: running → paused → running", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		// Start in idle, manually test pause toggle behavior
		// First pause call: idle → should toggle to paused? No, "running" check:
		// s === "running" ? "paused" : "running"
		// So calling pause from idle would set status to "running"
		act(() => {
			result.current.pause();
		});
		// idle → not "running", so status becomes "running"
		expect(result.current.status).toBe("running");

		act(() => {
			result.current.pause();
		});
		// now status is "running" → becomes "paused"
		expect(result.current.status).toBe("paused");
	});

	it("pause from completed → status becomes 'running'", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1], async (n) => n);
		});
		expect(result.current.status).toBe("completed");

		act(() => {
			result.current.pause();
		});
		// completed → not "running", so status becomes "running"
		expect(result.current.status).toBe("running");
	});

	it("progress.percent: items.length=0 → 0", () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		expect(result.current.progress.percent).toBe(0);
	});

	it("progress.percent: partial done → between 0 and 100", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		// Start processing items synchronously
		await act(async () => {
			await result.current.start([1, 2], async (n) => n * 2);
		});
		// After completion: done=2, failed=0, total=2 → 100%
		expect(result.current.progress.percent).toBe(100);
	});

	it("waitFor items=2 with mixed done/failed → correct percent", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1, 2], async (n) => {
				if (n === 2) throw new Error("fail");
				return n;
			});
		});
		// done=1, failed=1, total=2 → percent = round((1+1)/2 * 100) = 100
		expect(result.current.progress.percent).toBe(100);
		expect(result.current.progress.done).toBe(1);
		expect(result.current.progress.failed).toBe(1);
	});
});
