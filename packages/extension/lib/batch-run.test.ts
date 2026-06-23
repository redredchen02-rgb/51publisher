import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import type { RunBatchDeps } from "./batch-orchestrator";
import { runBatch } from "./batch-orchestrator";

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

function makeRunDeps(overrides: Partial<RunBatchDeps> = {}): RunBatchDeps {
	return {
		topics: [TOPIC_A, TOPIC_B],
		tabId: 1,
		resolveHost: vi.fn(async () => HOST),
		getExistingBatch: vi.fn(async () => null),
		pinnedHostOk: vi.fn(async () => true),
		generateDraft: vi.fn(async () => ({
			ok: true as const,
			draft: { ...DRAFT },
		})),
		save: vi.fn(async () => {}),
		genBatchId: vi.fn(() => "batch_1"),
		now: vi.fn(() => "2026-06-04T00:00:00.000Z"),
		...overrides,
	};
}

// ================================================================
// runBatch
// ================================================================

describe("runBatch", () => {
	it("happy path: 2 个 topic 均生成成功 → 全部 awaiting-approval", async () => {
		const deps = makeRunDeps();
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items).toHaveLength(2);
		expect(result?.items.every((it) => it.status === "awaiting-approval")).toBe(
			true,
		);
		expect(deps.generateDraft).toHaveBeenCalledTimes(2);
		expect(deps.generateDraft).toHaveBeenCalledWith(
			TOPIC_A,
			undefined,
			undefined,
		);
		expect(deps.generateDraft).toHaveBeenCalledWith(
			TOPIC_B,
			undefined,
			undefined,
		);
	});

	it("源接地:facts 与 topics 同序平行,透传给 generateDraft 并落到 item.facts", async () => {
		const factsA = { 作品名: "A作", 漢化: "https://h/a" };
		const factsB = { 作品名: "B作" };
		const deps = makeRunDeps({ facts: [factsA, factsB] });
		const result = await runBatch(deps);
		expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, factsA, undefined);
		expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_B, factsB, undefined);
		expect(result?.items[0]?.facts).toEqual(factsA);
		expect(result?.items[1]?.facts).toEqual(factsB);
	});

	it("重入闸:默认过滤已发布选题(persistentBlockedTopics)", async () => {
		const deps = makeRunDeps({ persistentBlockedTopics: [TOPIC_A] });
		const result = await runBatch(deps);
		expect(result?.items.map((it) => it.topic)).toEqual([TOPIC_B]);
	});

	it("R8 迭代通道:bypassReentry=true 时不过滤已发布选题(可重跑对比)", async () => {
		const deps = makeRunDeps({
			persistentBlockedTopics: [TOPIC_A],
			bypassReentry: true,
		});
		const result = await runBatch(deps);
		expect(result?.items.map((it) => it.topic)).toEqual([TOPIC_A, TOPIC_B]);
		expect(deps.generateDraft).toHaveBeenCalledWith(
			TOPIC_A,
			undefined,
			undefined,
		);
	});

	it("tab 漂移中断: pinnedHostOk 第 2 次返回 false → 只生成第 1 条", async () => {
		let call = 0;
		const deps = makeRunDeps({
			pinnedHostOk: vi.fn(async () => {
				call += 1;
				return call === 1;
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(deps.generateDraft).toHaveBeenCalledTimes(1);
	});

	it("生成失败降级: 第 1 条失败 → error;第 2 条继续成功", async () => {
		let call = 0;
		const deps = makeRunDeps({
			generateDraft: vi.fn(async () => {
				call += 1;
				if (call === 1)
					return {
						ok: false as const,
						error: "network",
						kind: "network" as const,
					};
				return { ok: true as const, draft: { ...DRAFT } };
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		const statuses = result?.items.map((it) => it.status);
		expect(statuses?.[0]).toBe("error");
		expect(statuses?.[1]).toBe("awaiting-approval");
	});

	it("重入守卫: topic-a 已被隔离 → 只生成 topic-b", async () => {
		const quarantinedBatch: Batch = {
			id: "old_batch",
			tabId: 1,
			authorizedHost: HOST,
			createdAt: "2026-06-04T00:00:00.000Z",
			items: [
				{ id: "old_0", topic: TOPIC_A, status: "needs-human-verification" },
			],
		};
		const deps = makeRunDeps({
			getExistingBatch: vi.fn(async () => quarantinedBatch),
			topics: [TOPIC_A, TOPIC_B],
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items).toHaveLength(1);
		expect(result?.items[0]?.topic).toBe(TOPIC_B);
	});

	it("host 解析失败 → 返回 null,不创建批次", async () => {
		const deps = makeRunDeps({ resolveHost: vi.fn(async () => null) });
		const result = await runBatch(deps);
		expect(result).toBeNull();
		expect(deps.save).not.toHaveBeenCalled();
		expect(deps.generateDraft).not.toHaveBeenCalled();
	});

	it("并发: 同时最多 3 路 generateDraft 在飞(5 条 → 峰值并发 = 3)", async () => {
		let active = 0;
		let peak = 0;
		const topics = Array.from({ length: 5 }, (_, i) => `conc-${i}`);
		const deps = makeRunDeps({
			topics,
			generateDraft: vi.fn(async () => {
				active += 1;
				peak = Math.max(peak, active);
				await new Promise((r) => setTimeout(r, 0));
				active -= 1;
				return { ok: true as const, draft: { ...DRAFT } };
			}),
		});
		const result = await runBatch(deps);
		expect(deps.generateDraft).toHaveBeenCalledTimes(5);
		expect(peak).toBe(3);
		expect(result?.items.every((it) => it.status === "awaiting-approval")).toBe(
			true,
		);
	});

	it("save 失败 → 异常经 applyMutation 向上传播(不被串行队列吞掉)", async () => {
		let n = 0;
		const deps = makeRunDeps({
			save: vi.fn(async () => {
				n += 1;
				if (n >= 2) throw new Error("storage-full");
			}),
		});
		await expect(runBatch(deps)).rejects.toThrow("storage-full");
	});

	it("并发不互相覆盖: 6 条均成功 → 全部 awaiting-approval 且各有 draft(mutex 守护)", async () => {
		const topics = Array.from({ length: 6 }, (_, i) => `mtx-${i}`);
		const deps = makeRunDeps({ topics });
		const result = await runBatch(deps);
		expect(result?.items).toHaveLength(6);
		expect(result?.items.every((it) => it.status === "awaiting-approval")).toBe(
			true,
		);
		expect(result?.items.every((it) => it.draft != null)).toBe(true);
	});
});

// ================================================================
// runBatch — coverImageUrls wiring
// ================================================================

describe("runBatch coverImageUrls", () => {
	it("coverImageUrls 传入时各 topic 的草稿含对应 coverImageUrl", async () => {
		const capturedDrafts: string[] = [];
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			coverImageUrls: ["http://a.jpg", "http://b.jpg"],
			save: vi.fn(async (b: Batch) => {
				for (const item of b.items) {
					if (item.draft?.coverImageUrl && item.draft.coverImageUrl !== "") {
						capturedDrafts.push(`${item.topic}:${item.draft.coverImageUrl}`);
					}
				}
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(capturedDrafts).toContain(`${TOPIC_A}:http://a.jpg`);
		expect(capturedDrafts).toContain(`${TOPIC_B}:http://b.jpg`);
	});

	it("coverImageUrls 未传入时草稿 coverImageUrl 保持 ''（无回归）", async () => {
		const deps = makeRunDeps({ topics: [TOPIC_A] });
		const result = await runBatch(deps);
		const draft = result?.items[0]?.draft;
		expect(draft?.coverImageUrl).toBe("");
	});

	it("coverImageUrls 比 topics 短时缺失条目默认 ''", async () => {
		const finalBatch = await runBatch(
			makeRunDeps({
				topics: [TOPIC_A, TOPIC_B],
				coverImageUrls: ["http://only-a.jpg"],
			}),
		);
		expect(finalBatch?.items[0]?.draft?.coverImageUrl).toBe(
			"http://only-a.jpg",
		);
		expect(finalBatch?.items[1]?.draft?.coverImageUrl).toBe("");
	});

	it("封面持久化进 BatchItem(Unit 3):重入过滤后仍按 topic 对齐", async () => {
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			coverImageUrls: ["http://a.jpg", "http://b.jpg"],
			persistentBlockedTopics: [TOPIC_A],
		});
		const result = await runBatch(deps);
		expect(result?.items).toHaveLength(1);
		expect(result?.items[0]?.topic).toBe(TOPIC_B);
		expect(result?.items[0]?.coverImageUrl).toBe("http://b.jpg");
		expect(result?.items[0]?.draft?.coverImageUrl).toBe("http://b.jpg");
	});

	// ================================================================
	// Phase-3 review→rewrite pipeline
	// ================================================================

	it("Phase-3: reviewDraft 未注入 → 流程与 Phase 2 一致,aiReviewTriggered 未设置", async () => {
		const deps = makeRunDeps({ topics: [TOPIC_A] });
		const result = await runBatch(deps);
		expect("aiReviewTriggered" in result?.items[0]!).toBe(false);
	});

	it("Phase-3: reviewDraft 全维度通过 → aiReviewTriggered=false,草稿不变", async () => {
		const reviewDraftFn = vi.fn(async () => ({
			ok: true as const,
			result: { ok: true, dimensions: [{ name: "body_richness", pass: true }] },
			reviewCostTokens: { prompt: 100, completion: 30 },
		}));
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			reviewDraft: reviewDraftFn,
			rewriteDraft: vi.fn(),
		});
		const result = await runBatch(deps);
		expect(result?.items[0]?.aiReviewTriggered).toBe(false);
		expect(result?.items[0]?.draft?.title).toBe(DRAFT.title);
		expect(reviewDraftFn).toHaveBeenCalledTimes(1);
	});

	it("Phase-3: reviewDraft 有维度不通过,rewriteDraft 成功 → aiReviewTriggered=true,草稿更新", async () => {
		const rewrittenDraft = { ...DRAFT, title: "重写标题" };
		const reviewDraftFn = vi.fn(async () => ({
			ok: true as const,
			result: {
				ok: false,
				dimensions: [{ name: "title_quality", pass: false }],
			},
			reviewCostTokens: { prompt: 120, completion: 40 },
		}));
		const rewriteDraftFn = vi.fn(async () => ({
			ok: true as const,
			draft: rewrittenDraft,
		}));
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			reviewDraft: reviewDraftFn,
			rewriteDraft: rewriteDraftFn,
		});
		const result = await runBatch(deps);
		expect(result?.items[0]?.aiReviewTriggered).toBe(true);
		expect(result?.items[0]?.draft?.title).toBe("重写标题");
		expect(result?.items[0]?.reviewCostTokens).toEqual({
			prompt: 120,
			completion: 40,
		});
	});

	it("Phase-3: reviewDraft 返回 ok:false → fail-open,aiReviewTriggered 未设置,loop 继续", async () => {
		const reviewDraftFn = vi.fn(async () => ({
			ok: false as const,
			kind: "network" as const,
			error: "连接失败",
		}));
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			reviewDraft: reviewDraftFn,
			rewriteDraft: vi.fn(),
		});
		const result = await runBatch(deps);
		expect("aiReviewTriggered" in result?.items[0]!).toBe(false);
		expect("aiReviewTriggered" in result?.items[1]!).toBe(false);
		expect(result?.items).toHaveLength(2);
	});

	it("Phase-3: rewriteDraft 失败 → fail-open,aiReviewTriggered 未设置,原草稿保留", async () => {
		const reviewDraftFn = vi.fn(async () => ({
			ok: true as const,
			result: {
				ok: false,
				dimensions: [{ name: "body_richness", pass: false }],
			},
		}));
		const rewriteDraftFn = vi.fn(async () => ({
			ok: false as const,
			error: "重写失败",
		}));
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			reviewDraft: reviewDraftFn,
			rewriteDraft: rewriteDraftFn,
		});
		const result = await runBatch(deps);
		expect("aiReviewTriggered" in result?.items[0]!).toBe(false);
		expect(result?.items[0]?.draft?.title).toBe(DRAFT.title);
	});
});

// ================================================================
// runBatch — Phase 5 (U4) eager grounding gate
// ================================================================

describe("runBatch grounding gate (U4)", () => {
	it("happy path: gate 通过 → item 最终状态为 awaiting-approval", async () => {
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			evaluateGrounding: vi.fn(() => ({ ok: true, reasons: [] })),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
	});

	it("gate 失败(含【待补】): item 状态为 gate-failed, gateFailReason 非空", async () => {
		const reason = "标题仍含【待补】(缺作品名),请补全或编辑后再发。";
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			evaluateGrounding: vi.fn(() => ({ ok: false, reasons: [reason] })),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(result?.items[0]?.gateFailReason).toBe(reason);
	});

	it("gate 失败(无来源链接): item 状态为 gate-failed", async () => {
		const reason = "正文含无来源连结(疑似编造 URL),请核实。";
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			evaluateGrounding: vi.fn(() => ({ ok: false, reasons: [reason] })),
		});
		const result = await runBatch(deps);
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(result?.items[0]?.gateFailReason).toContain("无来源");
	});

	it("gate 抛出异常 → fail-open,item 最终状态为 awaiting-approval", async () => {
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			evaluateGrounding: vi.fn(() => {
				throw new Error("gate-system-error");
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
	});

	it("混合结果: 第1条 gate 失败, 第2条通过 → gate-failed + awaiting-approval", async () => {
		let call = 0;
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			evaluateGrounding: vi.fn(() => {
				call += 1;
				if (call === 1) return { ok: false, reasons: ["标题含【待补】"] };
				return { ok: true, reasons: [] };
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("gate-failed");
		expect(result?.items[1]?.status).toBe("awaiting-approval");
	});

	it("gate-failed items 被 presentForApproval 自然跳过(不升格为 awaiting-approval)", async () => {
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			evaluateGrounding: vi.fn(() => ({ ok: false, reasons: ["占位符未填"] })),
		});
		const result = await runBatch(deps);
		expect(result?.items.every((it) => it.status === "gate-failed")).toBe(true);
	});

	it("gate 未注入时使用默认 evaluateGrounding(不报错,正常生成)", async () => {
		const deps = makeRunDeps({ topics: [TOPIC_A] });
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
	});
});
