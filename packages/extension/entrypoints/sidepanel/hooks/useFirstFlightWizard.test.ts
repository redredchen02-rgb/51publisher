// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	apiFetch: vi.fn(),
	firstFlightRehearse: vi.fn(),
	firstFlightRun: vi.fn(),
	firstFlightStatus: vi.fn(),
}));

vi.mock("../../../lib/api-fetch", () => ({
	apiFetch: mocks.apiFetch,
}));

vi.mock("../../../lib/messaging", () => ({
	firstFlightRehearse: mocks.firstFlightRehearse,
	firstFlightRun: mocks.firstFlightRun,
	firstFlightStatus: mocks.firstFlightStatus,
}));

vi.mock("../firstflight/types", () => ({
	lastLabel: (host: string) => host.split(".")[0] ?? host,
}));

import { useFirstFlightWizard } from "./useFirstFlightWizard";

const TAB_ID = 1;
const ITEM_ID = "item_0";
const HOST = "dx-999-adm.ympxbys.xyz";
const GESTURE = "dx-999-adm"; // lastLabel("dx-999-adm.ympxbys.xyz") = "dx-999-adm"

function makeOkFetch(data: unknown) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => data,
	});
}

describe("useFirstFlightWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: preflight ok, status no bad
		mocks.apiFetch.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ready: true }),
		});
		mocks.firstFlightStatus.mockResolvedValue({ bad: false });
	});

	afterEach(() => {
		cleanup();
	});

	it("initial state: step=1, preflight loads on mount", async () => {
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await waitFor(() => expect(result.current.preflight).not.toBeNull());
		expect(result.current.step).toBe(1);
		expect(result.current.rehearsal).toBeNull();
		expect(result.current.runResult).toBeNull();
	});

	it("preflight fetch fails (non-ok) → preflightError set", async () => {
		mocks.apiFetch.mockResolvedValue({ ok: false, status: 503, json: vi.fn() });
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await waitFor(() => expect(result.current.preflightError).toContain("503"));
	});

	it("preflight fetch throws → preflightError set", async () => {
		mocks.apiFetch.mockRejectedValue(new Error("network error"));
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await waitFor(() =>
			expect(result.current.preflightError).toContain("无法连接"),
		);
	});

	it("handleRehearse success → rehearsal set", async () => {
		mocks.apiFetch.mockResolvedValue({
			ok: true,
			json: async () => ({ ready: true }),
		});
		const rehearsalResult = {
			ok: true,
			dryRunGreen: true,
			groundingOk: true,
			reasons: [],
		};
		mocks.firstFlightRehearse.mockResolvedValue(rehearsalResult);
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await act(async () => {
			await result.current.handleRehearse();
		});
		expect(result.current.rehearsal).toEqual(rehearsalResult);
		expect(result.current.rehearsing).toBe(false);
	});

	it("handleRehearse throws → rehearsal set to error fallback", async () => {
		mocks.firstFlightRehearse.mockRejectedValue(new Error("rehearse failed"));
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await act(async () => {
			await result.current.handleRehearse();
		});
		expect(result.current.rehearsal?.ok).toBe(false);
		expect(result.current.rehearsal?.error).toContain("排演失败");
		expect(result.current.rehearsing).toBe(false);
	});

	it("gestureOk: gesture matches lastLabel(host) → true", async () => {
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		act(() => {
			result.current.setGesture(GESTURE);
		});
		expect(result.current.gestureOk).toBe(true);
	});

	it("gestureOk: wrong gesture → false", async () => {
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		act(() => {
			result.current.setGesture("wrong");
		});
		expect(result.current.gestureOk).toBe(false);
	});

	it("handleRun: gestureOk=false → early return, no dispatch", async () => {
		mocks.firstFlightRun.mockResolvedValue({ ok: true });
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		// gesture is empty → gestureOk=false
		await act(async () => {
			await result.current.handleRun();
		});
		expect(mocks.firstFlightRun).not.toHaveBeenCalled();
		expect(result.current.dispatching).toBe(false);
	});

	it("handleRun: gestureOk=true + success → runResult set, step=5", async () => {
		const runResult = {
			ok: true,
			phase: "dispatched",
			itemStatus: "publish-confirmed",
			reverted: true,
		};
		mocks.firstFlightRun.mockResolvedValue(runResult);
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		act(() => {
			result.current.setGesture(GESTURE);
		});
		await act(async () => {
			await result.current.handleRun();
		});
		expect(result.current.runResult).toEqual(runResult);
		expect(result.current.step).toBe(5);
		expect(result.current.dispatching).toBe(false);
	});

	it("handleRun: throws → runResult set to error fallback, step=5", async () => {
		mocks.firstFlightRun.mockRejectedValue(new Error("run failed"));
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		act(() => {
			result.current.setGesture(GESTURE);
		});
		await act(async () => {
			await result.current.handleRun();
		});
		expect(result.current.runResult?.ok).toBe(false);
		expect(result.current.runResult?.error).toContain("执行失败");
		expect(result.current.step).toBe(5);
		expect(result.current.dispatching).toBe(false);
	});

	it("reRehearse → resets runResult, rehearsal, gesture, step=2", async () => {
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		act(() => {
			result.current.setGesture("something");
			result.current.setStep(5);
		});
		act(() => {
			result.current.reRehearse();
		});
		expect(result.current.step).toBe(2);
		expect(result.current.gesture).toBe("");
		expect(result.current.runResult).toBeNull();
		expect(result.current.rehearsal).toBeNull();
	});

	it("canForwardFrom2: rehearsal.ok=true → true", async () => {
		mocks.firstFlightRehearse.mockResolvedValue({
			ok: true,
			dryRunGreen: true,
			groundingOk: true,
			reasons: [],
		});
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await act(async () => {
			await result.current.handleRehearse();
		});
		expect(result.current.canForwardFrom2).toBe(true);
	});

	it("canForwardFrom2: rehearsal.ok=false → false", async () => {
		mocks.firstFlightRehearse.mockResolvedValue({
			ok: false,
			dryRunGreen: false,
			groundingOk: false,
			reasons: ["grounding failed"],
		});
		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);
		await act(async () => {
			await result.current.handleRehearse();
		});
		expect(result.current.canForwardFrom2).toBe(false);
	});

	it("setInterval tick: s.bad=true AND step <= 2 → resetNotice set, step stays", async () => {
		vi.useFakeTimers();
		// firstFlightStatus returns bad=true on first poll
		mocks.firstFlightStatus.mockResolvedValue({ bad: true });

		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);

		// Advance timer 1500ms to trigger tick
		await act(async () => {
			vi.advanceTimersByTime(1501);
			await Promise.resolve();
			await Promise.resolve();
		});

		// resetNotice should be set (s.bad=true branch)
		// step <= 2 → cur > 2 is false → step unchanged
		expect(result.current.step).toBe(1);

		vi.useRealTimers();
	});

	it("setInterval tick: s.bad=true AND step > 2 → step resets to 1", async () => {
		vi.useFakeTimers();
		mocks.firstFlightStatus.mockResolvedValue({ bad: true });

		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);

		// Set step to 3 first
		act(() => {
			result.current.setStep(3);
		});

		// Advance timer 1500ms to trigger tick
		await act(async () => {
			vi.advanceTimersByTime(1501);
			await Promise.resolve();
			await Promise.resolve();
		});

		// step > 2 → resets to 1
		expect(result.current.step).toBe(1);

		vi.useRealTimers();
	});

	it("setInterval tick: s.bad=false → no resetNotice", async () => {
		vi.useFakeTimers();
		mocks.firstFlightStatus.mockResolvedValue({ bad: false });

		const { result } = renderHook(() =>
			useFirstFlightWizard(TAB_ID, ITEM_ID, HOST),
		);

		await act(async () => {
			vi.advanceTimersByTime(1501);
			await Promise.resolve();
			await Promise.resolve();
		});

		// step stays at 1, no resetNotice
		expect(result.current.step).toBe(1);

		vi.useRealTimers();
	});
});
