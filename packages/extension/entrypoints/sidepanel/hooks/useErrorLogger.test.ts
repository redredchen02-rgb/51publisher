// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useErrorLogger } from "./useErrorLogger";

vi.mock("../../../lib/storage/chrome-storage-utils", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../../lib/storage/chrome-storage-utils")
		>();
	return { ...actual };
});

describe("useErrorLogger", () => {
	afterEach(() => {
		cleanup();
	});

	it("initializes with empty logs", () => {
		const { result } = renderHook(() => useErrorLogger());
		expect(result.current.logs).toEqual([]);
	});

	it("logs error", async () => {
		const { result } = renderHook(() => useErrorLogger());

		await act(async () => {
			await result.current.logError(new Error("测试错误"), {
				context: "测试",
			});
		});

		expect(result.current.logs).toHaveLength(1);
		expect(result.current.logs[0]?.message).toBe("测试错误");
	});

	it("exports error logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		await act(async () => {
			await result.current.logError(new Error("测试错误"));
		});

		const exported = result.current.exportLogs();
		expect(exported).toContain("测试错误");
	});

	it("keeps only last 100 logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		// Log 105 errors
		for (let i = 0; i < 105; i++) {
			await act(async () => {
				await result.current.logError(new Error(`错误 ${i}`));
			});
		}

		expect(result.current.logs).toHaveLength(100);
		expect(result.current.logs[0]?.message).toBe("错误 104");
		expect(result.current.logs[99]?.message).toBe("错误 5");
	});

	it("clears error logs", async () => {
		const { result } = renderHook(() => useErrorLogger());

		// Add some logs — separate act to avoid stale closure
		await act(async () => {
			await result.current.logError(new Error("错误1"));
		});
		await act(async () => {
			await result.current.logError(new Error("错误2"));
		});

		expect(result.current.logs).toHaveLength(2);

		// Clear logs
		await act(async () => {
			await result.current.clearLogs();
		});

		expect(result.current.logs).toEqual([]);
	});

	it("retrieveLogs: storage null 时静默跳过(不抛出)", async () => {
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValueOnce(null);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.retrieveLogs();
		});
		expect(result.current.logs).toEqual([]);
	});

	it("clearLogs: storage null 时静默跳过(不抛出)", async () => {
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValueOnce(null);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.clearLogs();
		});
		expect(result.current.logs).toEqual([]);
	});
});
