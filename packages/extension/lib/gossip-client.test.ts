import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { isAuthenticated, setToken } from "./auth-client";
import {
	createGossipSite,
	deleteGossipSite,
	discoverGossipSite,
	fetchGossipSites,
	fetchGossipTopicFromUrl,
} from "./gossip-client";

// Characterization test: locks in current behavior before/after the apiFetch
// migration. The 401 handling differs per method (throw vs return null vs
// return []) and must survive the refactor unchanged.

function stubFetch(body: unknown, status = 200): { calls: RequestInit[] } {
	const calls: RequestInit[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			calls.push(init ?? {});
			return new Response(JSON.stringify(body), { status });
		}),
	);
	return { calls };
}

describe("gossip-client (characterization)", () => {
	beforeEach(() => fakeBrowser.reset());
	afterEach(() => vi.unstubAllGlobals());

	it("fetchGossipSites: 注入 Authorization 头并解析 sites", async () => {
		await setToken("tok");
		const { calls } = stubFetch({ ok: true, sites: [{ id: "s1" }] });
		const sites = await fetchGossipSites();
		expect(sites).toHaveLength(1);
		expect(
			(calls[0]?.headers as Record<string, string>).Authorization,
		).toBe("Bearer tok");
	});

	it("fetchGossipSites: 401 → 抛 Unauthorized 且清 token", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		await expect(fetchGossipSites()).rejects.toThrow("Unauthorized");
		expect(await isAuthenticated()).toBe(false);
	});

	it("createGossipSite: 401 → 返回 null(不抛)", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		expect(await createGossipSite("n", "https://x/")).toBeNull();
	});

	it("createGossipSite: happy → 返回 site", async () => {
		stubFetch({ ok: true, site: { id: "s2" } });
		const site = await createGossipSite("n", "https://x/");
		expect(site?.id).toBe("s2");
	});

	it("discoverGossipSite: 401 → 返回 [](不抛)", async () => {
		await setToken("tok");
		stubFetch({}, 401);
		expect(await discoverGossipSite("s1")).toEqual([]);
	});

	it("deleteGossipSite: 401 → 抛 Unauthorized", async () => {
		stubFetch({}, 401);
		await expect(deleteGossipSite("s1")).rejects.toThrow("Unauthorized");
	});

	it("fetchGossipTopicFromUrl: 409 → 抛 DUPLICATE_URL", async () => {
		stubFetch({}, 409);
		await expect(
			fetchGossipTopicFromUrl("https://x/", "site"),
		).rejects.toThrow("DUPLICATE_URL");
	});
});
