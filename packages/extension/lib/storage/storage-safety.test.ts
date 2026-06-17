import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { storage } from "#imports";
import {
	addPublishedTopics,
	clearAllFillTombstones,
	clearFillTombstone,
	clearPendingQuarantineAlert,
	getAuthorizedHosts,
	getFillTombstones,
	getPendingQuarantineAlert,
	getPublishedTopics,
	getSafetyMode,
	setAuthorizedHosts,
	setSafetyMode,
	writeFillTombstone,
} from "./storage-safety";

describe("storage-safety", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	// ---- getSafetyMode ----

	describe("getSafetyMode", () => {
		it("missing → default 'off'", async () => {
			expect(await getSafetyMode()).toBe("off");
		});

		it("stored 'authorized' → 'authorized'", async () => {
			await storage.setItem("local:safetyMode", "authorized");
			expect(await getSafetyMode()).toBe("authorized");
		});

		it("stored 'dry-run' → 'dry-run'", async () => {
			await storage.setItem("local:safetyMode", "dry-run");
			expect(await getSafetyMode()).toBe("dry-run");
		});

		it("stored 'off' → 'off'", async () => {
			await storage.setItem("local:safetyMode", "off");
			expect(await getSafetyMode()).toBe("off");
		});

		it("invalid string → 'off' (fail-closed)", async () => {
			await storage.setItem("local:safetyMode", "admin");
			expect(await getSafetyMode()).toBe("off");
		});

		it("number stored → 'off'", async () => {
			await storage.setItem("local:safetyMode", 1);
			expect(await getSafetyMode()).toBe("off");
		});
	});

	describe("setSafetyMode + getSafetyMode", () => {
		it("round-trips authorized", async () => {
			await setSafetyMode("authorized");
			expect(await getSafetyMode()).toBe("authorized");
		});
	});

	// ---- getAuthorizedHosts ----

	describe("getAuthorizedHosts", () => {
		it("never-set → returns seed hosts", async () => {
			const hosts = await getAuthorizedHosts();
			expect(hosts.length).toBeGreaterThan(0);
			expect(hosts[0]).toContain(".");
		});

		it("stored null → returns seed hosts", async () => {
			await storage.setItem("local:authorizedHosts", null);
			const hosts = await getAuthorizedHosts();
			expect(hosts.length).toBeGreaterThan(0);
		});

		it("non-array stored → [] (fail-closed)", async () => {
			await storage.setItem("local:authorizedHosts", "not-array");
			expect(await getAuthorizedHosts()).toEqual([]);
		});

		it("array with non-string items → filtered out", async () => {
			await storage.setItem("local:authorizedHosts", [
				"valid.host",
				42,
				null,
				"",
			]);
			const hosts = await getAuthorizedHosts();
			expect(hosts).toEqual(["valid.host"]);
		});

		it("valid array → returned as-is", async () => {
			await setAuthorizedHosts(["a.com", "b.org"]);
			expect(await getAuthorizedHosts()).toEqual(["a.com", "b.org"]);
		});

		it("whitespace-only string → filtered out", async () => {
			await storage.setItem("local:authorizedHosts", ["   ", "ok.com"]);
			expect(await getAuthorizedHosts()).toEqual(["ok.com"]);
		});
	});

	// ---- getPublishedTopics ----

	describe("getPublishedTopics", () => {
		it("missing → []", async () => {
			expect(await getPublishedTopics()).toEqual([]);
		});

		it("non-array → []", async () => {
			await storage.setItem("local:publishedTopics", "bad");
			expect(await getPublishedTopics()).toEqual([]);
		});

		it("array with non-strings → filtered", async () => {
			await storage.setItem("local:publishedTopics", ["topic-a", 42, null]);
			expect(await getPublishedTopics()).toEqual(["topic-a"]);
		});

		it("valid array → returned", async () => {
			await storage.setItem("local:publishedTopics", ["a", "b"]);
			expect(await getPublishedTopics()).toEqual(["a", "b"]);
		});
	});

	// ---- addPublishedTopics ----

	describe("addPublishedTopics", () => {
		it("empty topics → no-op", async () => {
			await addPublishedTopics([]);
			expect(await getPublishedTopics()).toEqual([]);
		});

		it("adds new topics", async () => {
			await addPublishedTopics(["t1", "t2"]);
			expect(await getPublishedTopics()).toEqual(["t1", "t2"]);
		});

		it("deduplicates", async () => {
			await addPublishedTopics(["t1"]);
			await addPublishedTopics(["t1", "t2"]);
			expect(await getPublishedTopics()).toEqual(["t1", "t2"]);
		});

		it("prunes to max 1000 keeping newest", async () => {
			const existing = Array.from({ length: 999 }, (_, i) => `old-${i}`);
			await storage.setItem("local:publishedTopics", existing);
			await addPublishedTopics(["new-1", "new-2"]);
			const result = await getPublishedTopics();
			expect(result.length).toBe(1000);
			expect(result).toContain("new-1");
			expect(result).toContain("new-2");
			expect(result).not.toContain("old-0"); // oldest pruned
		});
	});

	// ---- getFillTombstones ----

	describe("getFillTombstones", () => {
		it("missing → {}", async () => {
			expect(await getFillTombstones()).toEqual({});
		});

		it("array (not object) → {}", async () => {
			await storage.setItem("local:fillTombstones", ["not", "obj"]);
			expect(await getFillTombstones()).toEqual({});
		});

		it("null → {}", async () => {
			await storage.setItem("local:fillTombstones", null);
			expect(await getFillTombstones()).toEqual({});
		});

		it("valid object → returned", async () => {
			const map = { item_0: { tabId: 1, ts: "2026-01-01" } };
			await storage.setItem("local:fillTombstones", map);
			expect(await getFillTombstones()).toEqual(map);
		});
	});

	describe("writeFillTombstone / clearFillTombstone / clearAllFillTombstones", () => {
		it("write then clear single → removed", async () => {
			await writeFillTombstone("item_0", { tabId: 1, ts: "t" });
			await writeFillTombstone("item_1", { tabId: 2, ts: "t2" });
			await clearFillTombstone("item_0");
			const result = await getFillTombstones();
			expect(result["item_0"]).toBeUndefined();
			expect(result["item_1"]).toBeDefined();
		});

		it("clearAll → empty object", async () => {
			await writeFillTombstone("item_0", { tabId: 1, ts: "t" });
			await clearAllFillTombstones();
			expect(await getFillTombstones()).toEqual({});
		});
	});

	// ---- getPendingQuarantineAlert ----

	describe("getPendingQuarantineAlert", () => {
		it("missing → 0", async () => {
			expect(await getPendingQuarantineAlert()).toBe(0);
		});

		it("string → 0", async () => {
			await storage.setItem("local:pendingQuarantineAlert", "bad");
			expect(await getPendingQuarantineAlert()).toBe(0);
		});

		it("negative number → 0", async () => {
			await storage.setItem("local:pendingQuarantineAlert", -5);
			expect(await getPendingQuarantineAlert()).toBe(0);
		});

		it("zero → 0", async () => {
			await storage.setItem("local:pendingQuarantineAlert", 0);
			expect(await getPendingQuarantineAlert()).toBe(0);
		});

		it("positive number → returned", async () => {
			await storage.setItem("local:pendingQuarantineAlert", 3);
			expect(await getPendingQuarantineAlert()).toBe(3);
		});

		it("clearPendingQuarantineAlert → 0", async () => {
			await storage.setItem("local:pendingQuarantineAlert", 5);
			await clearPendingQuarantineAlert();
			expect(await getPendingQuarantineAlert()).toBe(0);
		});
	});
});
