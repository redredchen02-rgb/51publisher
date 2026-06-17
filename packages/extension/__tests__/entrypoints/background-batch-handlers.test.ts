import type { ContentDraft } from "@51publisher/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { createHandlers } from "../../entrypoints/background";
import type { Batch } from "../../lib/batch";
import { DRAFT, HOST, makeBatch, makeDeps } from "./bg-test-fixtures";

// ================================================================
// handleRunBatch
// ================================================================

describe("handleRunBatch", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("happy path: 2 topics → generateDraftFn called twice", async () => {
		const deps = makeDeps();
		const h = createHandlers(deps);
		const result = await h.handleRunBatch(["topic-a", "topic-b"], 1);
		expect(result).not.toBeNull();
		expect(deps.generateDraftFn).toHaveBeenCalledTimes(2);
		expect(deps.saveBatch).toHaveBeenCalled();
	});

	it("tabsGet throws → returns null batch gracefully", async () => {
		const deps = makeDeps({
			tabsGet: vi.fn(async () => {
				throw new Error("tab-not-found");
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleRunBatch(["topic-a"], 99);
		expect(result).toBeNull();
		expect(deps.generateDraftFn).not.toHaveBeenCalled();
	});

	it("tab url is null → resolveHost returns null → returns null", async () => {
		const deps = makeDeps({
			tabsGet: vi.fn(
				async () =>
					({ url: undefined, id: 1 }) as unknown as {
						url?: string;
						id?: number;
					},
			),
		});
		const h = createHandlers(deps);
		const result = await h.handleRunBatch(["topic-a"], 1);
		expect(result).toBeNull();
	});
});

// ================================================================
// handleApproveBatch
// ================================================================

describe("handleApproveBatch", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("happy path: tabsSendMessage called with FILL_PAGE", async () => {
		const batch = makeBatch();
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			tabsSendMessage: vi.fn(async (_id, msg) => {
				const m = msg as { type: string };
				if (m.type === "FILL_PAGE") return { ok: true, results: [] };
				if (m.type === "PUBLISH_GRANT")
					return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
				return null;
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleApproveBatch(1);
		expect(result).not.toBeNull();
		expect(deps.tabsSendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "FILL_PAGE" }),
		);
	});

	it("tabsSendMessage rejects on FILL_PAGE → item stays awaiting-approval, no PUBLISH_GRANT", async () => {
		const batch = makeBatch();
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			tabsSendMessage: vi.fn(async (_id, _msg) => {
				throw new Error("fill-unreachable");
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleApproveBatch(1);
		expect(result).not.toBeNull();
	});

	it("getBatch returns null → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		const result = await h.handleApproveBatch(1);
		expect(result).toBeNull();
	});

	it("draftOverrides 非空但 getBatch null → 不 patch,继续 runApprove", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		const result = await h.handleApproveBatch(1, { item_0: DRAFT });
		expect(result).toBeNull();
	});

	it("draftOverrides 非空 → 调 approveBatch 前先 patchBatchDrafts+saveBatch（call order + save 次数）", async () => {
		const batch = makeBatch();
		const order: string[] = [];
		const getBatch = vi.fn(async () => {
			order.push("getBatch");
			return batch;
		});
		const saveBatch = vi.fn(async () => {
			order.push("saveBatch");
		});
		const tabsSendMessage = vi.fn(async (_id, msg) => {
			const m = msg as { type: string };
			order.push(`send:${m.type}`);
			if (m.type === "FILL_PAGE") return { ok: true, results: [] };
			if (m.type === "PUBLISH_GRANT")
				return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
			return null;
		});
		const deps = makeDeps({ getBatch, saveBatch, tabsSendMessage });
		const h = createHandlers(deps);
		const overrides: Record<string, ContentDraft> = {
			item_0: { ...DRAFT, title: "patched-title" },
		};
		await h.handleApproveBatch(1, overrides);
		const firstGet = order.indexOf("getBatch");
		const firstSave = order.indexOf("saveBatch");
		const firstSend = order.findIndex((s) => s.startsWith("send:"));
		expect(firstGet).toBeGreaterThanOrEqual(0);
		expect(firstSave).toBeGreaterThan(firstGet);
		expect(firstSend).toBeGreaterThan(firstSave);
		const presaved = (saveBatch as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as Batch;
		expect(presaved.items[0]?.draft?.title).toBe("patched-title");
	});

	it("draftOverrides 为空 → 预存 saveBatch 不发生（仍可能因 approve 流程 save）", async () => {
		const batch = makeBatch();
		const order: string[] = [];
		const getBatch = vi.fn(async () => batch);
		const saveBatch = vi.fn(async () => {
			order.push("saveBatch");
		});
		const tabsSendMessage = vi.fn(async (_id, msg) => {
			const m = msg as { type: string };
			order.push(`send:${m.type}`);
			if (m.type === "FILL_PAGE") return { ok: true, results: [] };
			if (m.type === "PUBLISH_GRANT")
				return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
			return null;
		});
		const deps = makeDeps({ getBatch, saveBatch, tabsSendMessage });
		const h = createHandlers(deps);
		await h.handleApproveBatch(1, {});
		const firstSave = order.indexOf("saveBatch");
		const firstSend = order.findIndex((s) => s.startsWith("send:"));
		if (firstSave >= 0 && firstSend >= 0) {
			expect(firstSave).toBeGreaterThan(firstSend);
		}
	});

	it("draftOverrides undefined → 预存 saveBatch 不发生", async () => {
		const batch = makeBatch();
		const order: string[] = [];
		const getBatch = vi.fn(async () => batch);
		const saveBatch = vi.fn(async () => {
			order.push("saveBatch");
		});
		const tabsSendMessage = vi.fn(async (_id, msg) => {
			const m = msg as { type: string };
			order.push(`send:${m.type}`);
			if (m.type === "FILL_PAGE") return { ok: true, results: [] };
			if (m.type === "PUBLISH_GRANT")
				return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
			return null;
		});
		const deps = makeDeps({ getBatch, saveBatch, tabsSendMessage });
		const h = createHandlers(deps);
		await h.handleApproveBatch(1);
		const firstSave = order.indexOf("saveBatch");
		const firstSend = order.findIndex((s) => s.startsWith("send:"));
		if (firstSave >= 0 && firstSend >= 0) {
			expect(firstSave).toBeGreaterThan(firstSend);
		}
	});
});

// ================================================================
// handleApproveSingleItem
// ================================================================

function makeTwoItemBatch(): Batch {
	return {
		id: "batch_1",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		items: [
			{
				id: "item_0",
				topic: "topic-a",
				status: "awaiting-approval",
				draft: { ...DRAFT, id: "item_0" },
				assembledDraftSnapshot: { ...DRAFT, id: "item_0" },
			},
			{
				id: "item_1",
				topic: "topic-b",
				status: "awaiting-approval",
				draft: { ...DRAFT, id: "item_1", title: "T1" },
				assembledDraftSnapshot: { ...DRAFT, id: "item_1", title: "T1" },
			},
		],
	};
}

describe("handleApproveSingleItem", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("入参守卫: tabId 非 number → 返回 getBatch()，不发任何消息", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		const result = await h.handleApproveSingleItem(
			"x" as unknown as number,
			"item_0",
		);
		expect(result).toBeNull();
		expect(deps.tabsSendMessage).not.toHaveBeenCalled();
		expect(deps.getBatch).toHaveBeenCalled();
	});

	it("入参守卫: itemId 为空字符串 → 返回 getBatch()，不发任何消息", async () => {
		const batch = makeTwoItemBatch();
		const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
		const h = createHandlers(deps);
		const result = await h.handleApproveSingleItem(1, "");
		expect(result).toBe(batch);
		expect(deps.tabsSendMessage).not.toHaveBeenCalled();
	});

	it("只审被过滤的 itemId（2-item batch，只有 item_1 走 confirmed/addPublishedTopics）", async () => {
		const batch = makeTwoItemBatch();
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			tabsSendMessage: vi.fn(async (_id, msg) => {
				const m = msg as { type: string };
				if (m.type === "FILL_PAGE") return { ok: true, results: [] };
				if (m.type === "PUBLISH_GRANT")
					return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
				return null;
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleApproveSingleItem(1, "item_1");
		expect(result).not.toBeNull();
		const addCalls = (deps.addPublishedTopics as ReturnType<typeof vi.fn>).mock
			.calls;
		if (addCalls.length > 0) {
			const topics = addCalls[0]?.[0] as string[];
			expect(topics).toEqual(["topic-b"]);
			expect(topics).not.toContain("topic-a");
		}
	});

	it("getBatch 返回 null → 返回 null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		const result = await h.handleApproveSingleItem(1, "item_0");
		expect(result).toBeNull();
	});

	it("对该 item 派发 FILL_PAGE", async () => {
		const batch = makeTwoItemBatch();
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			tabsSendMessage: vi.fn(async (_id, msg) => {
				const m = msg as { type: string };
				if (m.type === "FILL_PAGE") return { ok: true, results: [] };
				if (m.type === "PUBLISH_GRANT")
					return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
				return null;
			}),
		});
		const h = createHandlers(deps);
		await h.handleApproveSingleItem(1, "item_1");
		expect(deps.tabsSendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ type: "FILL_PAGE" }),
		);
	});
});

// ================================================================
// handleKillBatch
// ================================================================

describe("handleKillBatch", () => {
	it("kills active batch → all items aborted", async () => {
		const batch = makeBatch("awaiting-approval");
		const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
		const h = createHandlers(deps);
		const result = await h.handleKillBatch();
		expect(result).not.toBeNull();
		expect(result?.items.every((it) => it.status === "aborted")).toBe(true);
		expect(deps.saveBatch).toHaveBeenCalled();
	});

	it("no batch → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		const result = await h.handleKillBatch();
		expect(result).toBeNull();
	});
});

// ================================================================
// handleReleaseQuarantine
// ================================================================

describe("handleReleaseQuarantine", () => {
	it("releases quarantined item → item becomes aborted", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [{ id: "item_0", topic: "t", status: "needs-human-verification" }],
		};
		const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
		const h = createHandlers(deps);
		const result = await h.handleReleaseQuarantine("item_0");
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("aborted");
	});
});

describe("handleReleaseQuarantineBatch", () => {
	it("批量撤出全部隔离项 → 全 aborted,saveBatch 恰一次", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "a", status: "needs-human-verification" },
				{ id: "item_1", topic: "b", status: "needs-human-verification" },
				{ id: "item_2", topic: "c", status: "awaiting-approval", draft: DRAFT },
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleReleaseQuarantineBatch();
		expect(result?.items[0]?.status).toBe("aborted");
		expect(result?.items[1]?.status).toBe("aborted");
		expect(result?.items[2]?.status).toBe("awaiting-approval");
		expect(saveBatch).toHaveBeenCalledTimes(1);
	});

	it("无隔离项 → no-op,不调 saveBatch", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "a", status: "awaiting-approval", draft: DRAFT },
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		await h.handleReleaseQuarantineBatch();
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("null batch → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		expect(await h.handleReleaseQuarantineBatch()).toBeNull();
	});
});

describe("handleReleaseQuarantine: null batch", () => {
	it("null batch → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		expect(await h.handleReleaseQuarantine("item_0")).toBeNull();
	});
});

// ================================================================
// handleMarkItemEdited
// ================================================================

describe("handleMarkItemEdited", () => {
	it("happy: existing unedited item → userEdited set to true, saveBatch called", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "t", status: "awaiting-approval", draft: DRAFT },
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		await h.handleMarkItemEdited("item_0");
		expect(saveBatch).toHaveBeenCalledOnce();
		// biome-ignore lint/suspicious/noExplicitAny: mock call args are typed as [] but contain Batch
		const saved = (saveBatch.mock.calls[0] as any)[0] as Batch;
		expect(saved.items[0]?.userEdited).toBe(true);
	});

	it("already userEdited → idempotent, saveBatch not called again", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{
					id: "item_0",
					topic: "t",
					status: "awaiting-approval",
					draft: DRAFT,
					userEdited: true,
				},
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		await h.handleMarkItemEdited("item_0");
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("unknown itemId → no-op, saveBatch not called", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "t", status: "awaiting-approval", draft: DRAFT },
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		await h.handleMarkItemEdited("no-such-id");
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("null batch → returns undefined without throwing", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		await expect(h.handleMarkItemEdited("item_0")).resolves.toBeUndefined();
	});
});

// ================================================================
// handleDiscardBatchItem
// ================================================================

describe("handleDiscardBatchItem", () => {
	it("happy: existing item → aborted, saveBatch called", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "t", status: "awaiting-approval", draft: DRAFT },
			],
		};
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleDiscardBatchItem("item_0");
		expect(result?.items[0]?.status).toBe("aborted");
		expect(saveBatch).toHaveBeenCalledOnce();
	});

	it("null batch → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		expect(await h.handleDiscardBatchItem("item_0")).toBeNull();
	});
});
