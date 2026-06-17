import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import type { RegenItemWithFactsDeps, RetryItemDeps } from "./batch-orchestrator";
import { regenItemWithFacts, retryItem } from "./batch-orchestrator";

const TOPIC_A = "topic-a";
const TOPIC_B = "topic-b";
const HOST = "dx-999-adm.ympxbys.xyz";

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

// ================================================================
// retryItem (U7)
// ================================================================

describe("retryItem", () => {
	function makeRetryDeps(
		batch: Batch,
		overrides: Partial<RetryItemDeps> = {},
	): RetryItemDeps {
		return {
			getBatch: vi.fn(async () => batch),
			save: vi.fn(async () => {}),
			generateDraft: vi.fn(async () => ({
				ok: true as const,
				draft: { ...DRAFT },
			})),
			...overrides,
		};
	}

	function errorBatch(topic: string): Batch {
		return {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic, status: "error" as const, error: "prev-error" },
			],
		};
	}

	it("happy path: error item retried → awaiting-approval, generateDraft called once", async () => {
		const batch = errorBatch(TOPIC_A);
		const deps = makeRetryDeps(batch);
		const result = await retryItem(deps, "item_0");
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(deps.generateDraft).toHaveBeenCalledOnce();
		expect(deps.generateDraft).toHaveBeenCalledWith(
			TOPIC_A,
			undefined,
			undefined,
		);
	});

	it("other items in batch not modified", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{ id: "item_0", topic: TOPIC_A, status: "error" as const },
				{ id: "item_1", topic: TOPIC_B, status: "publish-confirmed" as const },
			],
		};
		const deps = makeRetryDeps(batch);
		const result = await retryItem(deps, "item_0");
		expect(result?.items[1]?.status).toBe("publish-confirmed");
	});

	it("generateDraft fails: item marked error again, no throw", async () => {
		const batch = errorBatch(TOPIC_A);
		const deps = makeRetryDeps(batch, {
			generateDraft: vi.fn(async () => ({
				ok: false as const,
				error: "network",
				kind: "network" as const,
			})),
		});
		const result = await retryItem(deps, "item_0");
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("error");
		expect(result?.items[0]?.error).toBe("network");
	});

	it("no batch: returns null", async () => {
		const deps = makeRetryDeps(errorBatch(TOPIC_A), {
			getBatch: vi.fn(async () => null),
		});
		const result = await retryItem(deps, "item_0");
		expect(result).toBeNull();
	});

	it("save called at least twice: once after retryBatchItem, once after presentForApproval", async () => {
		const batch = errorBatch(TOPIC_A);
		const save = vi.fn(async () => {});
		const deps = makeRetryDeps(batch, { save });
		await retryItem(deps, "item_0");
		expect(save).toHaveBeenCalledTimes(3);
	});

	it("封面回注 happy path: item 持久化封面 → retry 后 draft.coverImageUrl = 创建时注入值", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "error" as const,
					error: "prev-error",
					coverImageUrl: "http://a.jpg",
				},
			],
		};
		const deps = makeRetryDeps(batch);
		const result = await retryItem(deps, "item_0");
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(result?.items[0]?.draft?.coverImageUrl).toBe("http://a.jpg");
	});

	it("无封面 topic retry: 不报错,draft.coverImageUrl 保持 ''", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "error" as const,
					error: "prev-error",
					coverImageUrl: "",
				},
			],
		};
		const deps = makeRetryDeps(batch);
		const result = await retryItem(deps, "item_0");
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(result?.items[0]?.draft?.coverImageUrl).toBe("");
	});

	it("回归: 旧批次条目(无 coverImageUrl 字段)retry 优雅降级,draft.coverImageUrl 保持 ''", async () => {
		const batch = errorBatch(TOPIC_A);
		const deps = makeRetryDeps(batch);
		const result = await retryItem(deps, "item_0");
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(result?.items[0]?.draft?.coverImageUrl).toBe("");
	});

	it("回归: 封面回注不影响 facts 透传 generateDraft", async () => {
		const facts = { 作品名: "A作" };
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "error" as const,
					facts,
					coverImageUrl: "http://a.jpg",
				},
			],
		};
		const deps = makeRetryDeps(batch);
		await retryItem(deps, "item_0");
		expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, facts, undefined);
	});
});

// ================================================================
// regenItemWithFacts
// ================================================================

function makeRegenBatch(status: string): Batch {
	return {
		id: "batch_regen",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		items: [
			{
				id: "item_0",
				topic: TOPIC_A,
				status: status as "gate-failed",
				draft: { ...DRAFT, id: "item_0" },
				facts: { 作品名: "旧名" },
			},
		],
	};
}

function makeRegenDeps(
	overrides: Partial<RegenItemWithFactsDeps> = {},
): RegenItemWithFactsDeps {
	return {
		getBatch: vi.fn(async () => makeRegenBatch("gate-failed")),
		save: vi.fn(async () => {}),
		generateDraft: vi.fn(async () => ({
			ok: true as const,
			draft: { ...DRAFT, title: "新标题" },
		})),
		...overrides,
	};
}

describe("regenItemWithFacts", () => {
	it("batch 为 null → 返回 null", async () => {
		const deps = makeRegenDeps({
			getBatch: vi.fn(async () => null),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result).toBeNull();
		expect(deps.save).not.toHaveBeenCalled();
	});

	it("itemId 不存在 → 返回原 batch 不调用 save", async () => {
		const deps = makeRegenDeps();
		const result = await regenItemWithFacts(deps, "no-such-id", {
			作品名: "新名",
		});
		expect(result!.items[0]!.status).toBe("gate-failed");
		expect(deps.generateDraft).not.toHaveBeenCalled();
	});

	it("disallowed 状态(queued) → 原样返回,不调 generateDraft", async () => {
		const deps = makeRegenDeps({
			getBatch: vi.fn(async () => makeRegenBatch("queued")),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("queued");
		expect(deps.generateDraft).not.toHaveBeenCalled();
	});

	it("generateDraft 失败 → facts 不写入(原子性不变式)", async () => {
		const deps = makeRegenDeps({
			generateDraft: vi.fn(async () => ({
				ok: false as const,
				error: "LLM timeout",
			})),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("error");
		expect(result!.items[0]!.facts).toEqual({ 作品名: "旧名" });
		expect(deps.save).toHaveBeenCalledTimes(2);
	});

	it("generateDraft 成功 → 原子写入 facts+draft+snapshot", async () => {
		const newFacts = { 作品名: "新名", 集数: "6" };
		const deps = makeRegenDeps({
			generateDraft: vi.fn(async () => ({
				ok: true as const,
				draft: { ...DRAFT, title: "新标题" },
			})),
		});
		const result = await regenItemWithFacts(deps, "item_0", newFacts);
		expect(result!.items[0]!.facts).toEqual(newFacts);
		expect(result!.items[0]!.draft?.title).toBe("新标题");
		expect(result!.items[0]!.status).toBe("awaiting-approval");
		expect(result!.items[0]!.assembledDraftSnapshot).toBeDefined();
	});

	it("允许从 awaiting-approval 出发重新生成", async () => {
		const deps = makeRegenDeps({
			getBatch: vi.fn(async () => makeRegenBatch("awaiting-approval")),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("awaiting-approval");
		expect(deps.generateDraft).toHaveBeenCalledOnce();
	});

	it("generateDraft 成功但 grounding 闸失败 → item gate-failed,facts 已写入", async () => {
		const newFacts = { 作品名: "新名" };
		const deps = makeRegenDeps({
			evaluateGrounding: vi.fn(() => ({
				ok: false,
				reasons: ["description 含无来源 URL"],
			})),
		});
		const result = await regenItemWithFacts(deps, "item_0", newFacts);
		expect(result!.items[0]!.status).toBe("gate-failed");
		expect(result!.items[0]!.facts).toEqual(newFacts);
	});

	it("grounding 闸通过 → awaiting-approval", async () => {
		const deps = makeRegenDeps({
			evaluateGrounding: vi.fn(() => ({ ok: true, reasons: [] })),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("awaiting-approval");
		expect(deps.evaluateGrounding).toHaveBeenCalledOnce();
	});

	it("未注入 evaluateGrounding → 不调用闸,直接 awaiting-approval", async () => {
		const deps = makeRegenDeps();
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("awaiting-approval");
	});

	it("允许从 filled 出发重新生成", async () => {
		const deps = makeRegenDeps({
			getBatch: vi.fn(async () => makeRegenBatch("filled")),
		});
		const result = await regenItemWithFacts(deps, "item_0", { 作品名: "新名" });
		expect(result!.items[0]!.status).toBe("awaiting-approval");
		expect(deps.generateDraft).toHaveBeenCalledOnce();
	});
});
