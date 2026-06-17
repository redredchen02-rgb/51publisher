import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { createHandlers } from "../../entrypoints/background";
import type { Batch } from "../../lib/batch";
import { hashDraft } from "../../lib/first-flight";
import type { FirstFlightMarker } from "../../lib/storage";
import {
	DRAFT,
	HOST,
	makeBatch,
	makeDeps,
	makeFFStore,
	makeModeStore,
} from "./bg-test-fixtures";

// ================================================================
// First-flight: arm / startup reset / watchdog / interlock (Unit 4/5)
// ================================================================

describe("first-flight arm 串行武装", () => {
	beforeEach(() => fakeBrowser.reset());

	it("happy:写标记 + 读回确认 → 翻 authorized", async () => {
		const ff = makeFFStore();
		const setSafetyMode = vi.fn(async () => {});
		const armWatchdog = vi.fn();
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "dry-run" as const),
			setSafetyMode,
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
			armWatchdog,
		});
		const h = createHandlers(deps);
		const res = await h.handleArmFirstFlight({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(res.ok).toBe(true);
		expect(setSafetyMode).toHaveBeenCalledWith("authorized");
		expect(armWatchdog).toHaveBeenCalledOnce();
		const cur = ff.peek();
		expect(cur.state).toBe("ok");
		if (cur.state === "ok") {
			expect(cur.marker.mode).toBe("dry-run");
			expect(cur.marker.pending?.contentHash).toBe(await hashDraft(DRAFT));
		}
	});

	it("write 读回失败 → REJECT arm,绝不翻 authorized,清半写状态", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const clearFirstFlight = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
			writeFirstFlight: vi.fn(async () => false),
			clearFirstFlight,
			setSafetyMode,
		});
		const h = createHandlers(deps);
		const res = await h.handleArmFirstFlight({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(res.ok).toBe(false);
		expect(setSafetyMode).not.toHaveBeenCalledWith("authorized");
		expect(clearFirstFlight).toHaveBeenCalled();
	});

	it("并发双 arm:第二次因标记已在场被拒(串行队列)", async () => {
		const ff = makeFFStore();
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "dry-run" as const),
			setSafetyMode: vi.fn(async () => {}),
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
		});
		const h = createHandlers(deps);
		const [r1, r2] = await Promise.all([
			h.handleArmFirstFlight({
				itemId: "item_0",
				tabId: 1,
				host: HOST,
				draft: DRAFT,
			}),
			h.handleArmFirstFlight({
				itemId: "item_0",
				tabId: 1,
				host: HOST,
				draft: DRAFT,
			}),
		]);
		const oks = [r1.ok, r2.ok].filter(Boolean);
		expect(oks).toHaveLength(1);
	});
});

describe("first-flight 启动 reset", () => {
	beforeEach(() => fakeBrowser.reset());

	it("happy:无标记 → 不动 mode,无 alert", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const emit = vi.fn();
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
			setSafetyMode,
			emitSecurityAlert: emit,
		});
		const h = createHandlers(deps);
		await h.ensureStartupReset();
		expect(setSafetyMode).not.toHaveBeenCalled();
		expect(emit).not.toHaveBeenCalled();
	});

	it("pending 残留 + authorized → 强制 dry-run + 清标记 + 安全事件", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const clearFirstFlight = vi.fn(async () => {});
		const emit = vi.fn();
		const marker: FirstFlightMarker = {
			mode: "dry-run",
			pending: {
				itemId: "item_0",
				tabId: 1,
				host: HOST,
				contentHash: "h",
				nonce: "n",
				ts: "t",
			},
		};
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "ok" as const, marker })),
			setSafetyMode,
			clearFirstFlight,
			emitSecurityAlert: emit,
		});
		const h = createHandlers(deps);
		await h.ensureStartupReset();
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
		expect(clearFirstFlight).toHaveBeenCalled();
		expect(emit).toHaveBeenCalledWith(
			"first-flight-forced-reset",
			expect.anything(),
		);
	});

	it("坏值标记 → 强制 reset", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "bad" as const })),
			setSafetyMode,
		});
		const h = createHandlers(deps);
		await h.ensureStartupReset();
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
	});

	it("N 连续 reset → 回落 off + 要求重新启用", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const emit = vi.fn();
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "bad" as const })),
			setSafetyMode,
			emitSecurityAlert: emit,
		});
		const h = createHandlers(deps);
		await h.ensureStartupReset();
		await h.handleWatchdog();
		expect(setSafetyMode).toHaveBeenLastCalledWith("off");
		expect(emit).toHaveBeenCalledWith(
			"first-flight-wedge-fallback-off",
			expect.anything(),
		);
	});

	it("publish-class handler 发 grant 前 await 启动 reset", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const order: string[] = [];
		const marker: FirstFlightMarker = { mode: "dry-run", pending: null };
		const deps = makeDeps({
			getBatch: vi.fn(async () => null),
			getFirstFlight: vi.fn(async () => ({ state: "ok" as const, marker })),
			setSafetyMode: vi.fn(async (m) => {
				order.push(`setMode:${m}`);
			}),
			clearFirstFlight: vi.fn(async () => {
				order.push("clear");
			}),
		});
		const h = createHandlers(deps);
		await h.handleApproveBatch(1);
		expect(order).toContain("setMode:dry-run");
	});
});

describe("first-flight 看门狗", () => {
	beforeEach(() => fakeBrowser.reset());

	it("标记在场 → fire → 强制 dry-run + 清标记 + 安全事件", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const clearFirstFlight = vi.fn(async () => {});
		const emit = vi.fn();
		const marker: FirstFlightMarker = {
			mode: "dry-run",
			pending: {
				itemId: "item_0",
				tabId: 1,
				host: HOST,
				contentHash: "h",
				nonce: "n",
				ts: "t",
			},
		};
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "ok" as const, marker })),
			setSafetyMode,
			clearFirstFlight,
			emitSecurityAlert: emit,
		});
		const h = createHandlers(deps);
		await h.handleWatchdog();
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
		expect(clearFirstFlight).toHaveBeenCalled();
		expect(emit).toHaveBeenCalledWith("first-flight-watchdog-fired", {});
	});

	it("无标记 → 看门狗 no-op", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
			setSafetyMode,
		});
		const h = createHandlers(deps);
		await h.handleWatchdog();
		expect(setSafetyMode).not.toHaveBeenCalled();
	});
});

describe("first-flight guard 集成(interlock)", () => {
	beforeEach(() => fakeBrowser.reset());

	async function armedMarker(
		over: Partial<{
			host: string;
			tabId: number;
			itemId: string;
			nonce: string;
			hash: string;
		}> = {},
	) {
		const m: FirstFlightMarker = {
			mode: "dry-run",
			pending: {
				itemId: over.itemId ?? "item_0",
				tabId: over.tabId ?? 1,
				host: over.host ?? HOST,
				contentHash: over.hash ?? (await hashDraft(DRAFT)),
				nonce: over.nonce ?? "live-nonce",
				ts: "t",
			},
		};
		return m;
	}

	it("全等 + nonce 匹配(经 arm 设 nonce)→ allowed", async () => {
		const ff = makeFFStore();
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "dry-run" as const),
			setSafetyMode: vi.fn(async () => {}),
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
		});
		const h = createHandlers(deps);
		await h.handleArmFirstFlight({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(v.allowed).toBe(true);
	});

	it("host 不符(同站之外)→ block + 触发 reset", async () => {
		const marker = await armedMarker();
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "ok" as const, marker })),
			setSafetyMode,
		});
		const h = createHandlers(deps);
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: "evil.ympxbys.xyz",
			draft: DRAFT,
		});
		expect(v.allowed).toBe(false);
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
	});

	it("SW 重启丢 nonce(标记在但内存 nonce null)→ block + reset", async () => {
		const marker = await armedMarker();
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "ok" as const, marker })),
			setSafetyMode,
		});
		const h = createHandlers(deps);
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(v.allowed).toBe(false);
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
	});

	it("draft 字节被篡改(hash 不符)→ block + reset", async () => {
		const ff = makeFFStore();
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "dry-run" as const),
			setSafetyMode,
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
		});
		const h = createHandlers(deps);
		await h.handleArmFirstFlight({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: { ...DRAFT, body: "<p>tampered</p>" },
		});
		expect(v.allowed).toBe(false);
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
	});

	it("坏标记 → guard block first-flight-locked + reset", async () => {
		const setSafetyMode = vi.fn(async () => {});
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "bad" as const })),
			setSafetyMode,
		});
		const h = createHandlers(deps);
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(v.allowed).toBe(false);
		expect(v.reason).toBe("first-flight-locked");
		expect(setSafetyMode).toHaveBeenCalledWith("dry-run");
	});

	it("无标记 → guard 放行(零行为变更)", async () => {
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
		});
		const h = createHandlers(deps);
		const v = await h.firstFlightGuard({
			itemId: "item_0",
			tabId: 1,
			host: HOST,
			draft: DRAFT,
		});
		expect(v.allowed).toBe(true);
	});
});

// ================================================================
// First-flight 向导编排(Unit 6):rehearse / run / status
// ================================================================

describe("first-flight 向导编排(Unit 6)", () => {
	beforeEach(() => fakeBrowser.reset());

	it("rehearse:只读 dry-run + grounding,绝不翻 authorized、绝不武装", async () => {
		const ff = makeFFStore();
		const mode = makeModeStore("dry-run");
		const deps = makeDeps({
			getBatch: vi.fn(async () => makeBatch("awaiting-approval")),
			getSafetyMode: mode.getSafetyMode,
			setSafetyMode: mode.setSafetyMode,
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
		});
		const h = createHandlers(deps);
		const res = await h.handleFirstFlightRehearse(1, "item_0");
		expect(res.ok).toBe(true);
		expect(res.dryRunGreen).toBe(true);
		expect(res.groundingOk).toBe(true);
		expect(mode.peek()).toBe("dry-run");
		expect(ff.peek().state).toBe("absent");
	});

	it("rehearse:grounding 拦(标题含【待补】)→ ok=false,reasons 透出", async () => {
		const badDraft = { ...DRAFT, title: "【待补】成人動畫介紹" };
		const batch = makeBatch("awaiting-approval");
		const it0 = batch.items[0];
		if (!it0) throw new Error("fixture missing item");
		it0.draft = badDraft;
		it0.assembledDraftSnapshot = badDraft;
		const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
		const h = createHandlers(deps);
		const res = await h.handleFirstFlightRehearse(1, "item_0");
		expect(res.ok).toBe(false);
		expect(res.groundingOk).toBe(false);
		expect(res.reasons.join(" ")).toContain("【待补】");
	});

	it("rehearse:host 取不到 → error=host-unreachable", async () => {
		const deps = makeDeps({
			getBatch: vi.fn(async () => makeBatch("awaiting-approval")),
			tabsGet: vi.fn(async () => ({}) as { url?: string; id?: number }),
		});
		const h = createHandlers(deps);
		const res = await h.handleFirstFlightRehearse(1, "item_0");
		expect(res.ok).toBe(false);
		expect(res.error).toBe("host-unreachable");
	});

	it("decoupling 端到端:一次 grant 放行 + revert 到 dry-run + 第二次被挡", async () => {
		const ff = makeFFStore();
		const mode = makeModeStore("dry-run");
		let batch = makeBatch("awaiting-approval");
		const grantCalls: unknown[] = [];
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			saveBatch: vi.fn(async (b: Batch) => {
				batch = b;
			}),
			getSafetyMode: mode.getSafetyMode,
			setSafetyMode: mode.setSafetyMode,
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
			tabsSendMessage: vi.fn(async (_id: number, msg: unknown) => {
				const m = msg as { type: string };
				if (m.type === "PUBLISH_GRANT") {
					grantCalls.push(m);
					return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
				}
				return { ok: true, results: [] };
			}),
			saveDryRunReportFn: vi.fn(async () => {}),
		});
		const h = createHandlers(deps);

		const run1 = await h.handleFirstFlightRun(1, "item_0");
		expect(run1.ok).toBe(true);
		expect(run1.phase).toBe("dispatched");
		expect(grantCalls).toHaveLength(1);
		expect(mode.peek()).toBe("dry-run");
		expect(ff.peek().state).toBe("absent");
		expect(run1.reverted).toBe(true);

		const run2 = await h.handleFirstFlightRun(1, "item_0");
		expect(grantCalls).toHaveLength(1);
		expect(mode.peek()).toBe("dry-run");
		expect(ff.peek().state).toBe("absent");
		expect(run2.reverted).toBe(true);
	});

	it("R8 host 来自 tab:run 用 chrome.tabs.get 的 host,不接受消息携带 host", async () => {
		const ff = makeFFStore();
		const mode = makeModeStore("dry-run");
		const tabsGet = vi.fn(
			async () =>
				({ url: `https://${HOST}/admin`, id: 1 }) as {
					url?: string;
					id?: number;
				},
		);
		let batch = makeBatch("awaiting-approval");
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			saveBatch: vi.fn(async (b: Batch) => {
				batch = b;
			}),
			getSafetyMode: mode.getSafetyMode,
			setSafetyMode: mode.setSafetyMode,
			getFirstFlight: ff.getFirstFlight,
			writeFirstFlight: ff.writeFirstFlight,
			clearFirstFlight: ff.clearFirstFlight,
			tabsGet,
			tabsSendMessage: vi.fn(async (_id: number, msg: unknown) => {
				const m = msg as { type: string };
				if (m.type === "PUBLISH_GRANT")
					return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
				return { ok: true, results: [] };
			}),
			saveDryRunReportFn: vi.fn(async () => {}),
		});
		const h = createHandlers(deps);
		await h.handleFirstFlightRun(1, "item_0");
		expect(tabsGet).toHaveBeenCalled();
		expect(ff.writeFirstFlight).toHaveBeenCalled();
	});

	it("status:无标记 → armed=false;dry-run 档", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "dry-run" as const),
			getFirstFlight: vi.fn(async () => ({ state: "absent" as const })),
		});
		const h = createHandlers(deps);
		const s = await h.handleFirstFlightStatus();
		expect(s.mode).toBe("dry-run");
		expect(s.armed).toBe(false);
		expect(s.bad).toBe(false);
	});

	it("status:坏值标记 → bad=true(fail-closed)", async () => {
		const deps = makeDeps({
			getFirstFlight: vi.fn(async () => ({ state: "bad" as const })),
		});
		const h = createHandlers(deps);
		const s = await h.handleFirstFlightStatus();
		expect(s.bad).toBe(true);
		expect(s.armed).toBe(false);
	});
});
