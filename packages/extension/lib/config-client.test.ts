import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
import {
	createRemoteBatch,
	fetchBatchState,
	fetchRemoteMappings,
	syncBatchItemStatus,
} from "./config-client";

describe("config-client — fetchRemoteMappings", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx + ok → 返回远程映射并标记 remote，URL + Bearer 正确", async () => {
		const remoteMappings = { ...DEFAULT_FIELD_MAPPING };
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			mappings: remoteMappings,
			version: 7,
		});
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(true);
		expect(result.mappings).toEqual(remoteMappings);
		expect(capturedUrls[0]).toContain("/api/v1/config/mappings");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-123");
	});

	it("Error 401 → clearToken() 被调用、回落默认映射", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(false);
		expect(result.mappings).toEqual(DEFAULT_FIELD_MAPPING);
		expect(await getToken()).toBeNull();
	});

	it("Error 非 2xx (500) → 回落默认映射，不抛", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(false);
		expect(result.mappings).toEqual(DEFAULT_FIELD_MAPPING);
	});

	it("Error 网络异常 → 回落默认映射，不抛", async () => {
		const fn = (async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(false);
		expect(result.mappings).toEqual(DEFAULT_FIELD_MAPPING);
	});

	it("AbortError (超时) → 回落默认映射，不抛", async () => {
		const fn = (async () => {
			const e = new Error("aborted");
			e.name = "AbortError";
			throw e;
		}) as unknown as typeof fetch;
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(false);
		expect(result.mappings).toEqual(DEFAULT_FIELD_MAPPING);
	});

	it("Edge: ok:true 但 mappings 缺失 → 回落默认映射", async () => {
		const { fn } = mockFetch({ ok: true });
		const result = await fetchRemoteMappings(fn);
		expect(result.remote).toBe(false);
	});
});

describe("config-client — syncBatchItemStatus", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true，PATCH 命中 batch item URL + Bearer", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await syncBatchItemStatus(
			"b1",
			"i1",
			{ status: "done" },
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/batches/b1/items/i1");
		expect(capturedInits[0]?.method).toBe("PATCH");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-123");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await syncBatchItemStatus("b1", "i1", {}, fn);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → ok:false 带 HTTP 状态，不静默", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await syncBatchItemStatus("b1", "i1", {}, fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});

	it("catch: 非 Error 抛出值 → String() 转换", async () => {
		const fn = vi.fn(async () => {
			throw "string-error";
		});
		const result = await syncBatchItemStatus(
			"b1",
			"i1",
			{},
			fn as unknown as typeof fetch,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("string-error");
	});
});

describe("config-client — fetchBatchState", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true 含 batch", async () => {
		const { capturedUrls, fn } = mockFetch({ batch: { id: "b1" } });
		const result = await fetchBatchState("b1", fn);
		expect(result.ok).toBe(true);
		expect(result.batch).toEqual({ id: "b1" });
		expect(capturedUrls[0]).toContain("/api/v1/batches/b1");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await fetchBatchState("b1", fn);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});

	it("网络异常 → ok:false 含错误信息", async () => {
		const fn = vi.fn(async () => {
			throw new Error("network down");
		});
		const result = await fetchBatchState("b1", fn as unknown as typeof fetch);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("network down");
	});

	it("Error 500 → ok:false 含 HTTP 状态", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await fetchBatchState("b1", fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});
});

describe("config-client — createRemoteBatch", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true，POST 命中 /batches", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/batches");
		expect(capturedInits[0]?.method).toBe("POST");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn,
		);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → ok:false 含 HTTP 状态", async () => {
		const { fn } = mockFetch({ message: "server error" }, 500);
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});

	it("网络异常 → ok:false 含错误信息", async () => {
		const fn = vi.fn(async () => {
			throw new Error("timeout");
		});
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn as unknown as typeof fetch,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("timeout");
	});

	it("Error 500: res.text() throws → 兜底空字符串，error 仍含 HTTP 状态", async () => {
		const fn = vi.fn(
			async () =>
				({
					ok: false,
					status: 500,
					text: async () => {
						throw new Error("body unreadable");
					},
				}) as unknown as Response,
		);
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn as unknown as typeof fetch,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});

	it("Integration: 注入的 fetchFn 确实被调用", async () => {
		const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn as unknown as typeof fetch,
		);
		expect(fn).toHaveBeenCalledOnce();
	});
});
