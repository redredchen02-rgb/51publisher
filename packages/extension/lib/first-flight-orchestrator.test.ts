import type { ContentDraft } from "@51publisher/shared";
import { describe, expect, it, vi } from "vitest";
import type { Batch } from "./batch";
import {
	type FirstFlightIntent,
	type FirstFlightOrchestratorDeps,
	type RehearseResult,
	runFirstFlight,
} from "./first-flight-orchestrator";

const HOST = "dx-999-adm.ympxbys.xyz";

const DRAFT: ContentDraft = {
	id: "item_0",
	title: "T",
	subtitle: "S",
	category: "2",
	coverImageUrl: "",
	body: "<p>b</p>",
	tags: ["x"],
	description: "d",
	postStatus: "0",
	publishedAt: "2026-06-04",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-04T00:00:00.000Z",
};

const INTENT: FirstFlightIntent = {
	itemId: "item_0",
	tabId: 7,
	host: HOST,
	draft: DRAFT,
};

const GREEN: RehearseResult = {
	dryRunGreen: true,
	grounding: { ok: true, reasons: [] },
};

function batchWith(status: string, publishUrl?: string): Batch {
	return {
		id: "batch_1",
		tabId: 7,
		authorizedHost: HOST,
		createdAt: "2026-06-04T00:00:00.000Z",
		items: [
			{
				id: "item_0",
				topic: "t",
				status: status as never,
				draft: DRAFT,
				...(publishUrl ? { publishUrl } : {}),
			} as never,
		],
	} as Batch;
}

function makeDeps(
	overrides: Partial<FirstFlightOrchestratorDeps> = {},
): FirstFlightOrchestratorDeps {
	return {
		intent: INTENT,
		rehearse: vi.fn(async () => GREEN),
		arm: vi.fn(async () => ({ ok: true })),
		dispatchOne: vi.fn(async () =>
			batchWith("publish-confirmed", "https://x/p/1"),
		),
		revert: vi.fn(async () => {}),
		...overrides,
	};
}

describe("runFirstFlight", () => {
	it("happy:绿排演 → 武装 → 最小窗口派发成功 → 终态 dispatched,已 revert,带验证提示", async () => {
		const deps = makeDeps();
		const out = await runFirstFlight(deps);

		expect(out.ok).toBe(true);
		if (out.ok) {
			expect(out.phase).toBe("dispatched");
			expect(out.itemStatus).toBe("publish-confirmed");
			expect(out.publishUrl).toBe("https://x/p/1");
			expect(out.verifyPrompt).toBe(true);
			expect(out.reverted).toBe(true);
		}
		// 严格顺序:rehearse → arm → dispatchOne → revert(finally)。
		expect(deps.rehearse).toHaveBeenCalledTimes(1);
		expect(deps.arm).toHaveBeenCalledTimes(1);
		expect(deps.dispatchOne).toHaveBeenCalledTimes(1);
		expect(deps.revert).toHaveBeenCalledTimes(1);
	});

	it("排演未过(dry-run 不绿)→ 绝不武装/派发", async () => {
		const arm = vi.fn(async () => ({ ok: true }));
		const dispatchOne = vi.fn(async () => batchWith("publish-confirmed"));
		const deps = makeDeps({
			rehearse: vi.fn(async () => ({
				dryRunGreen: false,
				grounding: { ok: true, reasons: [] },
			})),
			arm,
			dispatchOne,
		});
		const out = await runFirstFlight(deps);

		expect(out.ok).toBe(false);
		expect(out.phase).toBe("rehearse");
		expect(arm).not.toHaveBeenCalled();
		expect(dispatchOne).not.toHaveBeenCalled();
	});

	it("排演未过(grounding 拦)→ 绝不武装,reason 透出拦截原因", async () => {
		const arm = vi.fn(async () => ({ ok: true }));
		const deps = makeDeps({
			rehearse: vi.fn(async () => ({
				dryRunGreen: true,
				grounding: { ok: false, reasons: ["标题仍含【待补】"] },
			})),
			arm,
		});
		const out = await runFirstFlight(deps);

		expect(out.ok).toBe(false);
		expect(out.phase).toBe("rehearse");
		if (!out.ok && out.phase === "rehearse")
			expect(out.reason).toContain("【待补】");
		expect(arm).not.toHaveBeenCalled();
	});

	it("武装失败(写失败/读回不符)→ reject arm,绝不派发", async () => {
		const dispatchOne = vi.fn(async () => batchWith("publish-confirmed"));
		const deps = makeDeps({
			arm: vi.fn(async () => ({
				ok: false,
				reason: "first-flight-write-failed",
			})),
			dispatchOne,
		});
		const out = await runFirstFlight(deps);

		expect(out.ok).toBe(false);
		expect(out.phase).toBe("arm");
		if (!out.ok && out.phase === "arm")
			expect(out.reason).toBe("first-flight-write-failed");
		expect(dispatchOne).not.toHaveBeenCalled();
	});

	it("派发失败 → 仍走 finally revert,返回 dispatched 终态(非 confirmed)", async () => {
		const revert = vi.fn(async () => {});
		const deps = makeDeps({
			dispatchOne: vi.fn(async () => batchWith("publish-failed")),
			revert,
		});
		const out = await runFirstFlight(deps);

		expect(out.ok).toBe(true);
		if (out.ok) {
			expect(out.itemStatus).toBe("publish-failed");
			expect(out.reverted).toBe(true);
		}
		expect(revert).toHaveBeenCalledTimes(1);
	});

	it("R7 only-one:dispatchOne 只被调一次(第二条无再排演不可达)", async () => {
		const deps = makeDeps();
		await runFirstFlight(deps);
		expect(deps.dispatchOne).toHaveBeenCalledTimes(1);
	});

	it("revert 在 finally 兜底:即便 dispatchOne 抛异常也 revert 并向上抛", async () => {
		const revert = vi.fn(async () => {});
		const deps = makeDeps({
			dispatchOne: vi.fn(async () => {
				throw new Error("boom");
			}),
			revert,
		});
		await expect(runFirstFlight(deps)).rejects.toThrow("boom");
		expect(revert).toHaveBeenCalledTimes(1);
	});

	it("revert 失败不污染成功结果(best-effort 吞错;reverted=false)", async () => {
		const deps = makeDeps({
			revert: vi.fn(async () => {
				throw new Error("revert-fail");
			}),
		});
		const out = await runFirstFlight(deps);
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.reverted).toBe(false);
	});

	it("排演未过时也兜底调一次 revert(应幂等)", async () => {
		const revert = vi.fn(async () => {});
		const deps = makeDeps({
			rehearse: vi.fn(async () => ({
				dryRunGreen: false,
				grounding: { ok: true, reasons: [] },
			})),
			revert,
		});
		await runFirstFlight(deps);
		expect(revert).toHaveBeenCalledTimes(1);
	});
});
