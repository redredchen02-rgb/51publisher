import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import { markFilled, markGateFailed, presentForApproval } from "./batch";
import type { ApproveBatchDeps } from "./batch-orchestrator";
import { approveBatch } from "./batch-orchestrator";
import { evaluateGrounding } from "./grounding-gate";

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

function makeApproveDeps(
	overrides: Partial<ApproveBatchDeps> = {},
): ApproveBatchDeps {
	return {
		getBatch: vi.fn(async () => null),
		save: vi.fn(async () => {}),
		pinnedHostOk: vi.fn(async () => true),
		sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
		evaluateGate: vi.fn(async () => ({
			mode: "authorized" as const,
			allowed: true,
			host: HOST,
		})),
		sendGrant: vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: "https://dx-999-adm.ympxbys.xyz/post/1",
		})),
		appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
		...overrides,
	};
}

function makeAwaitingBatch(topics: string[] = [TOPIC_A]): Batch {
	return {
		id: "batch_1",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		items: topics.map((topic, i) => ({
			id: `item_${i}`,
			topic,
			status: "awaiting-approval" as const,
			draft: { ...DRAFT, id: `item_${i}` },
		})),
	};
}

// ================================================================
// Unit 4: grounding gate bypass 修复 — 集成断言(R3)
// ================================================================

describe("grounding gate bypass fix (Unit 4 integration)", () => {
	it("① 零事实+重写填掉占位符 → runBatch gate-failed(snapshot 拦截)", async () => {
		// This test is covered in batch-run.test.ts (runBatch grounding gate describe).
		// Here we verify markFilled + evaluateGrounding interaction directly.
		const placeholderDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
		};
		const verdict = evaluateGrounding(placeholderDraft, undefined);
		expect(verdict.ok).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});

	it("② 零事实 generateDraft 产物含【待补】 → evaluateGrounding 判定 ok:false", () => {
		const draft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第【待补】集",
		};
		const verdict = evaluateGrounding(draft, undefined);
		expect(verdict.ok).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});

	it("③ 持久化往返后 snapshot 仍含【待补】,checkGrounding 读快照仍拦截", () => {
		const snapshotDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
		};
		const rewrittenDraft: ContentDraft = {
			...DRAFT,
			title: "《斗破苍穹》第1集",
		};
		let batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "generating" as const,
				},
			],
		};
		batch = markFilled(
			batch,
			"item_0",
			rewrittenDraft,
			undefined,
			undefined,
			undefined,
			snapshotDraft,
		);
		const roundtripped = JSON.parse(JSON.stringify(batch));
		const item = roundtripped.items[0];
		expect(item.assembledDraftSnapshot?.title).toContain("【待补】");
		const verdict = evaluateGrounding(item.assembledDraftSnapshot, item.facts);
		expect(verdict.ok).toBe(false);
	});

	it("④ gate-failed 条目不被 presentForApproval 升格", () => {
		let batch: Batch = {
			id: "b1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{ id: "item_0", topic: TOPIC_A, status: "generating" as const },
				{ id: "item_1", topic: TOPIC_B, status: "generating" as const },
			],
		};
		batch = markFilled(batch, "item_0", { ...DRAFT });
		batch = markFilled(batch, "item_1", { ...DRAFT });
		batch = markGateFailed(batch, "item_1", "标题含【待补】");
		batch = presentForApproval(batch);
		expect(batch.items[0]?.status).toBe("awaiting-approval");
		expect(batch.items[1]?.status).toBe("gate-failed");
	});
});

// ================================================================
// approveBatch 发布期 grounding 闸(publish-basis fix)
// ================================================================

describe("approveBatch publish-basis grounding gate", () => {
	const clean = { ...DRAFT, id: "item_0", title: "《斗破苍穹》第1集" };

	it("snapshot 干净但最终 draft 被手编注入【待补】→ gate-failed,不发布(核心泄漏回归)", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval",
					draft: { ...clean, title: "《【待补】》第1集" },
					assembledDraftSnapshot: { ...clean },
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			sendGrant,
			checkGrounding: evaluateGrounding,
		});
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(sendFill).not.toHaveBeenCalled();
		expect(sendGrant).not.toHaveBeenCalled();
	});

	it("snapshot 缺失 → fail-closed gate-failed,不发布", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval",
					draft: { ...clean },
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			checkGrounding: evaluateGrounding,
		});
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(result?.items[0]?.gateFailReason).toContain("缺发布快照");
		expect(sendFill).not.toHaveBeenCalled();
	});

	it("snapshot 与最终 draft 均干净 → 正常发布(不误拦)", async () => {
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval",
					draft: { ...clean },
					assembledDraftSnapshot: { ...clean },
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			sendGrant,
			checkGrounding: evaluateGrounding,
		});
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).not.toBe("gate-failed");
		expect(sendFill).toHaveBeenCalledOnce();
	});
});

// ================================================================
// approveBatch itemIdFilter
// ================================================================

describe("approveBatch itemIdFilter", () => {
	it("只处理 id 匹配的单条，其余 awaiting-approval 保持不变", async () => {
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendGrant,
			itemIdFilter: "item_0",
		});
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("publish-confirmed");
		expect(result?.items[1]?.status).toBe("awaiting-approval");
		expect(sendGrant).toHaveBeenCalledOnce();
	});

	it("itemIdFilter 指向不存在 id: batch 无变化，正常返回", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendGrant,
			itemIdFilter: "nonexistent-id",
		});
		const result = await approveBatch(deps);
		expect(sendGrant).not.toHaveBeenCalled();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
	});

	it("itemIdFilter + recordPost 同时传入: recordPost 仅调用一次(对应过滤条目)", async () => {
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const recordPost = vi.fn(async () => {});
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendGrant,
			recordPost,
			itemIdFilter: "item_0",
		});
		await approveBatch(deps);
		expect(recordPost).toHaveBeenCalledOnce();
	});

	it("itemIdFilter 为 undefined 时行为与无过滤一致", async () => {
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendGrant,
		});
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("publish-confirmed");
		expect(result?.items[1]?.status).toBe("publish-confirmed");
		expect(sendGrant).toHaveBeenCalledTimes(2);
	});
});

// ================================================================
// Unit 7: 填充前 grounding 复检 — 堵升格后内联编辑旁路(R10)
// ================================================================

describe("approveBatch 填充前 grounding 复检 (Unit 7)", () => {
	it("旁路回归: snapshot 干净但 item.draft 被改入【待补】→ authorized 发布被拦,sendFill 不调,标 grounding-blocked", async () => {
		const cleanSnapshot: ContentDraft = {
			...DRAFT,
			title: "《斗破苍穹》第1集",
		};
		const tamperedDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
		};
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval" as const,
					draft: tamperedDraft,
					assembledDraftSnapshot: cleanSnapshot,
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			checkGrounding: evaluateGrounding,
		});
		await approveBatch(deps);
		expect(sendFill).not.toHaveBeenCalled();
	});

	it("happy: 干净已升格条目通过填充前复检,sendFill 被调", async () => {
		const cleanDraft: ContentDraft = { ...DRAFT, title: "《斗破苍穹》第1集" };
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval" as const,
					draft: cleanDraft,
					assembledDraftSnapshot: cleanDraft,
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			checkGrounding: evaluateGrounding,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledOnce();
	});

	it("集成: 复检用四字段检测器 —— item.draft 的 subtitle 含【待补】也拦", async () => {
		const cleanSnapshot: ContentDraft = { ...DRAFT, subtitle: "干净副标" };
		const tamperedDraft: ContentDraft = { ...DRAFT, subtitle: "副标【待补】" };
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval" as const,
					draft: tamperedDraft,
					assembledDraftSnapshot: cleanSnapshot,
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill,
			checkGrounding: evaluateGrounding,
		});
		await approveBatch(deps);
		expect(sendFill).not.toHaveBeenCalled();
	});

	it("集成: 复检用 factUrls 源 —— item.draft 含无来源链接拦,facts 含该链接则放行", async () => {
		const url = "https://h.example.com/a";
		const draftWithLink: ContentDraft = {
			...DRAFT,
			title: "《斗破苍穹》第1集",
			body: `<p>正文 <a href="${url}">来源</a></p>`,
		};
		const makeBatch = (): Batch => ({
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval" as const,
					draft: draftWithLink,
					assembledDraftSnapshot: { ...DRAFT, title: "《斗破苍穹》第1集" },
				},
			],
		});

		const unsourced = makeBatch();
		const sendFillA = vi.fn(async () => ({ ok: true as const, results: [] }));
		await approveBatch(
			makeApproveDeps({
				getBatch: vi.fn(async () => unsourced),
				sendFill: sendFillA,
				checkGrounding: evaluateGrounding,
			}),
		);
		expect(sendFillA).not.toHaveBeenCalled();

		const sourced = makeBatch();
		sourced.items[0]!.facts = { 漢化: url };
		const sendFillB = vi.fn(async () => ({ ok: true as const, results: [] }));
		await approveBatch(
			makeApproveDeps({
				getBatch: vi.fn(async () => sourced),
				sendFill: sendFillB,
				checkGrounding: evaluateGrounding,
			}),
		);
		expect(sendFillB).toHaveBeenCalledOnce();
	});

	it("非 authorized 档(dry-run)不跑填充前复检: item.draft 含【待补】仍照常 sendFill", async () => {
		const tamperedDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
		};
		const batch: Batch = {
			id: "batch_1",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{
					id: "item_0",
					topic: TOPIC_A,
					status: "awaiting-approval" as const,
					draft: tamperedDraft,
					assembledDraftSnapshot: { ...DRAFT, title: "《斗破苍穹》第1集" },
				},
			],
		};
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			sendFill,
			checkGrounding: evaluateGrounding,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledOnce();
	});
});

// ================================================================
// approveBatch first-flight 互锁(Unit 5)
// ================================================================

describe("approveBatch first-flight 互锁", () => {
	it("happy:guard 全允许 → 单条 fill + grant", async () => {
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: "https://dx-999-adm.ympxbys.xyz/post/1",
		}));
		const guard = vi.fn(async () => ({ allowed: true }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A])),
			sendFill,
			sendGrant,
			firstFlightGuard: guard,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledOnce();
		expect(sendGrant).toHaveBeenCalledOnce();
		expect(guard).toHaveBeenCalledTimes(2);
	});

	it("P0:整批 approve,非匹配项 guard 拒绝 → 该项零 fill、零 grant", async () => {
		const guard = vi.fn(async (ctx: { itemId: string }) => ({
			allowed: ctx.itemId === "item_0",
		}));
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: "https://dx-999-adm.ympxbys.xyz/post/1",
		}));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A, TOPIC_B])),
			sendFill,
			sendGrant,
			firstFlightGuard: guard,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledTimes(1);
		expect(sendFill).toHaveBeenCalledWith(
			expect.objectContaining({ id: "item_0" }),
		);
		expect(sendGrant).toHaveBeenCalledTimes(1);
	});

	it("fill 决策点拒绝 → 既不 fill 也不 grant", async () => {
		const guard = vi.fn(async () => ({ allowed: false }));
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({ ok: true, dryRun: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A])),
			sendFill,
			sendGrant,
			firstFlightGuard: guard,
		});
		await approveBatch(deps);
		expect(sendFill).not.toHaveBeenCalled();
		expect(sendGrant).not.toHaveBeenCalled();
	});

	it("dry-run 档:guard 不参与(fill 决策点跳过,正常 dry-run)", async () => {
		const guard = vi.fn(async () => ({ allowed: false }));
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A])),
			sendFill,
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			firstFlightGuard: guard,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledOnce();
	});

	it("无 guard(省略)→ 零行为变更(基线 fill+grant)", async () => {
		const sendFill = vi.fn(async () => ({ ok: true as const, results: [] }));
		const sendGrant = vi.fn(async () => ({
			ok: true,
			dryRun: false,
			url: "https://dx-999-adm.ympxbys.xyz/post/1",
		}));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A])),
			sendFill,
			sendGrant,
		});
		await approveBatch(deps);
		expect(sendFill).toHaveBeenCalledOnce();
		expect(sendGrant).toHaveBeenCalledOnce();
	});
});
