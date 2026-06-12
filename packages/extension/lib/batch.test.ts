import type { ContentDraft, FieldFillResult } from "@51publisher/shared";
import { describe, expect, it } from "vitest";
import {
	abortBatch,
	type Batch,
	batchPhase,
	batchSummary,
	createBatch,
	filterReentrantTopics,
	markConfirmed,
	markDispatched,
	markFilled,
	markGateFailed,
	markGenerateFailed,
	markGenerating,
	markPublishFailed,
	presentForApproval,
	quarantinedTopics,
	recoverBatch,
	releaseQuarantine,
	retryBatchItem,
	retryFromGateFailed,
	storeFillResults,
} from "./batch";

const genId = (i: number) => `item_${i}`;

function draftFor(id: string): ContentDraft {
	return {
		id: `draft_${id}`,
		title: "t",
		subtitle: "",
		category: "2",
		coverImageUrl: "",
		body: "<p>正文</p>",
		tags: [],
		description: "",
		postStatus: "0",
		publishedAt: "",
		mediaId: "1",
		status: "draft",
		createdAt: "2026-06-04T00:00:00.000Z",
	};
}

function newBatch(topics: string[]): Batch {
	return createBatch(
		"b1",
		42,
		"dx-999-adm.ympxbys.xyz",
		topics,
		"2026-06-04T00:00:00.000Z",
		genId,
	);
}

/** 推到全 awaiting-approval。 */
function fillAll(batch: Batch): Batch {
	let b = batch;
	for (const it of batch.items) {
		b = markGenerating(b, it.id);
		b = markFilled(b, it.id, draftFor(it.id));
	}
	return presentForApproval(b);
}

describe("batch 状态机", () => {
	it("happy:3 选题 → 全 awaiting-approval;approve→dispatched→confirmed→done", () => {
		let b = newBatch(["里番A", "里番B", "里番C"]);
		expect(batchPhase(b)).toBe("generating");
		b = fillAll(b);
		expect(b.items.every((it) => it.status === "awaiting-approval")).toBe(true);
		expect(batchPhase(b)).toBe("awaiting-approval");

		// 逐条 approve→发布
		b = markDispatched(b, "item_0");
		expect(batchPhase(b)).toBe("publishing");
		b = markConfirmed(b, "item_0", "https://dx-999-adm.ympxbys.xyz/post/1");
		expect(b.items[0]?.status).toBe("publish-confirmed");
		expect(b.items[0]?.publishUrl).toContain("/post/1");

		for (const id of ["item_1", "item_2"]) {
			b = markConfirmed(markDispatched(b, id), id);
		}
		expect(batchPhase(b)).toBe("done");
		expect(batchSummary(b).confirmed).toBe(3);
	});

	it("越级转移被拒:queued 直接 markConfirmed 无效", () => {
		const b = newBatch(["x"]);
		const after = markConfirmed(b, "item_0");
		expect(after.items[0]?.status).toBe("queued");
	});

	it("单条生成失败标 error,不阻断其余", () => {
		let b = newBatch(["ok", "bad"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGenerateFailed(b, "item_1", "llm-format");
		b = presentForApproval(b);
		expect(b.items[0]?.status).toBe("awaiting-approval");
		expect(b.items[1]?.status).toBe("error");
		expect(batchSummary(b).errored).toBe(1);
	});

	describe("幂等 / 崩溃恢复(关键)", () => {
		it("已 dispatched 无回执 → recoverBatch 转 needs-human-verification,不重发", () => {
			let b = fillAll(newBatch(["a", "b"]));
			b = markDispatched(b, "item_0"); // 在途,SW 崩溃
			const recovered = recoverBatch(b);
			expect(recovered.items[0]?.status).toBe("needs-human-verification");
			expect(recovered.items[0]?.error).toMatch(/recovered/);
			// item_1 仍 awaiting,不受影响
			expect(recovered.items[1]?.status).toBe("awaiting-approval");
		});

		it("已回执 no-publish-target(确未触发)→ markPublishFailed 清回 error,不隔离", () => {
			let b = fillAll(newBatch(["a"]));
			b = markDispatched(b, "item_0");
			b = markPublishFailed(b, "item_0", "no-publish-target");
			expect(b.items[0]?.status).toBe("error");
			expect(b.items[0]?.error).toBe("no-publish-target");
		});

		it("已 confirmed 的项 recoverBatch 不动", () => {
			let b = fillAll(newBatch(["a"]));
			b = markConfirmed(markDispatched(b, "item_0"), "item_0");
			expect(recoverBatch(b).items[0]?.status).toBe("publish-confirmed");
		});
	});

	describe("隔离退出 + 重入守卫", () => {
		it("needs-human-verification 仅 releaseQuarantine 可离开 → aborted", () => {
			let b = recoverBatch(markDispatched(fillAll(newBatch(["a"])), "item_0"));
			expect(b.items[0]?.status).toBe("needs-human-verification");
			// 其它转移无效
			expect(markConfirmed(b, "item_0").items[0]?.status).toBe(
				"needs-human-verification",
			);
			b = releaseQuarantine(b, "item_0");
			expect(b.items[0]?.status).toBe("aborted");
		});

		it("新批次不重入已隔离的同选题", () => {
			const quarantined = recoverBatch(
				markDispatched(fillAll(newBatch(["里番A", "里番B"])), "item_0"),
			);
			const blocked = quarantinedTopics(quarantined);
			expect(blocked).toEqual(["里番A"]);
			const next = filterReentrantTopics(["里番A", "里番C"], blocked);
			expect(next).toEqual(["里番C"]);
		});
	});

	describe("急停", () => {
		it("KILL:未发布项→aborted;confirmed 不回退;在途 dispatched 不动", () => {
			let b = fillAll(newBatch(["a", "b", "c"]));
			b = markConfirmed(markDispatched(b, "item_0"), "item_0"); // a: confirmed
			b = markDispatched(b, "item_1"); // b: 在途
			// c: 仍 awaiting-approval
			const killed = abortBatch(b);
			expect(killed.items[0]?.status).toBe("publish-confirmed"); // 不回退
			expect(killed.items[1]?.status).toBe("publish-dispatched"); // 在飞不动
			expect(killed.items[2]?.status).toBe("aborted"); // 未发→停
		});
	});

	describe("Phase-2 度量字段 (markFilled + storeFillResults)", () => {
		it("markFilled 携带 llmCostTokens + generationDurationMs → 存入 item", () => {
			let b = newBatch(["x"]);
			b = markGenerating(b, "item_0");
			b = markFilled(
				b,
				"item_0",
				draftFor("item_0"),
				{ prompt: 100, completion: 50 },
				1234,
			);
			const item = b.items[0]!;
			expect(item.llmCostTokens).toEqual({ prompt: 100, completion: 50 });
			expect(item.generationDurationMs).toBe(1234);
		});

		it("markFilled 不传度量参数 → 字段 undefined(不污染旧记录)", () => {
			let b = newBatch(["x"]);
			b = markGenerating(b, "item_0");
			b = markFilled(b, "item_0", draftFor("item_0"));
			const item = b.items[0]!;
			expect(item.llmCostTokens).toBeUndefined();
			expect(item.generationDurationMs).toBeUndefined();
		});

		it("markFilled 快照 publishedDraft 是草稿的 shallow copy", () => {
			const d = draftFor("item_0");
			let b = newBatch(["x"]);
			b = markGenerating(b, "item_0");
			b = markFilled(b, "item_0", d);
			const item = b.items[0]!;
			expect(item.publishedDraft).toEqual(d);
			// shallow copy:不是同一引用
			expect(item.publishedDraft).not.toBe(d);
		});

		it("storeFillResults:patch fillResults,不改变 status", () => {
			let b = newBatch(["x"]);
			b = markGenerating(b, "item_0");
			b = markFilled(b, "item_0", draftFor("item_0"));
			b = presentForApproval(b);
			const results: FieldFillResult[] = [
				{ field: "title", status: "filled" },
				{ field: "category", status: "degraded" },
			];
			b = storeFillResults(b, "item_0", results);
			const item = b.items[0]!;
			expect(item.fillResults).toEqual(results);
			expect(item.status).toBe("awaiting-approval"); // 状态不变
		});

		it("storeFillResults:itemId 不存在 → batch 不变", () => {
			const b = newBatch(["x"]);
			const before = JSON.stringify(b);
			const after = storeFillResults(b, "nonexistent", []);
			expect(JSON.stringify(after)).toBe(before);
		});
	});
});

// ================================================================
// retryBatchItem (U7 — operator override)
// ================================================================

describe("retryBatchItem", () => {
	it("error item → queued, error cleared", () => {
		let b = newBatch(["t"]);
		b = markGenerateFailed(b, "item_0", "network");
		const result = retryBatchItem(b, "item_0");
		expect(result.items[0]?.status).toBe("queued");
		expect(result.items[0]?.error).toBeUndefined();
	});

	it("aborted item → queued", () => {
		let b = newBatch(["t"]);
		b = abortBatch(b);
		const result = retryBatchItem(b, "item_0");
		expect(result.items[0]?.status).toBe("queued");
	});

	it("nonexistent itemId → batch unchanged", () => {
		const b = newBatch(["t"]);
		const result = retryBatchItem(b, "no-such-id");
		expect(result.items[0]?.status).toBe("queued"); // original status
		expect(result).toEqual(b); // identical
	});

	it("publish-confirmed item → still transitions to queued (operator override, no guard)", () => {
		let b = newBatch(["t"]);
		b = fillAll(b);
		b = markDispatched(b, "item_0");
		b = markConfirmed(b, "item_0");
		const result = retryBatchItem(b, "item_0");
		// Intentional: operator override bypasses guards
		expect(result.items[0]?.status).toBe("queued");
	});

	it("other items unchanged", () => {
		let b = newBatch(["a", "b"]);
		b = markGenerateFailed(b, "item_0", "err");
		const result = retryBatchItem(b, "item_0");
		expect(result.items[1]?.status).toBe("queued"); // item_1 untouched
	});

	it("retry 不清除持久化的 coverImageUrl(供重生成后回注)", () => {
		const b = createBatch(
			"b1",
			42,
			"dx-999-adm.ympxbys.xyz",
			["t"],
			"2026-06-04T00:00:00.000Z",
			genId,
			undefined,
			["http://cover.jpg"],
		);
		let after = markGenerateFailed(b, "item_0", "network");
		after = retryBatchItem(after, "item_0");
		expect(after.items[0]?.coverImageUrl).toBe("http://cover.jpg");
	});
});

// ================================================================
// createBatch — coverImageUrls(Unit 3 封面持久化)
// ================================================================

describe("createBatch coverImageUrls", () => {
	const NOW = "2026-06-04T00:00:00.000Z";
	const HOST = "dx-999-adm.ympxbys.xyz";

	it("与 topics 同序平行写入各 item.coverImageUrl", () => {
		const b = createBatch("b1", 42, HOST, ["a", "b"], NOW, genId, undefined, [
			"http://a.jpg",
			"http://b.jpg",
		]);
		expect(b.items[0]?.coverImageUrl).toBe("http://a.jpg");
		expect(b.items[1]?.coverImageUrl).toBe("http://b.jpg");
	});

	it("数组长度不足/含 undefined → 对应条目无 coverImageUrl 字段,其余正常", () => {
		const b = createBatch(
			"b1",
			42,
			HOST,
			["a", "b", "c"],
			NOW,
			genId,
			undefined,
			[undefined, "http://b.jpg"],
		);
		expect("coverImageUrl" in b.items[0]!).toBe(false); // 显式 undefined
		expect(b.items[1]?.coverImageUrl).toBe("http://b.jpg");
		expect("coverImageUrl" in b.items[2]!).toBe(false); // 长度不足
	});

	it("pendingTopicIds 与 topics 同序平行写入各 item.pendingTopicId(U7 状态回写)", () => {
		const b = createBatch(
			"b1",
			42,
			HOST,
			["a", "b"],
			NOW,
			genId,
			undefined,
			undefined,
			["pid_a", undefined],
		);
		expect(b.items[0]?.pendingTopicId).toBe("pid_a");
		expect("pendingTopicId" in b.items[1]!).toBe(false);
	});

	it("未传 coverImageUrls → 所有条目无 coverImageUrl 字段(向后兼容)", () => {
		const b = newBatch(["a", "b"]);
		expect(b.items.every((it) => !("coverImageUrl" in it))).toBe(true);
	});
});

// ================================================================
// Phase-3 reviewMeta (markFilled 第六参数)
// ================================================================

describe("Phase-3 reviewMeta", () => {
	it("triggered=true → aiReviewTriggered=true + reviewCostTokens 写入", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"), undefined, undefined, {
			triggered: true,
			reviewCostTokens: { prompt: 200, completion: 80 },
		});
		expect(b.items[0]?.aiReviewTriggered).toBe(true);
		expect(b.items[0]?.reviewCostTokens).toEqual({
			prompt: 200,
			completion: 80,
		});
	});

	it("triggered=false → aiReviewTriggered=false（通过无重写）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"), undefined, undefined, {
			triggered: false,
		});
		expect(b.items[0]?.aiReviewTriggered).toBe(false);
	});

	it("reviewMeta=undefined → aiReviewTriggered 不写入（fail-open）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		expect("aiReviewTriggered" in b.items[0]!).toBe(false);
	});

	it("triggered=undefined → aiReviewTriggered 不写入（三态语义）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"), undefined, undefined, {
			triggered: undefined,
		});
		expect("aiReviewTriggered" in b.items[0]!).toBe(false);
	});

	it("现有调用方不传 reviewMeta → 向后兼容", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(
			b,
			"item_0",
			draftFor("item_0"),
			{ prompt: 100, completion: 50 },
			500,
		);
		expect(b.items[0]?.llmCostTokens).toEqual({ prompt: 100, completion: 50 });
		expect(b.items[0]?.generationDurationMs).toBe(500);
		expect("aiReviewTriggered" in b.items[0]!).toBe(false);
	});
});

// ================================================================
// gate-failed 状态(U2 — 接地闸门拦截)
// ================================================================

describe("gate-failed 状态机", () => {
	it("filled → gate-failed 转移成功，写入 gateFailReason", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "残留【待补】占位符");
		expect(b.items[0]?.status).toBe("gate-failed");
		expect(b.items[0]?.gateFailReason).toBe("残留【待补】占位符");
	});

	it("gate-failed → queued 转移成功（重试），清除 gateFailReason", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "no-source-link");
		b = retryFromGateFailed(b, "item_0");
		expect(b.items[0]?.status).toBe("queued");
		expect(b.items[0]?.gateFailReason).toBeUndefined();
	});

	it("awaiting-approval → gate-failed 越级转移被拒（无此路径）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = presentForApproval(b);
		expect(b.items[0]?.status).toBe("awaiting-approval");
		// awaiting-approval 不在 markGateFailed 的 from=['filled']，无效
		const after = markGateFailed(b, "item_0", "should-not-happen");
		expect(after.items[0]?.status).toBe("awaiting-approval");
	});

	it("abortBatch 对 gate-failed 项生效 → aborted", () => {
		let b = newBatch(["a", "b"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "no-source-link");
		b = markGenerating(b, "item_1");
		b = markFilled(b, "item_1", draftFor("item_1"));
		b = presentForApproval(b);
		const killed = abortBatch(b);
		expect(killed.items[0]?.status).toBe("aborted"); // gate-failed → aborted
		expect(killed.items[1]?.status).toBe("aborted"); // awaiting-approval → aborted
	});

	it("batchPhase:gate-failed + awaiting-approval → awaiting-approval", () => {
		let b = newBatch(["a", "b"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "reason");
		b = markGenerating(b, "item_1");
		b = markFilled(b, "item_1", draftFor("item_1"));
		b = presentForApproval(b);
		expect(b.items[0]?.status).toBe("gate-failed");
		expect(b.items[1]?.status).toBe("awaiting-approval");
		expect(batchPhase(b)).toBe("awaiting-approval");
	});

	it("batchPhase:全部 gate-failed → awaiting-approval（非 done）", () => {
		let b = newBatch(["a", "b"]);
		for (const id of ["item_0", "item_1"]) {
			b = markGenerating(b, id);
			b = markFilled(b, id, draftFor(id));
			b = markGateFailed(b, id, "no-source-link");
		}
		expect(b.items.every((it) => it.status === "gate-failed")).toBe(true);
		expect(batchPhase(b)).toBe("awaiting-approval"); // 不是 done
	});

	it("recoverBatch 不影响 gate-failed 项（非崩溃态，无隔离）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "reason");
		const recovered = recoverBatch(b);
		// gate-failed 不是 publish-dispatched，recoverBatch 不动它
		expect(recovered.items[0]?.status).toBe("gate-failed");
	});

	it("gateFailReason 字段不干扰后续转移（retryFromGateFailed 后状态正常）", () => {
		let b = newBatch(["x"]);
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "residual-placeholder");
		b = retryFromGateFailed(b, "item_0");
		// 重回 queued 后可以正常走生成→填充→审批流程
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = presentForApproval(b);
		expect(b.items[0]?.status).toBe("awaiting-approval");
		expect(b.items[0]?.gateFailReason).toBeUndefined();
	});

	it("pendingTopicId 字段存入后不影响转移", () => {
		let b = newBatch(["x"]);
		// 模拟 handleRunBatch 写入 pendingTopicId
		b = { ...b, items: [{ ...b.items[0]!, pendingTopicId: "topic-uuid-123" }] };
		b = markGenerating(b, "item_0");
		b = markFilled(b, "item_0", draftFor("item_0"));
		b = markGateFailed(b, "item_0", "no-source-link");
		expect(b.items[0]?.status).toBe("gate-failed");
		expect(b.items[0]?.pendingTopicId).toBe("topic-uuid-123"); // 字段保留
	});
});
