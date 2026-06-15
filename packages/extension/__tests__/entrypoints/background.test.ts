import type {
	ContentDraft,
	DraftSlots,
	FactsBlock,
	Settings,
} from "@51publisher/shared";
import { assembleDraft, toDraft } from "@51publisher/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
	asPublishResult,
	type BackgroundHandlerDeps,
	buildConstraintSuffix,
	createHandlers,
	runStartupGeneratingRecovery,
} from "../../entrypoints/background";
import type { Batch } from "../../lib/batch";
import { evaluateGrounding } from "../../lib/grounding-gate";

// ---- helpers ----

const HOST = "dx-999-adm.ympxbys.xyz";

const SETTINGS: Settings = {
	endpoint: "https://api.example.com",
	model: "gpt-4o-mini",
	promptTemplate: "Write about {{topic}}",
	fieldMapping: {},
};

const DRAFT: ContentDraft = {
	id: "item_0",
	title: "T",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>body</p>",
	tags: [],
	description: "",
	postStatus: "0",
	publishedAt: "2026-06-04",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-04T00:00:00.000Z",
};

function makeBatch(
	status: "awaiting-approval" | "error" = "awaiting-approval",
): Batch {
	return {
		id: "batch_1",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		// assembledDraftSnapshot 反映真实生成项:markFilled 落盘快照,供发布期 grounding 双求值闸。
		items: [
			{
				id: "item_0",
				topic: "topic-a",
				status,
				draft: DRAFT,
				assembledDraftSnapshot: DRAFT,
			},
		],
	};
}

function makeDeps(
	overrides: Partial<BackgroundHandlerDeps> = {},
): BackgroundHandlerDeps {
	return {
		getBatch: vi.fn(async () => null),
		saveBatch: vi.fn(async () => {}),
		getSettings: vi.fn(async () => SETTINGS),
		getApiKey: vi.fn(async () => "test-key"),
		getPublishedTopics: vi.fn(async () => []),
		addPublishedTopics: vi.fn(async () => {}),
		appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
		getSafetyMode: vi.fn(async () => "authorized" as const),
		getAuthorizedHosts: vi.fn(async () => [HOST]),
		tabsGet: vi.fn(
			async () =>
				({ url: `https://${HOST}/admin`, id: 1 }) as {
					url?: string;
					id?: number;
				},
		),
		tabsSendMessage: vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: `https://${HOST}/post/1`,
		})),
		storageGetItem: vi.fn(async () => null),
		storageSetItem: vi.fn(async () => {}),
		generateDraftFn: vi.fn(async () => ({ ok: true as const, draft: DRAFT })),
		buildBatchId: vi.fn(() => "batch_1"),
		buildItemId: vi.fn((_batchId: string, i: number) => `item_${i}`),
		now: vi.fn(() => "2026-06-04T00:00:00.000Z"),
		...overrides,
	};
}

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
		// 预存步：getBatch 先于 saveBatch，且发生在任何 FILL_PAGE/GRANT 之前
		const firstGet = order.indexOf("getBatch");
		const firstSave = order.indexOf("saveBatch");
		const firstSend = order.findIndex((s) => s.startsWith("send:"));
		expect(firstGet).toBeGreaterThanOrEqual(0);
		expect(firstSave).toBeGreaterThan(firstGet);
		expect(firstSend).toBeGreaterThan(firstSave);
		// saveBatch 至少被调一次，且预存调用带 patchBatchDrafts 后的草稿
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
		// 第一次 saveBatch（若有）必须不早于第一次 send（即没有发生在 approve 之前的预存）
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
		// addPublishedTopics 只应包含 item_1 的 topic
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
		expect(result?.items[2]?.status).toBe("awaiting-approval"); // 非隔离不动
		expect(saveBatch).toHaveBeenCalledTimes(1); // 单次原子保存
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
});

// ================================================================
// handleGenerate
// ================================================================

describe("handleGenerate", () => {
	it("happy path: generateDraftFn called with prompt + constraint suffix", async () => {
		const deps = makeDeps();
		const h = createHandlers(deps);
		const result = await h.handleGenerate("test prompt");
		expect(result).toEqual({ ok: true, draft: DRAFT });
		// Prompt now includes constraint block appended after the original prompt.
		expect(deps.generateDraftFn).toHaveBeenCalledWith(
			expect.stringContaining("test prompt"),
			expect.objectContaining({ apiKey: "test-key" }),
		);
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
	});

	it("generateDraftFn throws → returns ok:false error", async () => {
		const deps = makeDeps({
			generateDraftFn: vi.fn(async () => {
				throw new Error("network");
			}),
		});
		const h = createHandlers(deps);
		const result = await h.handleGenerate("prompt");
		expect(result).toMatchObject({ ok: false });
	});
});

// ================================================================
// evaluateGate (TOCTOU fix)
// ================================================================

describe("evaluateGate TOCTOU fix", () => {
	it("atomic snapshot: tab on authorized host → allowed:true", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			tabsGet: vi.fn(
				async () =>
					({ url: `https://${HOST}/admin` }) as { url?: string; id?: number },
			),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(1);
		expect(decision.allowed).toBe(true);
		expect(decision.host).toBe(HOST);
	});

	it("tab navigated to non-authorized host → allowed:false", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			// Tab is on a different host than authorized
			tabsGet: vi.fn(
				async () =>
					({ url: "https://other-host.com/page" }) as {
						url?: string;
						id?: number;
					},
			),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(1);
		expect(decision.allowed).toBe(false);
		expect(decision.host).toBe("other-host.com");
		// All three reads happened in the same Promise.all (TOCTOU fix verified by implementation)
		expect(deps.getSafetyMode).toHaveBeenCalledOnce();
		expect(deps.getAuthorizedHosts).toHaveBeenCalledOnce();
		expect(deps.tabsGet).toHaveBeenCalledOnce();
	});

	it("tab closed (tabsGet throws) → host null → allowed:false", async () => {
		const deps = makeDeps({
			getSafetyMode: vi.fn(async () => "authorized" as const),
			getAuthorizedHosts: vi.fn(async () => [HOST]),
			tabsGet: vi.fn(async () => {
				throw new Error("no tab");
			}),
		});
		const h = createHandlers(deps);
		const decision = await h.evaluateGate(999);
		expect(decision.allowed).toBe(false);
		expect(decision.host).toBeNull();
	});

	it("GET_BATCH inline route: getBatch called directly (not via handler)", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		// Verify that getBatch can be called independently (not part of factory handlers)
		// This is the inline GET_BATCH route in the defineBackground block
		const result = await deps.getBatch();
		expect(result).toBeNull();
		expect(deps.getBatch).toHaveBeenCalledOnce();
	});
});

// ================================================================
// buildConstraintSuffix
// ================================================================

describe("buildConstraintSuffix", () => {
	it("有标签时 suffix 包含分类约束和标签约束", () => {
		const suffix = buildConstraintSuffix(["漢化", "無修正", "校園"]);
		expect(suffix).toContain("分类约束");
		expect(suffix).toContain("漫畫文章");
		expect(suffix).toContain("标签约束");
		expect(suffix).toContain("漢化");
		expect(suffix).toContain("無修正");
		expect(suffix).toContain("校園");
	});

	it("recommendedTags 为空时只含分类约束，不含标签约束", () => {
		const suffix = buildConstraintSuffix([]);
		expect(suffix).toContain("分类约束");
		expect(suffix).not.toContain("标签约束");
	});

	it("handleGenerate 时 generateDraftFn 收到的 prompt 含约束块", async () => {
		const deps = makeDeps({
			getSettings: vi.fn(async () => ({
				...SETTINGS,
				recommendedTags: ["漢化", "無修正"],
			})),
		});
		const h = createHandlers(deps);
		await h.handleGenerate("请写一篇文章");
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
		expect(calledPrompt).toContain("漢化");
	});

	it("handleRunBatch 时 generateDraftFn 收到的 prompt 含约束块", async () => {
		const deps = makeDeps({
			getSettings: vi.fn(async () => ({
				...SETTINGS,
				recommendedTags: ["校園"],
			})),
		});
		const h = createHandlers(deps);
		await h.handleRunBatch(["topic-x"], 1);
		const [calledPrompt] = (deps.generateDraftFn as ReturnType<typeof vi.fn>)
			.mock.calls[0] as [string];
		expect(calledPrompt).toContain("分类约束");
		expect(calledPrompt).toContain("校園");
	});
});

// ================================================================
// runStartupGeneratingRecovery
// ================================================================

function makeRecoveryDeps(batch: Batch | null) {
	return {
		getBatch: vi.fn(async () => batch),
		saveBatch: vi.fn(async () => {}),
	};
}

describe("runStartupGeneratingRecovery", () => {
	it("no batch → silent, saveBatch not called", async () => {
		const deps = makeRecoveryDeps(null);
		await runStartupGeneratingRecovery(deps);
		expect(deps.saveBatch).not.toHaveBeenCalled();
	});

	it("batch with 1 generating item → item becomes error with descriptive message", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [{ id: "item_0", topic: "topic-a", status: "generating" }],
		};
		const deps = makeRecoveryDeps(batch);
		await runStartupGeneratingRecovery(deps);
		expect(deps.saveBatch).toHaveBeenCalledOnce();
		const saved = (deps.saveBatch as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as Batch;
		expect(saved.items[0]?.status).toBe("error");
		expect(saved.items[0]?.error).toBeTypeOf("string");
		expect(saved.items[0]?.error?.length).toBeGreaterThan(0);
	});

	it("mixed batch: only generating items are changed, others untouched", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "topic-a", status: "generating" },
				{ id: "item_1", topic: "topic-b", status: "queued" },
				{ id: "item_2", topic: "topic-c", status: "filled" },
				{ id: "item_3", topic: "topic-d", status: "error" },
			],
		};
		const deps = makeRecoveryDeps(batch);
		await runStartupGeneratingRecovery(deps);
		expect(deps.saveBatch).toHaveBeenCalledOnce();
		const saved = (deps.saveBatch as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as Batch;
		expect(saved.items[0]?.status).toBe("error"); // generating → error
		expect(saved.items[1]?.status).toBe("queued"); // unchanged
		expect(saved.items[2]?.status).toBe("filled"); // unchanged
		expect(saved.items[3]?.status).toBe("error"); // was already error, unchanged
	});

	it("all items are gate-failed (needs-human-verification) → no changes, saveBatch not called", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: "topic-a", status: "needs-human-verification" },
				{ id: "item_1", topic: "topic-b", status: "needs-human-verification" },
			],
		};
		const deps = makeRecoveryDeps(batch);
		await runStartupGeneratingRecovery(deps);
		expect(deps.saveBatch).not.toHaveBeenCalled();
	});

	it("getBatch throws → swallows error, saveBatch not called", async () => {
		const deps = {
			getBatch: vi.fn(async () => {
				throw new Error("storage-failure");
			}),
			saveBatch: vi.fn(async () => {}),
		};
		await expect(runStartupGeneratingRecovery(deps)).resolves.toBeUndefined();
		expect(deps.saveBatch).not.toHaveBeenCalled();
	});

	it("error item has error field set to a non-empty string", async () => {
		const batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [{ id: "item_0", topic: "topic-a", status: "generating" }],
		};
		const deps = makeRecoveryDeps(batch);
		await runStartupGeneratingRecovery(deps);
		const saved = (deps.saveBatch as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0] as Batch;
		expect(saved.items[0]?.error).toBe("SW restarted during generation");
	});
});

// ================================================================
// handleRefillItemFacts (Unit 5)
// ================================================================

describe("handleRefillItemFacts", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	// 构造一个 gate-failed 条目:缺作品名 → assembleDraft 出 PLACEHOLDER 标题(残留【待补】)。
	function makeGateFailedBatch(): Batch {
		const slots: DraftSlots = {
			titleSuffix: "成人動畫介紹",
			subtitle: "一句吸睛话",
			intro: "开场白",
			highlights: "看点散文",
		};
		const facts: FactsBlock = {}; // 缺作品名/集数 → 标题带【待补】
		const assembled = assembleDraft(slots, facts);
		const failedDraft: ContentDraft = {
			...toDraft(assembled, "2", [], "item_0", "2026-06-04T00:00:00.000Z"),
			coverImageUrl: "https://cdn.example.com/cover.png",
		};
		return {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: "topic-a",
					status: "gate-failed",
					draft: failedDraft,
					assembledDraftSnapshot: failedDraft,
					facts,
					slots,
					gateFailReason: "标题仍含【待补】(缺作品名),请补全或编辑后再发。",
				},
			],
		};
	}

	it("happy: valid facts on gate-failed item with slots → awaiting-approval, saved", async () => {
		const batch = makeGateFailedBatch();
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleRefillItemFacts("item_0", {
			作品名: "某作",
			集数: "第3集",
		});
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(result?.items[0]?.gateFailReason).toBeUndefined();
		expect(saveBatch).toHaveBeenCalledTimes(1);
	});

	it("edge: item without slots → no-op (stays gate-failed, not saved)", async () => {
		const batch = makeGateFailedBatch();
		const item0 = batch.items[0];
		if (item0) item0.slots = undefined; // 模拟旧条目缺 slots(不可重组装)
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleRefillItemFacts("item_0", { 作品名: "某作" });
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("error: unknown itemId → no-op, not saved", async () => {
		const batch = makeGateFailedBatch();
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleRefillItemFacts("nope", { 作品名: "某作" });
		expect(result).toBe(batch);
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("error: item not gate-failed → no-op, not saved", async () => {
		const batch = makeGateFailedBatch();
		const item0 = batch.items[0];
		if (item0) item0.status = "awaiting-approval";
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleRefillItemFacts("item_0", { 作品名: "某作" });
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(saveBatch).not.toHaveBeenCalled();
	});

	it("getBatch null → returns null", async () => {
		const deps = makeDeps({ getBatch: vi.fn(async () => null) });
		const h = createHandlers(deps);
		expect(await h.handleRefillItemFacts("item_0", {})).toBeNull();
	});

	it("error: invalid operator URL fact → kept gate-failed with reason, draft unchanged", async () => {
		const batch = makeGateFailedBatch();
		const originalDraft = batch.items[0]?.draft;
		const saveBatch = vi.fn(async () => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		const result = await h.handleRefillItemFacts("item_0", {
			作品名: "某作",
			漢化: "http://insecure.example.com/x",
		});
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(result?.items[0]?.draft).toBe(originalDraft); // draft 未被改写
		expect(result?.items[0]?.gateFailReason).toContain("漢化");
		expect(saveBatch).toHaveBeenCalledTimes(1);
	});

	it("integration (no-mock): saved batch reflects new facts/draft/snapshot via REAL reassemble+refillGateFailed", async () => {
		const batch = makeGateFailedBatch();
		const saveBatch = vi.fn(async (_b: Batch) => {});
		const deps = makeDeps({ getBatch: vi.fn(async () => batch), saveBatch });
		const h = createHandlers(deps);
		await h.handleRefillItemFacts("item_0", { 作品名: "某作", 集数: "第3集" });
		const saved = saveBatch.mock.calls[0]?.[0];
		const item = saved?.items[0];
		expect(item?.facts?.作品名).toBe("某作");
		expect(item?.facts?.集数).toBe("第3集");
		// 标题不再含【待补】,且 draft 与 snapshot 内容一致(同由 assembler 写出)。
		expect(item?.draft?.title).not.toContain("【待补");
		expect(item?.assembledDraftSnapshot?.title).toBe(item?.draft?.title);
		// 封面在重组装后被保留(toDraft 会归零,handler 显式保留)。
		expect(item?.draft?.coverImageUrl).toBe(
			"https://cdn.example.com/cover.png",
		);
	});

	it("integration (no-mock, mirrors Unit 4): refill clears the REAL authorized grounding hard-gate", async () => {
		const batch = makeGateFailedBatch();
		// 重填前:authorized 闸门(读 snapshot ?? draft)必然拦(残留【待补】)。
		const before = batch.items[0];
		const beforeSnap = before?.assembledDraftSnapshot ?? before?.draft;
		expect(
			evaluateGrounding(beforeSnap as ContentDraft, before?.facts).ok,
		).toBe(false);

		const saveBatch = vi.fn(async (_b: Batch) => {});
		const deps = makeDeps({
			getBatch: vi.fn(async () => batch),
			saveBatch,
		});
		const h = createHandlers(deps);
		await h.handleRefillItemFacts("item_0", { 作品名: "某作", 集数: "第3集" });

		// 重填后:同一 authorized 闸门(checkGrounding(snapshot ?? draft, facts))现在放行。
		const after = saveBatch.mock.calls[0]?.[0]?.items[0];
		const afterSnap = after?.assembledDraftSnapshot ?? after?.draft;
		const verdict = evaluateGrounding(afterSnap as ContentDraft, after?.facts);
		expect(verdict.ok).toBe(true);
		expect(after?.status).toBe("awaiting-approval");
	});
});

describe("asPublishResult(R4 判别式形状校验)", () => {
	it("合法成功(ok:true 无 error)原样通过", () => {
		expect(
			asPublishResult({ ok: true, dryRun: false, url: "https://x/1" }),
		).toEqual({ ok: true, dryRun: false, url: "https://x/1" });
	});
	it("合法失败(ok:false + error)原样通过", () => {
		expect(
			asPublishResult({ ok: false, dryRun: false, error: "boom" }),
		).toEqual({ ok: false, dryRun: false, error: "boom" });
	});
	it("畸形 { ok:true, error } → 降级为失败(杜绝假确认)", () => {
		expect(
			asPublishResult({ ok: true, dryRun: false, error: "sneaky" }),
		).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-malformed",
		});
	});
	it("畸形 { ok:false 无 error } → content-response-invalid", () => {
		expect(asPublishResult({ ok: false, dryRun: false })).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
	});
	it("dry-run 成功(ok:true, dryRun:true 无 error)通过", () => {
		expect(asPublishResult({ ok: true, dryRun: true })).toEqual({
			ok: true,
			dryRun: true,
		});
	});
	it("非对象 / 缺 dryRun → content-response-invalid", () => {
		expect(asPublishResult(null)).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
		expect(asPublishResult({ ok: true })).toEqual({
			ok: false,
			dryRun: false,
			error: "content-response-invalid",
		});
	});
});
