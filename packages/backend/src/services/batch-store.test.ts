import type { Batch } from "@51guapi/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, initPendingDb, resetPendingDb } from "../scraper/pending-db.js";
import { listBatches, loadBatch, saveBatch } from "./batch-store.js";

// DB_PATH is fixed by test-setup.ts (PUBLISHER_DATA_DIR injected before import).
// We can't change it per-test, so we wipe the batches table between tests instead.
beforeEach(() => {
	initPendingDb();
	getDb().prepare("DELETE FROM batches").run();
});

afterEach(() => {
	resetPendingDb();
});

function makeBatch(id: string): Batch {
	return {
		id,
		tabId: 1,
		authorizedHost: "https://dx-999-adm.ympxbys.xyz",
		items: [
			{
				id: `${id}-item-1`,
				topic: "魔法少女",
				status: "queued",
			},
		],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

describe("loadBatch", () => {
	it("returns null for non-existent batch", async () => {
		expect(await loadBatch("ghost")).toBeNull();
	});

	it("returns batch after save", async () => {
		const batch = makeBatch("b1");
		await saveBatch(batch);
		const loaded = await loadBatch("b1");
		expect(loaded?.id).toBe("b1");
		expect(loaded?.authorizedHost).toBe(batch.authorizedHost);
	});
});

describe("saveBatch", () => {
	it("persists items array", async () => {
		const batch = makeBatch("b2");
		await saveBatch(batch);
		const loaded = await loadBatch("b2");
		expect(loaded?.items).toHaveLength(1);
		expect(loaded?.items[0].topic).toBe("魔法少女");
	});

	it("upserts on duplicate id", async () => {
		const batch = makeBatch("b3");
		await saveBatch(batch);
		const updated: Batch = {
			...batch,
			items: [{ ...batch.items[0], status: "aborted" }],
		};
		await saveBatch(updated);
		const loaded = await loadBatch("b3");
		expect(loaded?.items[0].status).toBe("aborted");
	});
});

describe("listBatches", () => {
	it("returns empty array when no batches", async () => {
		expect(await listBatches()).toEqual([]);
	});

	it("returns all saved batches", async () => {
		await saveBatch(makeBatch("ba"));
		await saveBatch(makeBatch("bb"));
		const list = await listBatches();
		expect(list).toHaveLength(2);
	});

	it("respects limit parameter", async () => {
		for (let i = 0; i < 5; i++) {
			await saveBatch(makeBatch(`bl${i}`));
		}
		const list = await listBatches(3);
		expect(list).toHaveLength(3);
	});
});
