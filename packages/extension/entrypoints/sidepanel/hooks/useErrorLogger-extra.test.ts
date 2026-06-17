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

describe("useErrorLogger — storage path coverage", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("retrieveLogs: storage returns data → logs populated", async () => {
		const storedLogs = [
			{
				id: "log-1",
				message: "stored error",
				timestamp: "2026-01-01T00:00:00.000Z",
			},
		];
		const mockStorage = {
			get: vi.fn().mockResolvedValue({ "pfa-error-logs": storedLogs }),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.retrieveLogs();
		});
		expect(result.current.logs).toHaveLength(1);
		expect(result.current.logs[0]?.message).toBe("stored error");
	});

	it("retrieveLogs: storage returns null result → logs = []", async () => {
		const mockStorage = {
			get: vi.fn().mockResolvedValue(null),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.retrieveLogs();
		});
		expect(result.current.logs).toEqual([]);
	});

	it("clearLogs: storage non-null → remove called", async () => {
		const removeFn = vi.fn().mockResolvedValue(undefined);
		const mockStorage = {
			get: vi.fn(),
			set: vi.fn(),
			remove: removeFn,
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.clearLogs();
		});
		expect(removeFn).toHaveBeenCalledWith("pfa-error-logs");
	});

	it("retrieveLogs: storage.get throws → silent, logs unchanged", async () => {
		const mockStorage = {
			get: vi.fn().mockRejectedValue(new Error("storage error")),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useErrorLogger());
		await act(async () => {
			await result.current.retrieveLogs();
		});
		expect(result.current.logs).toEqual([]);
	});
});
