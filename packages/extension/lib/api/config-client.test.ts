import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
import { fetchRemoteMappings } from "./config-client";

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
