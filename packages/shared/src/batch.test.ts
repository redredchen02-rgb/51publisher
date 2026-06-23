import { describe, expect, it } from "vitest";
import type { Batch, BatchItem } from "./batch.js";
import { isTerminal, recoverBatch, TERMINAL } from "./batch.js";

function makeItem(status: BatchItem["status"]): BatchItem {
	return { id: "i1", topic: "test", status };
}

function makeBatch(items: BatchItem[]): Batch {
	return {
		id: "b1",
		tabId: 1,
		authorizedHost: "https://example.com",
		items,
		createdAt: "2026-01-01T00:00:00Z",
	};
}

describe("TERMINAL", () => {
	it("包含四个终止状态", () => {
		expect(TERMINAL.has("publish-confirmed")).toBe(true);
		expect(TERMINAL.has("aborted")).toBe(true);
		expect(TERMINAL.has("error")).toBe(true);
		expect(TERMINAL.has("needs-human-verification")).toBe(true);
	});

	it("不含中间状态", () => {
		expect(TERMINAL.has("queued")).toBe(false);
		expect(TERMINAL.has("generating")).toBe(false);
		expect(TERMINAL.has("filled")).toBe(false);
		expect(TERMINAL.has("gate-failed")).toBe(false);
		expect(TERMINAL.has("awaiting-approval")).toBe(false);
		expect(TERMINAL.has("publish-dispatched")).toBe(false);
	});
});

describe("isTerminal", () => {
	it.each([
		"publish-confirmed",
		"aborted",
		"error",
		"needs-human-verification",
	] as const)("%s → true", (s) => expect(isTerminal(s)).toBe(true));

	it.each([
		"queued",
		"generating",
		"filled",
		"gate-failed",
		"awaiting-approval",
		"publish-dispatched",
	] as const)("%s → false", (s) => expect(isTerminal(s)).toBe(false));
});

describe("recoverBatch", () => {
	it("不含 publish-dispatched 条目时原样返回", () => {
		const batch = makeBatch([makeItem("filled"), makeItem("queued")]);
		const result = recoverBatch(batch);
		expect(result.items[0].status).toBe("filled");
		expect(result.items[1].status).toBe("queued");
	});

	it("publish-dispatched → needs-human-verification", () => {
		const batch = makeBatch([makeItem("publish-dispatched")]);
		const result = recoverBatch(batch);
		expect(result.items[0].status).toBe("needs-human-verification");
	});

	it("recovered 条目带 error 原因", () => {
		const batch = makeBatch([makeItem("publish-dispatched")]);
		const result = recoverBatch(batch);
		expect(result.items[0].error).toBe("recovered-dispatched-no-confirm");
	});

	it("只影响 publish-dispatched，其余不变", () => {
		const batch = makeBatch([
			makeItem("publish-dispatched"),
			makeItem("filled"),
			makeItem("publish-dispatched"),
		]);
		const result = recoverBatch(batch);
		expect(result.items[0].status).toBe("needs-human-verification");
		expect(result.items[1].status).toBe("filled");
		expect(result.items[2].status).toBe("needs-human-verification");
	});

	it("不修改原始 batch（immutable）", () => {
		const batch = makeBatch([makeItem("publish-dispatched")]);
		recoverBatch(batch);
		expect(batch.items[0].status).toBe("publish-dispatched");
	});

	it("保留 batch 元数据", () => {
		const batch = makeBatch([makeItem("queued")]);
		const result = recoverBatch(batch);
		expect(result.id).toBe("b1");
		expect(result.authorizedHost).toBe("https://example.com");
	});
});
