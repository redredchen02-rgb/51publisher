import type { ContentDraft } from "@51publisher/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { storage } from "#imports";
import {
	clearBatch,
	clearCurrentDraft,
	clearDryRunReport,
	clearTrajectory,
	getBatch,
	getCurrentDraft,
	getDryRunReport,
	getTrajectory,
	saveCurrentDraft,
	saveDryRunReport,
} from "./storage-draft";

const DRAFT: ContentDraft = {
	id: "d1",
	title: "测试",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>x</p>",
	tags: [],
	description: "",
	postStatus: "0",
	publishedAt: "",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-01T00:00:00.000Z",
};

describe("storage-draft", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	// ---- getCurrentDraft ----

	describe("getCurrentDraft", () => {
		it("missing → null", async () => {
			expect(await getCurrentDraft()).toBeNull();
		});

		it("round-trip", async () => {
			await saveCurrentDraft(DRAFT);
			const got = await getCurrentDraft();
			expect(got?.title).toBe("测试");
		});

		it("clearCurrentDraft → null", async () => {
			await saveCurrentDraft(DRAFT);
			await clearCurrentDraft();
			expect(await getCurrentDraft()).toBeNull();
		});
	});

	// ---- getBatch ----

	describe("getBatch", () => {
		it("missing → null", async () => {
			expect(await getBatch()).toBeNull();
		});

		it("stored null → null", async () => {
			await storage.setItem("local:batch", null);
			expect(await getBatch()).toBeNull();
		});

		it("stored object without items array → null (fail-closed)", async () => {
			await storage.setItem("local:batch", {
				id: "b1",
				tabId: 1,
				items: "bad",
			});
			expect(await getBatch()).toBeNull();
		});

		it("stored with items not array → null", async () => {
			await storage.setItem("local:batch", { id: "b1", tabId: 1, items: null });
			expect(await getBatch()).toBeNull();
		});

		it("valid batch → recoverBatch result (non-null)", async () => {
			await storage.setItem("local:batch", {
				id: "b1",
				tabId: 1,
				authorizedHost: "h",
				createdAt: "",
				items: [],
			});
			const result = await getBatch();
			expect(result).not.toBeNull();
			expect(result?.id).toBe("b1");
		});

		it("clearBatch → null", async () => {
			await storage.setItem("local:batch", {
				id: "b1",
				tabId: 1,
				authorizedHost: "h",
				createdAt: "",
				items: [],
			});
			await clearBatch();
			expect(await getBatch()).toBeNull();
		});
	});

	// ---- getTrajectory ----

	describe("getTrajectory", () => {
		it("missing → []", async () => {
			expect(await getTrajectory()).toEqual([]);
		});

		it("non-array stored → []", async () => {
			await storage.setItem("local:trajectory", "bad");
			expect(await getTrajectory()).toEqual([]);
		});

		it("clearTrajectory → []", async () => {
			await storage.setItem("local:trajectory", [{ id: "r1" }]);
			await clearTrajectory();
			expect(await getTrajectory()).toEqual([]);
		});
	});

	// ---- getDryRunReport ----

	describe("getDryRunReport", () => {
		it("missing → null", async () => {
			expect(await getDryRunReport()).toBeNull();
		});

		it("null stored → null", async () => {
			await storage.setItem("local:dryRunReport", null);
			expect(await getDryRunReport()).toBeNull();
		});

		it("primitive stored → null (fail-closed)", async () => {
			await storage.setItem("local:dryRunReport", 42);
			expect(await getDryRunReport()).toBeNull();
		});

		it("string stored → null", async () => {
			await storage.setItem("local:dryRunReport", "bad");
			expect(await getDryRunReport()).toBeNull();
		});

		it("object missing batchId → null", async () => {
			await storage.setItem("local:dryRunReport", { items: [] });
			expect(await getDryRunReport()).toBeNull();
		});

		it("object missing items → null", async () => {
			await storage.setItem("local:dryRunReport", { batchId: "b1" });
			expect(await getDryRunReport()).toBeNull();
		});

		it("object with non-array items → null", async () => {
			await storage.setItem("local:dryRunReport", {
				batchId: "b1",
				items: "bad",
			});
			expect(await getDryRunReport()).toBeNull();
		});

		it("valid report → returned", async () => {
			const report = { batchId: "b1", items: [{ id: "i1", ok: true }] };
			await storage.setItem("local:dryRunReport", report);
			const got = await getDryRunReport();
			expect(got).not.toBeNull();
			expect((got as unknown as Record<string, unknown>).batchId).toBe("b1");
		});

		it("saveDryRunReport + getDryRunReport round-trip", async () => {
			const report = {
				batchId: "b2",
				items: [],
				ts: new Date().toISOString(),
			} as Parameters<typeof saveDryRunReport>[0];
			await saveDryRunReport(report);
			const got = await getDryRunReport();
			expect((got as unknown as Record<string, unknown>)?.batchId).toBe("b2");
		});

		it("clearDryRunReport → null", async () => {
			await storage.setItem("local:dryRunReport", { batchId: "b1", items: [] });
			await clearDryRunReport();
			expect(await getDryRunReport()).toBeNull();
		});
	});
});
