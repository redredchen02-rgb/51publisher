// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/chrome-storage-utils", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../lib/chrome-storage-utils")>();
	return { ...actual };
});

import { usePersistedState } from "./usePersistedState";

describe("usePersistedState — storage null branch coverage", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("getStorage() returns null on mount → no setState, value stays default", async () => {
		const mod = await import("../../../lib/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(null);

		const { result } = renderHook(() =>
			usePersistedState("test-null-key", "default"),
		);

		// Wait for useEffect to fire
		await act(async () => {
			await Promise.resolve();
		});

		// Value should remain at default since storage was null
		expect(result.current[0]).toBe("default");
	});

	it("getStorage() returns null in setValue → value updated in state but not persisted", async () => {
		const mod = await import("../../../lib/chrome-storage-utils");
		vi.spyOn(mod, "getStorage").mockReturnValue(null);

		const { result } = renderHook(() =>
			usePersistedState("test-null-key2", "initial"),
		);

		act(() => {
			result.current[1]("updated");
		});

		// State should update even without storage
		expect(result.current[0]).toBe("updated");
	});
});
