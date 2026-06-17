import type {
	ContentDraft,
	DraftSlots,
	FactsBlock,
} from "@51publisher/shared";
import { assembleDraft, toDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createHandlers,
	runStartupGeneratingRecovery,
} from "../../entrypoints/background";
import type { Batch } from "../../lib/batch";
import { evaluateGrounding } from "../../lib/grounding-gate";
import {
	DRAFT,
	HOST,
	makeDeps,
} from "./bg-test-fixtures";

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
		expect(saved.items[0]?.status).toBe("error");
		expect(saved.items[1]?.status).toBe("queued");
		expect(saved.items[2]?.status).toBe("filled");
		expect(saved.items[3]?.status).toBe("error");
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

function makeGateFailedBatch(): Batch {
	const slots: DraftSlots = {
		titleSuffix: "成人動畫介紹",
		subtitle: "一句吸睛话",
		intro: "开场白",
		highlights: "看点散文",
	};
	const facts: FactsBlock = {};
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

describe("handleRefillItemFacts", () => {
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
		if (item0) item0.slots = undefined;
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
		expect(result?.items[0]?.draft).toBe(originalDraft);
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
		expect(item?.draft?.title).not.toContain("【待补");
		expect(item?.assembledDraftSnapshot?.title).toBe(item?.draft?.title);
		expect(item?.draft?.coverImageUrl).toBe(
			"https://cdn.example.com/cover.png",
		);
	});

	it("integration (no-mock, mirrors Unit 4): refill clears the REAL authorized grounding hard-gate", async () => {
		const batch = makeGateFailedBatch();
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

		const after = saveBatch.mock.calls[0]?.[0]?.items[0];
		const afterSnap = after?.assembledDraftSnapshot ?? after?.draft;
		const verdict = evaluateGrounding(afterSnap as ContentDraft, after?.facts);
		expect(verdict.ok).toBe(true);
		expect(after?.status).toBe("awaiting-approval");
	});
});
