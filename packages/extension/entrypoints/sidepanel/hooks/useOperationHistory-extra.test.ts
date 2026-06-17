// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOperationHistory } from "./useOperationHistory";

vi.mock("../../../lib/storage/chrome-storage-utils", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../../../lib/storage/chrome-storage-utils")
		>();
	return { ...actual };
});

describe("useOperationHistory — storage path coverage", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("retrieveHistory: storage returns data → history populated", async () => {
		const storedHistory = [
			{
				id: "op-1",
				type: "generate",
				topic: "stored-topic",
				success: true,
				timestamp: "2026-01-01T00:00:00.000Z",
			},
		];
		const mockStorage = {
			get: vi
				.fn()
				.mockResolvedValue({ "pfa-operation-history": storedHistory }),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useOperationHistory());
		await act(async () => {
			await result.current.retrieveHistory();
		});
		expect(result.current.history).toHaveLength(1);
		expect(result.current.history[0]?.topic).toBe("stored-topic");
	});

	it("retrieveHistory: storage returns null result → history = []", async () => {
		const mockStorage = {
			get: vi.fn().mockResolvedValue(null),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useOperationHistory());
		await act(async () => {
			await result.current.retrieveHistory();
		});
		expect(result.current.history).toEqual([]);
	});

	it("clearHistory: storage non-null → remove called", async () => {
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
		const { result } = renderHook(() => useOperationHistory());
		await act(async () => {
			await result.current.clearHistory();
		});
		expect(removeFn).toHaveBeenCalledWith("pfa-operation-history");
	});

	it("retrieveHistory: storage.get throws → silent, history unchanged", async () => {
		const mockStorage = {
			get: vi.fn().mockRejectedValue(new Error("storage error")),
			set: vi.fn(),
			remove: vi.fn(),
		};
		const mod = await import("../../../lib/storage/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(
			mockStorage as unknown as ReturnType<typeof mod.getStorage>,
		);
		const { result } = renderHook(() => useOperationHistory());
		await act(async () => {
			await result.current.retrieveHistory();
		});
		expect(result.current.history).toEqual([]);
	});
});
