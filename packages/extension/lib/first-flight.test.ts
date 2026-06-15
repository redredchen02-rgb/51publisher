import { describe, expect, it, vi } from "vitest";
import {
	armFirstFlight,
	type FirstFlightDeps,
	MAX_CONSECUTIVE_RESETS,
	revertFirstFlight,
	runStartupFirstFlightReset,
} from "./first-flight";
import type { FirstFlightPending } from "./storage";

// 内存假实现 deps;可逐项覆盖以模拟坏路径。
function makeDeps(over: Partial<FirstFlightDeps> = {}): FirstFlightDeps & {
	state: {
		mode: "off" | "dry-run" | "authorized";
		pending: FirstFlightPending | null;
		corrupt: boolean;
		resetCount: number;
		activeNonce: string | null;
	};
	alerts: string[];
} {
	const state = {
		mode: "dry-run" as "off" | "dry-run" | "authorized",
		pending: null as FirstFlightPending | null,
		corrupt: false,
		resetCount: 0,
		activeNonce: null as string | null,
	};
	const alerts: string[] = [];
	let nonceSeq = 0;
	const base: FirstFlightDeps = {
		getSafetyMode: async () => state.mode,
		setSafetyMode: async (m) => {
			state.mode = m;
		},
		getPending: async () => ({
			pending: state.pending,
			corrupt: state.corrupt,
		}),
		setPending: async (p) => {
			state.pending = p;
		},
		clearPending: async () => {
			state.pending = null;
			state.corrupt = false;
		},
		getResetCount: async () => state.resetCount,
		setResetCount: async (n) => {
			state.resetCount = n;
		},
		getActiveNonce: () => state.activeNonce,
		setActiveNonce: (n) => {
			state.activeNonce = n;
		},
		now: () => "2026-06-15T00:00:00.000Z",
		newNonce: () => `nonce-${++nonceSeq}`,
		onAlert: (m) => alerts.push(m),
	};
	return { ...base, ...over, state, alerts };
}

const PARAMS = {
	itemId: "i1",
	tabId: 7,
	host: "dx-999-adm.ympxbys.xyz",
	contentHash: "hash-abc",
};

describe("armFirstFlight", () => {
	it("Happy:空态 → 写 pending、设内存 nonce、翻 authorized(顺序:authorized 在 pending 之后)", async () => {
		const deps = makeDeps();
		const r = await armFirstFlight(deps, PARAMS);
		expect(r.ok).toBe(true);
		expect(deps.state.pending?.itemId).toBe("i1");
		expect(deps.state.pending?.contentHash).toBe("hash-abc");
		expect(deps.state.activeNonce).toBe(deps.state.pending?.nonce);
		expect(deps.state.mode).toBe("authorized");
		// 超集不变量:authorized 时 pending 必在场
		expect(deps.state.pending).not.toBeNull();
	});

	it("拒绝二次 arm(已有 pending,不 stack)", async () => {
		const deps = makeDeps();
		await armFirstFlight(deps, PARAMS);
		const r2 = await armFirstFlight(deps, { ...PARAMS, itemId: "i2" });
		expect(r2.ok).toBe(false);
		expect(deps.state.pending?.itemId).toBe("i1"); // 未被覆盖
	});

	it("拒绝 arm(坏标记在场)", async () => {
		const deps = makeDeps();
		deps.state.corrupt = true;
		const r = await armFirstFlight(deps, PARAMS);
		expect(r.ok).toBe(false);
		expect(deps.state.mode).not.toBe("authorized");
	});

	it("读回确认失败(写未持久)→ 拒绝 arm + 清理,绝不翻 authorized", async () => {
		// setPending 为 no-op,模拟写失败 → 读回 null
		const deps = makeDeps({ setPending: vi.fn(async () => {}) });
		const r = await armFirstFlight(deps, PARAMS);
		expect(r.ok).toBe(false);
		expect(deps.state.mode).toBe("dry-run"); // 绝不 authorized
		expect(deps.state.pending).toBeNull();
	});
});

describe("revertFirstFlight(非对称,干净 settle)", () => {
	it("降 dry-run → 清 pending → 清内存 nonce → 复位计数归 0", async () => {
		const deps = makeDeps();
		await armFirstFlight(deps, PARAMS);
		deps.state.resetCount = 1;
		await revertFirstFlight(deps);
		expect(deps.state.mode).toBe("dry-run");
		expect(deps.state.pending).toBeNull();
		expect(deps.state.activeNonce).toBeNull();
		expect(deps.state.resetCount).toBe(0);
	});
});

describe("runStartupFirstFlightReset", () => {
	it("Happy:无 pending + dry-run → 不复位", async () => {
		const deps = makeDeps();
		const out = await runStartupFirstFlightReset(deps);
		expect(out.reset).toBe(false);
		expect(deps.state.mode).toBe("dry-run");
		expect(deps.alerts).toHaveLength(0);
	});

	it("安全核心:pending 残留(SW 重启 nonce 丢)→ 强制 dry-run + 清 + 告警 + 计数+1", async () => {
		const deps = makeDeps();
		deps.state.pending = { ...PARAMS, nonce: "stale", ts: "t" };
		deps.state.mode = "authorized"; // 残留授权窗口
		const out = await runStartupFirstFlightReset(deps);
		expect(out.reset).toBe(true);
		expect(out.fellBackToOff).toBe(false);
		expect(deps.state.mode).toBe("dry-run");
		expect(deps.state.pending).toBeNull();
		expect(deps.state.resetCount).toBe(1);
		expect(deps.alerts).toHaveLength(1);
	});

	it("坏标记(corrupt)→ 强制复位", async () => {
		const deps = makeDeps();
		deps.state.corrupt = true;
		const out = await runStartupFirstFlightReset(deps);
		expect(out.reset).toBe(true);
		expect(deps.state.mode).toBe("dry-run");
	});

	it("可疑:mode=authorized 但无 pending → 仍复位", async () => {
		const deps = makeDeps();
		deps.state.mode = "authorized";
		const out = await runStartupFirstFlightReset(deps);
		expect(out.reset).toBe(true);
		expect(deps.state.mode).toBe("dry-run");
	});

	it("连续复位达阈值 → 回落 off + 需显式重启用", async () => {
		const deps = makeDeps();
		deps.state.resetCount = MAX_CONSECUTIVE_RESETS - 1;
		deps.state.pending = { ...PARAMS, nonce: "stale", ts: "t" };
		const out = await runStartupFirstFlightReset(deps);
		expect(out.fellBackToOff).toBe(true);
		expect(deps.state.mode).toBe("off");
		expect(deps.alerts[0]).toContain("off");
	});
});
