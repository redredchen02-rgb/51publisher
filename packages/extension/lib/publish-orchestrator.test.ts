import type { PublishResult } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { GateDecision, OrchestratorDeps } from "./publish-orchestrator";
import {
	gateReason,
	isGateBlocked,
	orchestratePublish,
} from "./publish-orchestrator";

function makeDeps(
	gate: GateDecision,
	grantResult: PublishResult,
	order: string[],
	alreadyDispatched = false,
): OrchestratorDeps {
	return {
		evaluateGate: vi.fn(async () => gate),
		isAlreadyDispatched: vi.fn(async () => alreadyDispatched),
		writeDispatched: vi.fn(async () => {
			order.push("dispatched");
		}),
		sendGrant: vi.fn(async () => {
			order.push("grant");
			return grantResult;
		}),
		writeConfirmed: vi.fn(async (r: PublishResult) => {
			order.push(`confirmed:${r.ok}`);
		}),
	};
}

const OK: PublishResult = {
	ok: true,
	dryRun: false,
	url: "https://dx-999-adm.ympxbys.xyz/post/1",
};

describe("orchestratePublish", () => {
	it("authorized+allowed:先 await 写 dispatched 再发 grant 再写 confirmed", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res).toEqual(OK);
		expect(order).toEqual(["dispatched", "grant", "confirmed:true"]);
		expect(deps.sendGrant).toHaveBeenCalledOnce();
	});

	it("off:不发 grant、不写 dispatched,返回 blocked", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "off", allowed: false, host: "dx-999-adm.ympxbys.xyz" },
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res.ok).toBe(false);
		expect(res.dryRun).toBe(false);
		expect(order).toEqual([]);
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.writeDispatched).not.toHaveBeenCalled();
	});

	it("dry-run:不发 grant,返回 dryRun 报告", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "dry-run", allowed: false, host: "dx-999-adm.ympxbys.xyz" },
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res.dryRun).toBe(true);
		expect(order).toEqual([]);
		expect(deps.sendGrant).not.toHaveBeenCalled();
	});

	it("authorized 但 host 不符(allowed=false):不发 grant", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "authorized", allowed: false, host: "evil.com" },
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res.ok).toBe(false);
		expect(order).toEqual([]);
		expect(deps.sendGrant).not.toHaveBeenCalled();
	});

	it("重入守卫:已有在途 dispatched → already-publishing,不发 grant、不重写 dispatched", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
			OK,
			order,
			true,
		);
		const res = await orchestratePublish(deps);
		expect(res).toEqual({
			ok: false,
			dryRun: false,
			error: "already-publishing",
		});
		expect(order).toEqual([]);
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.writeDispatched).not.toHaveBeenCalled();
	});

	it("content 触发失败(no-publish-target)如实回传,仍写 confirmed", async () => {
		const order: string[] = [];
		const fail: PublishResult = {
			ok: false,
			dryRun: false,
			error: "no-publish-target",
		};
		const deps = makeDeps(
			{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
			fail,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res).toEqual(fail);
		expect(order).toEqual(["dispatched", "grant", "confirmed:false"]);
	});
});

describe("gateReason", () => {
	it("off → off", () => {
		expect(gateReason("off", "dx-999-adm.ympxbys.xyz", false)).toBe("off");
	});
	it("dry-run → dry-run", () => {
		expect(gateReason("dry-run", "dx-999-adm.ympxbys.xyz", false)).toBe(
			"dry-run",
		);
	});
	it("authorized 但 tab 取不到 host → host-unreachable", () => {
		expect(gateReason("authorized", null, false)).toBe("host-unreachable");
	});
	it("authorized 但 host 不在名单 → not-authorized", () => {
		expect(gateReason("authorized", "evil.com", false)).toBe("not-authorized");
	});
	it("authorized + host 命中 → authorized", () => {
		expect(gateReason("authorized", "dx-999-adm.ympxbys.xyz", true)).toBe(
			"authorized",
		);
	});
});

describe("isGateBlocked", () => {
	it("识别具体阻断 reason 与历史回退值 blocked", () => {
		for (const e of ["off", "not-authorized", "host-unreachable", "blocked"]) {
			expect(isGateBlocked(e)).toBe(true);
		}
	});
	it("非阻断错误 / undefined → false", () => {
		expect(isGateBlocked("already-publishing")).toBe(false);
		expect(isGateBlocked("fill-failed")).toBe(false);
		expect(isGateBlocked(undefined)).toBe(false);
	});
});

describe("orchestratePublish:阻断携带 reason", () => {
	it("具体 reason(host-unreachable)进入 error", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{
				mode: "authorized",
				allowed: false,
				host: null,
				reason: "host-unreachable",
			},
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res).toEqual({
			ok: false,
			dryRun: false,
			error: "host-unreachable",
		});
		expect(order).toEqual([]);
		expect(deps.sendGrant).not.toHaveBeenCalled();
	});
	it("reason 省略 → 回退 blocked(向后兼容)", async () => {
		const order: string[] = [];
		const deps = makeDeps(
			{ mode: "off", allowed: false, host: "dx-999-adm.ympxbys.xyz" },
			OK,
			order,
		);
		const res = await orchestratePublish(deps);
		expect(res).toEqual({ ok: false, dryRun: false, error: "blocked" });
	});

	describe("preGrantGuard(first-flight 互锁)", () => {
		it("guard allowed=false → writeDispatched 后绝不 sendGrant,返回 first-flight-locked", async () => {
			const order: string[] = [];
			const deps = makeDeps(
				{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
				OK,
				order,
			);
			deps.preGrantGuard = vi.fn(async () => ({ allowed: false }));
			const res = await orchestratePublish(deps);
			expect(res).toEqual({
				ok: false,
				dryRun: false,
				error: "first-flight-locked",
			});
			expect(deps.sendGrant).not.toHaveBeenCalled();
			// dispatched 已写(再交由 U4 恢复收尾),但 grant 从未发。
			expect(order).toEqual(["dispatched", "confirmed:false"]);
		});

		it("guard allowed=true → 正常 grant", async () => {
			const order: string[] = [];
			const deps = makeDeps(
				{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
				OK,
				order,
			);
			deps.preGrantGuard = vi.fn(async () => ({ allowed: true }));
			const res = await orchestratePublish(deps);
			expect(res).toEqual(OK);
			expect(deps.sendGrant).toHaveBeenCalledOnce();
			expect(order).toEqual(["dispatched", "grant", "confirmed:true"]);
		});

		it("无 guard(省略)→ 零行为变更", async () => {
			const order: string[] = [];
			const deps = makeDeps(
				{ mode: "authorized", allowed: true, host: "dx-999-adm.ympxbys.xyz" },
				OK,
				order,
			);
			const res = await orchestratePublish(deps);
			expect(res).toEqual(OK);
			expect(order).toEqual(["dispatched", "grant", "confirmed:true"]);
		});
	});
});
