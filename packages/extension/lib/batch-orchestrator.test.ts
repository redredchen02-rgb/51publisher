import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import type {
	ApproveBatchDeps,
	RetryItemDeps,
	RunBatchDeps,
} from "./batch-orchestrator";
import { approveBatch, retryItem, runBatch } from "./batch-orchestrator";

// ---- helpers ----

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

/** 生成一个含 N 条 awaiting-approval 条目的 batch(用于 approveBatch 测试)。 */
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
		// generateDraft 被调用 2 次
		expect(deps.generateDraft).toHaveBeenCalledTimes(2);
		// 签名改为 (topic, facts, enrichment);无事实/富化时为 undefined。
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
				return call === 1; // 第 1 次 ok,第 2 次漂移
			}),
		});
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		// generateDraft 只被调 1 次(第 2 条因漂移跳过)
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
		// 第 1 条 error,第 2 条 awaiting-approval
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
		// TOPIC_A 被过滤,只生成 TOPIC_B
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
});

// ================================================================
// approveBatch
// ================================================================

describe("approveBatch", () => {
	it("happy path (authorized 真发): 条目变 publish-confirmed,appendTrajectory 被调 1 次", async () => {
		const batch = makeAwaitingBatch();
		const deps = makeApproveDeps({ getBatch: vi.fn(async () => batch) });
		const result = await approveBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("publish-confirmed");
		expect(deps.sendGrant).toHaveBeenCalledOnce();
		expect(deps.appendTrajectory).toHaveBeenCalledOnce();
	});

	it("填充失败: sendFill 返回 ok:false → 条目留在 awaiting-approval(markGenerateFailed 对此状态无效,已知行为),sendGrant/appendTrajectory 不被调", async () => {
		// markGenerateFailed 仅接受 queued/generating/filled,awaiting-approval 转移无效 → 状态不变。
		// 这是与 background.ts 原始行为的语义一致:不改动 batch.ts 状态机。
		const batch = makeAwaitingBatch();
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill: vi.fn(async () => ({
				ok: false as const,
				error: "fill-unreachable",
			})),
		});
		const result = await approveBatch(deps);
		expect(result).not.toBeNull();
		// 状态维持 awaiting-approval(原 background.ts 同等行为)
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.appendTrajectory).not.toHaveBeenCalled();
	});

	it("闸门拒绝 (blocked): evaluateGate allowed=false → 条目留在 awaiting-approval,循环 break", async () => {
		// blocked:orchestratePublish 返回 { ok:false, dryRun:false, error:'blocked' }。
		// writeConfirmed 不被 orchestratePublish 调用 → 状态留在 awaiting-approval。
		// !result.dryRun → appendTrajectory 被调 1 次(与原 background.ts 行为一致)。
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "authorized" as const,
				allowed: false,
				host: HOST,
			})),
		});
		const result = await approveBatch(deps);
		expect(result).not.toBeNull();
		// 两条都留在 awaiting-approval
		expect(result?.items.every((it) => it.status === "awaiting-approval")).toBe(
			true,
		);
		expect(deps.sendGrant).not.toHaveBeenCalled();
		// appendTrajectory 被调:blocked 时 dryRun=false,记录第一条条目的尝试(原始行为)
		expect(deps.appendTrajectory).toHaveBeenCalledOnce();
		// 第 2 条因 break 未处理 → sendFill 只调 1 次
		expect(deps.sendFill).toHaveBeenCalledOnce();
	});

	it("dry-run: sendGrant 不被调,条目状态不变,appendTrajectory 不被调", async () => {
		const batch = makeAwaitingBatch();
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
		});
		const result = await approveBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval"); // 未变
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.appendTrajectory).not.toHaveBeenCalled();
	});

	it("tab 漂移: pinnedHostOk 返回 false → 循环 break,sendFill 不被调", async () => {
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			pinnedHostOk: vi.fn(async () => false),
		});
		const result = await approveBatch(deps);
		expect(result).not.toBeNull();
		expect(deps.sendFill).not.toHaveBeenCalled();
		expect(deps.sendGrant).not.toHaveBeenCalled();
	});

	it("快照丢弃: appendTrajectory 返回 snapshotDropped=true → onSnapshotDropped 被调", async () => {
		const batch = makeAwaitingBatch();
		const onDropped = vi.fn();
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			appendTrajectory: vi.fn(async () => ({ snapshotDropped: true })),
			onSnapshotDropped: onDropped,
		});
		await approveBatch(deps);
		expect(onDropped).toHaveBeenCalledOnce();
		expect(onDropped).toHaveBeenCalledWith("item_0");
	});
});

// ================================================================
// approveBatch — dry-run report (U6)
// ================================================================

describe("approveBatch dry-run report", () => {
	it("dry-run: saveDryRunReportFn called with 1 item containing fillResults", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const saveFn = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			sendFill: vi.fn(async () => ({
				ok: true as const,
				results: [{ field: "title", status: "filled" as const }],
			})),
			saveDryRunReportFn: saveFn,
		});
		await approveBatch(deps);
		expect(saveFn).toHaveBeenCalledOnce();
		expect(saveFn).toHaveBeenCalledWith(
			expect.objectContaining({
				batchId: "batch_1",
				items: expect.arrayContaining([
					expect.objectContaining({
						topic: TOPIC_A,
						fillResults: [{ field: "title", status: "filled" }],
					}),
				]),
			}),
		);
	});

	it("dry-run: saveDryRunReportFn called with correct count for 2 items", async () => {
		const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
		const saveFn = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
			saveDryRunReportFn: saveFn,
		});
		await approveBatch(deps);
		expect(saveFn).toHaveBeenCalledOnce();
		expect(saveFn).toHaveBeenCalledWith(
			expect.objectContaining({
				items: expect.arrayContaining([expect.anything(), expect.anything()]),
			}),
		);
	});

	it("authorized (non-dry-run): saveDryRunReportFn NOT called", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const saveFn = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			saveDryRunReportFn: saveFn,
		});
		await approveBatch(deps);
		expect(saveFn).not.toHaveBeenCalled();
	});
});

// ================================================================
// approveBatch — tombstone protocol (U5)
// ================================================================

describe("approveBatch tombstone protocol", () => {
	it("tombstone written before sendFill, cleared after successful fill", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const callOrder: string[] = [];
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill: vi.fn(async () => {
				callOrder.push("sendFill");
				return { ok: true as const, results: [] };
			}),
			writeTombstone: vi.fn(async () => {
				callOrder.push("write");
			}),
			clearTombstone: vi.fn(async () => {
				callOrder.push("clear");
			}),
		});
		await approveBatch(deps);
		expect(callOrder).toEqual(["write", "sendFill", "clear"]);
	});

	it("sendFill fails: tombstone still cleared (item enters error, not limbo)", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const clearTombstone = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendFill: vi.fn(async () => ({ ok: false as const, error: "fill-fail" })),
			writeTombstone: vi.fn(async () => {}),
			clearTombstone,
		});
		await approveBatch(deps);
		expect(clearTombstone).toHaveBeenCalledWith("item_0");
	});
});

describe("approveBatch dry-run report", () => {
	it("saveDryRunReportFn throws: approveBatch does not rethrow", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
			saveDryRunReportFn: vi.fn(async () => {
				throw new Error("storage-fail");
			}),
		});
		await expect(approveBatch(deps)).resolves.not.toThrow();
	});
});

// ================================================================
// approveBatch — recordPost (U10)
// ================================================================

describe("approveBatch recordPost (U10)", () => {
	it("publish-confirmed: recordPost 以正确字段被调用一次", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const recordPost = vi.fn(async () => {});
		const now = vi.fn(() => "2026-06-11T00:00:00.000Z");
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			sendGrant: vi.fn(async () => ({
				ok: true,
				dryRun: false,
				url: "https://dx-999-adm.ympxbys.xyz/post/1",
			})),
			recordPost,
			now,
		});
		await approveBatch(deps);
		expect(recordPost).toHaveBeenCalledOnce();
		expect(recordPost).toHaveBeenCalledWith(
			expect.objectContaining({
				batchItemId: "item_0",
				sourceTitle: TOPIC_A,
				publishUrl: "https://dx-999-adm.ympxbys.xyz/post/1",
				publishedAt: "2026-06-11T00:00:00.000Z",
			}),
		);
		// id 是 UUID 字符串(非空)
		const record = (
			recordPost.mock.calls as unknown as [[{ id: string }]]
		)[0][0];
		expect(typeof record.id).toBe("string");
		expect(record.id.length).toBeGreaterThan(0);
	});

	it("recordPost 抛出: 不传播(fire-and-forget),approveBatch 正常返回", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const recordPost = vi.fn(async () => {
			throw new Error("backend-down");
		});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			recordPost,
		});
		await expect(approveBatch(deps)).resolves.not.toThrow();
		const result = await approveBatch(
			makeApproveDeps({
				getBatch: vi.fn(async () => makeAwaitingBatch([TOPIC_A])),
				recordPost,
			}),
		);
		expect(result?.items[0]?.status).toBe("publish-confirmed");
	});

	it("publishUrl 为空(sendGrant 未返回 url): recordPost 仍被调用,publishUrl 为空字符串", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const recordPost = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			// sendGrant 返回成功但无 url 字段
			sendGrant: vi.fn(async () => ({ ok: true, dryRun: false })),
			recordPost,
		});
		await approveBatch(deps);
		expect(recordPost).toHaveBeenCalledOnce();
		expect(recordPost).toHaveBeenCalledWith(
			expect.objectContaining({ publishUrl: "" }),
		);
	});

	it("now dep 注入: publishedAt 使用注入值而非系统时钟", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const recordPost = vi.fn(async () => {});
		const fixedTs = "2030-01-01T12:00:00.000Z";
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			recordPost,
			now: () => fixedTs,
		});
		await approveBatch(deps);
		expect(recordPost).toHaveBeenCalledWith(
			expect.objectContaining({ publishedAt: fixedTs }),
		);
	});

	it("dry-run: recordPost 不被调用", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const recordPost = vi.fn(async () => {});
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			evaluateGate: vi.fn(async () => ({
				mode: "dry-run" as const,
				allowed: false,
				host: HOST,
			})),
			sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
			recordPost,
		});
		await approveBatch(deps);
		expect(recordPost).not.toHaveBeenCalled();
	});

	it("recordPost 未注入(省略): 不报错,正常 publish-confirmed", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const deps = makeApproveDeps({ getBatch: vi.fn(async () => batch) });
		// 无 recordPost dep — 不应抛出
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("publish-confirmed");
	});
});

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
		expect(save).toHaveBeenCalledTimes(3); // queued, generating, filled+approval
	});

	// ---- 封面回注(Unit 3):retry 重生成后从持久化的 item.coverImageUrl 回注 ----

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
		// 生成恒置 ''(DRAFT.coverImageUrl=''),回注后应为持久化值
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
		const batch = errorBatch(TOPIC_A); // errorBatch 构造无 coverImageUrl 字段 = 旧批次形态
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
		const capturedUrls: string[] = [];
		const deps = makeRunDeps({
			topics: [TOPIC_A, TOPIC_B],
			coverImageUrls: ["http://only-a.jpg"],
			save: vi.fn(async (b: Batch) => {
				for (const item of b.items) {
					if (item.draft) capturedUrls.push(item.draft.coverImageUrl);
				}
			}),
		});
		await runBatch(deps);
		// 验证 TOPIC_A 有 URL，TOPIC_B 没有（通过草稿状态间接检查）
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
			persistentBlockedTopics: [TOPIC_A], // TOPIC_A 被过滤,验证封面跟 topic 走不错位
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
		expect(result?.items[0]?.draft?.title).toBe(DRAFT.title); // 草稿未变
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
		expect(result?.items).toHaveLength(2); // loop 未中断
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
		expect(result?.items[0]?.draft?.title).toBe(DRAFT.title); // 原草稿保留
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
		// 两条都 gate-failed — presentForApproval 只促升 filled,gate-failed 留原状
		expect(result?.items.every((it) => it.status === "gate-failed")).toBe(true);
	});

	it("gate 未注入时使用默认 evaluateGrounding(不报错,正常生成)", async () => {
		// DRAFT.title='T', body='<p>body</p>',均无【待补】和无来源链接 → 应通过
		const deps = makeRunDeps({ topics: [TOPIC_A] });
		// 不注入 evaluateGrounding
		const result = await runBatch(deps);
		expect(result).not.toBeNull();
		expect(result?.items[0]?.status).toBe("awaiting-approval");
	});
});

// ================================================================
// Unit 4: grounding gate bypass 修复 — 集成断言(R3)
// 不 mock gate / mergeRewriteResult,走真实函数。
// ================================================================

import { markFilled, markGateFailed, presentForApproval } from "./batch";
import { evaluateGrounding } from "./grounding-gate";

describe("grounding gate bypass fix (Unit 4 integration)", () => {
	// ① 零事实选题:AI 重写填掉【待补】后,gate 仍应拦截(读 snapshot 而非重写稿)
	it("① 零事实+重写填掉占位符 → runBatch gate-failed(snapshot 拦截)", async () => {
		const placeholderDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
			body: "<p>精彩内容</p>",
		};
		const rewrittenDraft: ContentDraft = {
			...DRAFT,
			title: "《斗破苍穹》第1集",
			body: "<p>精彩内容</p>",
		};
		let generateCalled = false;
		const deps = makeRunDeps({
			topics: [TOPIC_A],
			generateDraft: vi.fn(async () => {
				generateCalled = true;
				return { ok: true as const, draft: { ...placeholderDraft } };
			}),
			// reviewDraft 触发重写(title_quality 是 mergeRewriteResult 合并 title 的维度名)
			reviewDraft: vi.fn(async () => ({
				ok: true as const,
				result: {
					ok: true,
					dimensions: [{ name: "title_quality", pass: false }],
				},
			})),
			rewriteDraft: vi.fn(async () => ({
				ok: true as const,
				draft: { ...rewrittenDraft },
			})),
			// 不注入 evaluateGrounding → 使用真实函数
		});
		const result = await runBatch(deps);
		expect(generateCalled).toBe(true);
		expect(result).not.toBeNull();
		// 重写后 item.draft 不含【待补】,但 snapshot 含 → gate 仍拦截
		expect(result?.items[0]?.status).toBe("gate-failed");
		// snapshot 保留原始占位
		expect(result?.items[0]?.assembledDraftSnapshot?.title).toContain(
			"【待补】",
		);
		// item.draft 是重写后的(发布时用)
		expect(result?.items[0]?.draft?.title).not.toContain("【待补】");
	});

	// ② post-assembler 原稿确实含【待补】(守护 R2 前置假设)
	it("② 零事实 generateDraft 产物含【待补】 → evaluateGrounding 判定 ok:false", () => {
		const draft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第【待补】集",
		};
		const verdict = evaluateGrounding(draft, undefined);
		expect(verdict.ok).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});

	// ③ 持久化往返:snapshot 含【待补】,checkGrounding(snapshot) 仍拦
	it("③ 持久化往返后 snapshot 仍含【待补】,checkGrounding 读快照仍拦截", () => {
		const snapshotDraft: ContentDraft = {
			...DRAFT,
			title: "《【待补】》第1集",
		};
		const rewrittenDraft: ContentDraft = {
			...DRAFT,
			title: "《斗破苍穹》第1集",
		};
		// 模拟 markFilled 写入后序列化往返
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
		// 序列化往返
		const roundtripped = JSON.parse(JSON.stringify(batch));
		const item = roundtripped.items[0];
		// 往返后 snapshot 仍含【待补】
		expect(item.assembledDraftSnapshot?.title).toContain("【待补】");
		// checkGrounding(snapshot) 应拦截
		const verdict = evaluateGrounding(item.assembledDraftSnapshot, item.facts);
		expect(verdict.ok).toBe(false);
	});

	// ④ markGateFailed 后不被 presentForApproval 升格为 awaiting-approval
	it("④ gate-failed 条目不被 presentForApproval 升格", () => {
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
				{
					id: "item_1",
					topic: TOPIC_B,
					status: "generating" as const,
				},
			],
		};
		// item_0 走正常路径 → filled
		batch = markFilled(batch, "item_0", { ...DRAFT });
		// item_1 gate 失败 → gate-failed
		batch = markFilled(batch, "item_1", { ...DRAFT });
		batch = markGateFailed(batch, "item_1", "标题含【待补】");
		// presentForApproval 只升格 filled
		batch = presentForApproval(batch);
		expect(batch.items[0]?.status).toBe("awaiting-approval");
		expect(batch.items[1]?.status).toBe("gate-failed"); // 不得被升格
	});
});

// itemIdFilter
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
