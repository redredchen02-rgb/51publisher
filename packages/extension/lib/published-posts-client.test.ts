import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { recordPublishedPost } from "./published-posts-client";
import { DEFAULT_SETTINGS, saveBackendToken, saveSettings } from "./storage";

const BASE_RECORD = {
	id: "r1",
	batchItemId: "item_0",
	sourceTitle: "测试选题",
	publishUrl: "https://example.com/post/1",
	publishedAt: "2026-06-11T00:00:00.000Z",
};

describe("recordPublishedPost", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("backendUrl 未配置 → 不调用 fetch", async () => {
		// 默认 settings 无 backendUrl
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await recordPublishedPost(BASE_RECORD);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("backendUrl 配置但 token 为空 → 不调用 fetch", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			backendUrl: "http://localhost:3001",
		});
		// 不存 token → getBackendToken 返回 ''
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		await recordPublishedPost(BASE_RECORD);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("backendUrl + token 均存在 → 以正确 URL + headers 调用 fetch", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			backendUrl: "http://localhost:3001",
		});
		await saveBackendToken("jwt-test-token");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("", { status: 200 }));
		await recordPublishedPost(BASE_RECORD);
		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url, init] = fetchSpy.mock.calls[0]!;
		expect(url).toBe("http://localhost:3001/api/v1/published-posts");
		expect((init as RequestInit).method).toBe("POST");
		expect((init as RequestInit).headers).toMatchObject({
			"Content-Type": "application/json",
			Authorization: "Bearer jwt-test-token",
		});
	});

	it("fetch body 正确序列化字段(snake_case)", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			backendUrl: "http://localhost:3001",
		});
		await saveBackendToken("tok");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("", { status: 200 }));
		await recordPublishedPost({
			...BASE_RECORD,
			outcome: "publish-confirmed",
			publishUrlSource: "from_save",
		});
		const body = JSON.parse(
			(fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
		);
		expect(body.id).toBe("r1");
		expect(body.batch_item_id).toBe("item_0");
		expect(body.source_title).toBe("测试选题");
		expect(body.publish_url).toBe("https://example.com/post/1");
		expect(body.publish_url_source).toBe("from_save");
		expect(body.outcome).toBe("publish-confirmed");
	});

	it("publishUrl 缺失 → body publish_url 为 null", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			backendUrl: "http://localhost:3001",
		});
		await saveBackendToken("tok");
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response("", { status: 200 }));
		await recordPublishedPost({
			id: "r2",
			batchItemId: "item_1",
			sourceTitle: "x",
			publishedAt: "2026-06-11T00:00:00.000Z",
		});
		const body = JSON.parse(
			(fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
		);
		expect(body.publish_url).toBeNull();
		expect(body.publish_url_source).toBe("not_available");
	});

	it("fetch 抛出错误 → 静默吞噬,不抛出", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			backendUrl: "http://localhost:3001",
		});
		await saveBackendToken("tok");
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
		await expect(recordPublishedPost(BASE_RECORD)).resolves.toBeUndefined();
	});
});
