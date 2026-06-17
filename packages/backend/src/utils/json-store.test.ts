import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "./json-store.js";

interface Item {
	id: string;
	name: string;
	updatedAt?: string;
}

let tmpDir: string;
let store: JsonFileStore<Item>;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "json-store-test-"));
	store = new JsonFileStore<Item>({ dirPath: tmpDir });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("JsonFileStore.read", () => {
	it("returns null for non-existent id", async () => {
		expect(await store.read("missing")).toBeNull();
	});

	it("returns written item", async () => {
		await store.write({ id: "a1", name: "魔法少女" });
		const item = await store.read("a1");
		expect(item?.name).toBe("魔法少女");
	});
});

describe("JsonFileStore.write", () => {
	it("creates directory if absent", async () => {
		const nestedDir = join(tmpDir, "nested", "deep");
		const nestedStore = new JsonFileStore<Item>({ dirPath: nestedDir });
		await nestedStore.write({ id: "x", name: "test" });
		expect(await nestedStore.read("x")).not.toBeNull();
	});

	it("sets updatedAt timestamp on write", async () => {
		const before = new Date().toISOString();
		await store.write({ id: "ts", name: "時間戳" });
		const item = await store.read("ts");
		expect(item?.updatedAt).toBeDefined();
		expect(item!.updatedAt! >= before).toBe(true);
	});

	it("uses custom updatedAtKey when specified", async () => {
		interface WithCustomTs {
			id: string;
			val: string;
			savedAt?: string;
		}
		const s = new JsonFileStore<WithCustomTs>({
			dirPath: tmpDir,
			updatedAtKey: "savedAt",
		});
		await s.write({ id: "cts", val: "v" });
		const item = await s.read("cts");
		expect(item?.savedAt).toBeDefined();
	});

	it("overwrites existing item", async () => {
		await store.write({ id: "ow", name: "初稿" });
		await store.write({ id: "ow", name: "更新版" });
		const item = await store.read("ow");
		expect(item?.name).toBe("更新版");
	});

	it("sanitizes special chars in id to underscores", async () => {
		await store.write({ id: "a/b:c?d", name: "特殊ID" });
		const item = await store.read("a/b:c?d");
		expect(item?.name).toBe("特殊ID");
	});
});

describe("JsonFileStore.delete", () => {
	it("returns false when item does not exist", async () => {
		expect(await store.delete("ghost")).toBe(false);
	});

	it("returns true and removes item", async () => {
		await store.write({ id: "del", name: "待刪" });
		expect(await store.delete("del")).toBe(true);
		expect(await store.read("del")).toBeNull();
	});
});

describe("JsonFileStore.list", () => {
	it("returns empty array when dir is empty", async () => {
		expect(await store.list()).toEqual([]);
	});

	it("returns all written items", async () => {
		await store.write({ id: "x1", name: "甲" });
		await store.write({ id: "x2", name: "乙" });
		const items = await store.list();
		expect(items).toHaveLength(2);
		const names = items.map((i) => i.name).sort();
		expect(names).toEqual(["乙", "甲"]);
	});

	it("respects limit option", async () => {
		for (let i = 0; i < 5; i++) {
			await store.write({ id: `item${i}`, name: `項目${i}` });
		}
		const items = await store.list({ limit: 3 });
		expect(items).toHaveLength(3);
	});
});
