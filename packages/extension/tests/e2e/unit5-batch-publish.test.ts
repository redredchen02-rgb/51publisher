// @vitest-environment jsdom
// U5 完整批量发布链路：approveBatch(单条) → 表单填充 → 发布确认 → recordPost 回写
//
// 验证边界：
//   - approveBatch + 真实 executePublish：POST /save 端点 = 1（fetch spy 计数）
//   - postStatus="0"（隐藏帖默认）→ appendTrajectory publishedAsDraft=true
//   - itemIdFilter 精准：2 条批次只发 1 条，POST 计数 = 1，另一条保持 awaiting-approval
//   - recordPost 在确认后被调用，含 batchItemId、sourceTitle、publishUrl
//   - read-tracker 约束在 TodayBatchView UI 层实施，此层不重复验证

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentDraft } from "@51publisher/shared";
import type { Batch } from "../../lib/batch";
import type { ApproveBatchDeps } from "../../lib/batch-orchestrator";
import { approveBatch } from "../../lib/batch-orchestrator";
import { executePublish } from "../../lib/publish";
import type { PublishedPostRecord } from "../../lib/published-posts-client";
import { installFetchSubmitSpy } from "./helpers/authorized-submit";

// ---- 常量 ----

const HOST = "dx-999-adm.ympxbys.xyz";
const SAVE = "/admin/webarticle/save";
const TOPIC_A = "测试作品 Vol.1";
const TOPIC_B = "测试作品 Vol.2";

const HIDDEN_DRAFT: ContentDraft = {
	id: "item_0",
	title: "测试作品 Vol.1 介绍",
	subtitle: "51娘推荐",
	category: "2",
	coverImageUrl: "",
	body: "<p>精彩正文内容</p>",
	tags: [],
	description: "一段描述",
	postStatus: "0", // 隐藏帖默认
	publishedAt: "2026-06-12",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-12T00:00:00.000Z",
};

// ---- DOM 辅助 ----

function mountPublishForm(): void {
	document.body.innerHTML = `
    <form lay-filter="form-save">
      <input name="media_id" value="1" />
      <input name="title" value="标题" />
      <input type="hidden" name="html_content" value="" />
      <button lay-submit lay-filter="save">保存</button>
    </form>
    <div id="editor"><div class="ql-editor"><p>精彩正文内容</p></div></div>
  `;
}

// ---- batch 辅助 ----

function makeAwaitingBatch(
	topics: { topic: string; draft: ContentDraft }[],
): Batch {
	return {
		id: "batch_u5",
		tabId: 1,
		authorizedHost: HOST,
		createdAt: "2026-06-12T00:00:00.000Z",
		items: topics.map(({ topic, draft }, i) => ({
			id: `item_${i}`,
			topic,
			status: "awaiting-approval" as const,
			draft: { ...draft, id: `item_${i}` },
		})),
	};
}

function makeApproveDeps(
	batch: Batch,
	overrides: Partial<ApproveBatchDeps> = {},
): ApproveBatchDeps {
	return {
		getBatch: vi.fn(async () => batch),
		save: vi.fn(async () => {}),
		pinnedHostOk: vi.fn(async () => true),
		sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
		evaluateGate: vi.fn(async () => ({
			mode: "authorized" as const,
			allowed: true,
			host: HOST,
		})),
		sendGrant: () => executePublish({ saveEndpoint: SAVE }),
		appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
		...overrides,
	};
}

// ================================================================
// U5-A 完整链路：approveBatch + 真实 executePublish
// ================================================================

describe("U5-A approveBatch + executePublish 完整链路", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("单条批次：授权发布 → POST /save = 1，状态 publish-confirmed", async () => {
		mountPublishForm();
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		const spy = installFetchSubmitSpy();
		try {
			const result = await approveBatch(makeApproveDeps(batch));
			expect(spy.submitCount()).toBe(1);
			expect(result?.items[0]?.status).toBe("publish-confirmed");
		} finally {
			spy.restore();
		}
	});

	it("sendFill 失败 → POST = 0，sendGrant 不被触发", async () => {
		mountPublishForm();
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		const spy = installFetchSubmitSpy();
		try {
			await approveBatch(
				makeApproveDeps(batch, {
					sendFill: vi.fn(async () => ({
						ok: false as const,
						error: "fill-unreachable",
					})),
				}),
			);
			expect(spy.submitCount()).toBe(0);
		} finally {
			spy.restore();
		}
	});

	it("闸门拒绝(allowed=false) → POST = 0", async () => {
		mountPublishForm();
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		const spy = installFetchSubmitSpy();
		try {
			await approveBatch(
				makeApproveDeps(batch, {
					evaluateGate: vi.fn(async () => ({
						mode: "authorized" as const,
						allowed: false,
						host: HOST,
					})),
				}),
			);
			expect(spy.submitCount()).toBe(0);
		} finally {
			spy.restore();
		}
	});
});

// ================================================================
// U5-B postStatus="0" → trajectory publishedAsDraft=true
// ================================================================

describe("U5-B postStatus 隐藏帖 → trajectory publishedAsDraft", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it('postStatus="0" → appendTrajectory 收到 publishedAsDraft: true', async () => {
		mountPublishForm();
		const spy = installFetchSubmitSpy();
		const appendTrajectory = vi.fn(async () => ({ snapshotDropped: false }));
		const batch = makeAwaitingBatch([
			{ topic: TOPIC_A, draft: { ...HIDDEN_DRAFT, postStatus: "0" } },
		]);
		try {
			await approveBatch(makeApproveDeps(batch, { appendTrajectory }));
		} finally {
			spy.restore();
		}
		expect(appendTrajectory).toHaveBeenCalledOnce();
		expect(appendTrajectory).toHaveBeenCalledWith(expect.objectContaining({
			publishedAsDraft: true,
		}));
	});

	it('postStatus="1" → appendTrajectory 收到 publishedAsDraft: false', async () => {
		mountPublishForm();
		const spy = installFetchSubmitSpy();
		const appendTrajectory = vi.fn(async () => ({ snapshotDropped: false }));
		const batch = makeAwaitingBatch([
			{ topic: TOPIC_A, draft: { ...HIDDEN_DRAFT, postStatus: "1" } },
		]);
		try {
			await approveBatch(makeApproveDeps(batch, { appendTrajectory }));
		} finally {
			spy.restore();
		}
		expect(appendTrajectory).toHaveBeenCalledWith(expect.objectContaining({
			publishedAsDraft: false,
		}));
	});
});

// ================================================================
// U5-C itemIdFilter 精准单条发布
// ================================================================

describe("U5-C itemIdFilter 精准单条发布", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("2 条批次，itemIdFilter=item_0 → POST = 1，item_1 保持 awaiting-approval", async () => {
		mountPublishForm();
		const batch = makeAwaitingBatch([
			{ topic: TOPIC_A, draft: HIDDEN_DRAFT },
			{ topic: TOPIC_B, draft: { ...HIDDEN_DRAFT, id: "item_1" } },
		]);
		const spy = installFetchSubmitSpy();
		try {
			const result = await approveBatch(
				makeApproveDeps(batch, { itemIdFilter: "item_0" }),
			);
			expect(spy.submitCount()).toBe(1);
			expect(result?.items[0]?.status).toBe("publish-confirmed");
			expect(result?.items[1]?.status).toBe("awaiting-approval");
		} finally {
			spy.restore();
		}
	});

	it("itemIdFilter 指向不存在 id → POST = 0，所有条目不变", async () => {
		mountPublishForm();
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		const spy = installFetchSubmitSpy();
		try {
			const result = await approveBatch(
				makeApproveDeps(batch, { itemIdFilter: "nonexistent" }),
			);
			expect(spy.submitCount()).toBe(0);
			expect(result?.items[0]?.status).toBe("awaiting-approval");
		} finally {
			spy.restore();
		}
	});
});

// ================================================================
// U5-D recordPost 回写集成
// ================================================================

describe("U5-D recordPost 回写集成", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("授权发布成功 → recordPost 被调用，含 batchItemId + sourceTitle", async () => {
		mountPublishForm();
		const spy = installFetchSubmitSpy();
		const recordPost = vi.fn(async (_r: PublishedPostRecord) => {});
		const fixedTs = "2026-06-12T08:00:00.000Z";
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		try {
			await approveBatch(
				makeApproveDeps(batch, { recordPost, now: () => fixedTs }),
			);
		} finally {
			spy.restore();
		}
		expect(recordPost).toHaveBeenCalledOnce();
		expect(recordPost).toHaveBeenCalledWith(expect.objectContaining({
			batchItemId: "item_0",
			sourceTitle: TOPIC_A,
			publishedAt: fixedTs,
		}));
	});

	it("recordPost 抛出 → approveBatch 不传播（fire-and-forget），状态仍 publish-confirmed", async () => {
		mountPublishForm();
		const spy = installFetchSubmitSpy();
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		try {
			const result = await approveBatch(
				makeApproveDeps(batch, {
					recordPost: vi.fn(async () => {
						throw new Error("backend-down");
					}),
				}),
			);
			expect(result?.items[0]?.status).toBe("publish-confirmed");
		} finally {
			spy.restore();
		}
	});

	it("dry-run → recordPost 不被调用", async () => {
		mountPublishForm();
		const spy = installFetchSubmitSpy();
		const recordPost = vi.fn(async (_r: PublishedPostRecord) => {});
		const batch = makeAwaitingBatch([{ topic: TOPIC_A, draft: HIDDEN_DRAFT }]);
		try {
			await approveBatch(
				makeApproveDeps(batch, {
					evaluateGate: vi.fn(async () => ({
						mode: "dry-run" as const,
						allowed: false,
						host: HOST,
					})),
					recordPost,
				}),
			);
		} finally {
			spy.restore();
		}
		expect(recordPost).not.toHaveBeenCalled();
	});
});
