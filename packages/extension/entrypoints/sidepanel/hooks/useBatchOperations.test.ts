// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBatchOperations } from "./useBatchOperations.js";

describe("useBatchOperations", () => {
	it("初始状态", () => {
		const { result } = renderHook(() => useBatchOperations<string, number>());
		expect(result.current.status).toBe("idle");
		expect(result.current.items).toHaveLength(0);
		expect(result.current.progress.percent).toBe(0);
	});

	it("成功批量处理", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1, 2, 3], async (n) => n * 2);
		});
		expect(result.current.status).toBe("completed");
		expect(result.current.results).toEqual([2, 4, 6]);
		expect(result.current.progress.done).toBe(3);
		expect(result.current.progress.failed).toBe(0);
	});

	it("处理失败的项目标记为 failed", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1, 2, 3], async (n) => {
				if (n === 2) throw new Error("fail");
				return n;
			});
		});
		expect(result.current.progress.failed).toBe(1);
		expect(result.current.progress.done).toBe(2);
		expect(result.current.items.find((i) => i.status === "failed")?.error).toBe(
			"fail",
		);
	});

	it("reset 恢复初始状态", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([1], async (n) => n);
		});
		act(() => result.current.reset());
		expect(result.current.status).toBe("idle");
		expect(result.current.items).toHaveLength(0);
	});

	it("空输入立即完成", async () => {
		const { result } = renderHook(() => useBatchOperations<number, number>());
		await act(async () => {
			await result.current.start([], async (n) => n);
		});
		expect(result.current.status).toBe("completed");
		expect(result.current.progress.percent).toBe(0);
	});
});
