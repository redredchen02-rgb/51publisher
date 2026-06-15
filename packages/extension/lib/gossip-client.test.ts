import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { getToken, setToken } from "./auth-client";
import {
	createGossipSite,
	deleteGossipSite,
	discoverGossipSite,
	fetchGossipSites,
	fetchGossipTopicFromUrl,
} from "./gossip-client";

interface MockResult {
	capturedUrls: string[];
	capturedInits: (RequestInit | undefined)[];
	fn: typeof fetch;
}

function mockFetch(body: unknown, status = 200): MockResult {
	const capturedUrls: string[] = [];
	const capturedInits: (RequestInit | undefined)[] = [];
	const fn = async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrls.push(String(url));
		capturedInits.push(init);
		return new Response(JSON.stringify(body), { status });
	};
	return { capturedUrls, capturedInits, fn: fn as unknown as typeof fetch };
}

function authHeader(init: RequestInit | undefined): string | undefined {
	const h = init?.headers as Record<string, string> | undefined;
	return h?.Authorization;
}

const SITE = {
	id: "s1",
	name: "site",
	listUrl: "https://x.test/list",
	enabled: true,
	createdAt: "a",
	updatedAt: "b",
};

describe("gossip-client — fetchGossipSites", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 sites，URL + Bearer 正确", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			sites: [SITE],
		});
		const result = await fetchGossipSites(fn);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("s1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-g");
	});

	it("Edge: ok:true 无 sites → 空数组", async () => {
		const { fn } = mockFetch({ ok: true });
		expect(await fetchGossipSites(fn)).toEqual([]);
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(fetchGossipSites(fn)).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出后端 error 消息（不静默吞）", async () => {
		const { fn } = mockFetch({ error: "boom" }, 500);
		await expect(fetchGossipSites(fn)).rejects.toThrow("boom");
	});

	it("Integration: 注入的 fetchFn 确实被调用", async () => {
		const fn = vi.fn(
			async () => new Response(JSON.stringify({ ok: true, sites: [] })),
		);
		await fetchGossipSites(fn as unknown as typeof fetch);
		expect(fn).toHaveBeenCalledOnce();
	});
});

describe("gossip-client — createGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 site，POST 命中 URL", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			site: SITE,
		});
		const result = await createGossipSite("site", "https://x.test/list", fn);
		expect(result?.id).toBe("s1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites");
		expect(capturedInits[0]?.method).toBe("POST");
	});

	it("Error 401 → clearToken()，返回 null", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await createGossipSite("n", "u", fn);
		expect(result).toBeNull();
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出错误", async () => {
		const { fn } = mockFetch({ error: "bad" }, 500);
		await expect(createGossipSite("n", "u", fn)).rejects.toThrow("bad");
	});
});

describe("gossip-client — deleteGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → DELETE 命中 URL，无抛", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		await expect(deleteGossipSite("s1", fn)).resolves.toBeUndefined();
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites/s1");
		expect(capturedInits[0]?.method).toBe("DELETE");
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(deleteGossipSite("s1", fn)).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});
});

describe("gossip-client — discoverGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 discovered 数组", async () => {
		const { capturedUrls, fn } = mockFetch({
			ok: true,
			discovered: [{ url: "https://x.test/1" }],
		});
		const result = await discoverGossipSite("s1", fn);
		expect(result).toHaveLength(1);
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites/s1/discover");
	});

	it("Error 401 → clearToken()，返回空数组", async () => {
		const { fn } = mockFetch({}, 401);
		expect(await discoverGossipSite("s1", fn)).toEqual([]);
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出错误", async () => {
		const { fn } = mockFetch({ error: "x" }, 500);
		await expect(discoverGossipSite("s1", fn)).rejects.toThrow("x");
	});
});

describe("gossip-client — fetchGossipTopicFromUrl", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 topic", async () => {
		const { capturedUrls, fn } = mockFetch({
			ok: true,
			topic: { id: "t1", title: "T" },
		});
		const result = await fetchGossipTopicFromUrl(
			"https://x.test/1",
			"site",
			fn,
		);
		expect(result.id).toBe("t1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/topics/from-url");
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});

	it("Error 409 → 抛 DUPLICATE_URL", async () => {
		const { fn } = mockFetch({}, 409);
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("DUPLICATE_URL");
	});

	it("Edge: ok:true 无 topic → 抛 Empty response", async () => {
		const { fn } = mockFetch({ ok: true });
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("Empty response");
	});
});
