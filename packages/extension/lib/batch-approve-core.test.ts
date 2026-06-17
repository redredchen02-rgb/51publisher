import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import type { ApproveBatchDeps } from "./batch-orchestrator";
import { approveBatch } from "./batch-orchestrator";

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

	it("填充失败: sendFill 返回 ok:false → 条目留在 awaiting-approval,sendGrant/appendTrajectory 不被调", async () => {
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
		expect(result?.items[0]?.status).toBe("awaiting-approval");
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.appendTrajectory).not.toHaveBeenCalled();
	});

	it("闸门拒绝 (blocked): evaluateGate allowed=false → 条目留在 awaiting-approval,循环 break", async () => {
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
		expect(result?.items.every((it) => it.status === "awaiting-approval")).toBe(
			true,
		);
		expect(deps.sendGrant).not.toHaveBeenCalled();
		expect(deps.appendTrajectory).toHaveBeenCalledOnce();
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
		expect(result?.items[0]?.status).toBe("awaiting-approval");
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
		const result = await approveBatch(deps);
		expect(result?.items[0]?.status).toBe("publish-confirmed");
	});
});

// ================================================================
// approveBatch — SlotDiff (assembledDraftSnapshot vs draft)
// ================================================================

describe("approveBatch slotDiff", () => {
	it("assembledDraftSnapshot 存在且 draft 相同:slotDiff.changedSlots 为空", async () => {
		const aiDraft: ContentDraft = { ...DRAFT, title: "AI原稿", body: "<p>原稿</p>" };
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
					draft: { ...aiDraft },
					assembledDraftSnapshot: { ...aiDraft },
				},
			],
		};
		const appendTrajectory = vi.fn(async () => ({ snapshotDropped: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			appendTrajectory,
		});
		await approveBatch(deps);
		const callArg = (appendTrajectory.mock.lastCall as unknown[])[0] as { slotDiff?: { changedSlots: string[] } };
		expect(callArg.slotDiff?.changedSlots).toHaveLength(0);
	});

	it("assembledDraftSnapshot 存在且 draft.title 不同:slotDiff.changedSlots 包含 title", async () => {
		const aiDraft: ContentDraft = { ...DRAFT, title: "AI原稿" };
		const humanDraft: ContentDraft = { ...DRAFT, title: "人工改稿" };
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
					draft: humanDraft,
					assembledDraftSnapshot: aiDraft,
				},
			],
		};
		const appendTrajectory = vi.fn(async () => ({ snapshotDropped: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			appendTrajectory,
		});
		await approveBatch(deps);
		const callArg = (appendTrajectory.mock.lastCall as unknown[])[0] as { slotDiff?: { changedSlots: string[] } };
		expect(callArg.slotDiff?.changedSlots).toContain("title");
	});

	it("assembledDraftSnapshot 缺失(旧条目):appendTrajectory slotDiff 为 undefined", async () => {
		const batch = makeAwaitingBatch([TOPIC_A]);
		const appendTrajectory = vi.fn(async () => ({ snapshotDropped: false }));
		const deps = makeApproveDeps({
			getBatch: vi.fn(async () => batch),
			appendTrajectory,
		});
		await approveBatch(deps);
		const callArg = (appendTrajectory.mock.lastCall as unknown[])[0] as { slotDiff?: unknown };
		expect(callArg.slotDiff).toBeUndefined();
	});
});
