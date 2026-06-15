import { describe, expect, it, vi } from "vitest";
import { fetchContent, fetchList } from "./generic-adapter.js";

// Mock safeFetch
vi.mock("../ssrf-guard.js", () => ({
	safeFetch: vi.fn(),
}));

import { safeFetch } from "../ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);

function makeResponse(
	body: string,
	status = 200,
	contentLength?: number,
): Response {
	const headers = new Headers();
	if (contentLength !== undefined)
		headers.set("content-length", String(contentLength));
	return {
		ok: status >= 200 && status < 300,
		status,
		headers,
		text: async () => body,
		body: null,
	} as unknown as Response;
}

const LIST_HTML = `
<html><body>
  <a href="/gossip/12345">明星出軌事件</a>
  <a href="/gossip/67890.html">藝人解約風波</a>
  <a href="/news/2024/08/breaking">日期型路徑</a>
  <a href="https://other.com/gossip/111">外站連結</a>
  <a href="/about">關於我們</a>
  <a href="/gossip/12345">重複連結</a>
</body></html>
`;

const ARTICLE_HTML = `
<html>
<head>
  <meta property="og:title" content="明星A出軌B事件始末" />
  <meta property="og:description" content="明星A被拍到與B私會，前任C發文暗諷" />
  <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
  <meta property="article:published_time" content="2024-08-15" />
</head>
<body><h1>明星A出軌B事件始末</h1></body>
</html>
`;

describe("generic-adapter.fetchList", () => {
	it("正確過濾詳情頁 URL，帶 anchor text", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(LIST_HTML));
		const results = await fetchList("https://example.com/latest");
		expect(results.map((r) => r.url)).toContain(
			"https://example.com/gossip/12345",
		);
		expect(results.map((r) => r.url)).toContain(
			"https://example.com/gossip/67890.html",
		);
		// 外站不應出現
		expect(results.map((r) => r.url)).not.toContain(
			"https://other.com/gossip/111",
		);
		// /about 不符 detail path
		expect(results.map((r) => r.url)).not.toContain(
			"https://example.com/about",
		);
		// 重複 URL 只出現一次
		expect(
			results.filter((r) => r.url === "https://example.com/gossip/12345"),
		).toHaveLength(1);
	});

	it("anchor text 作為 title 回傳", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(LIST_HTML));
		const results = await fetchList("https://example.com/latest");
		const item = results.find(
			(r) => r.url === "https://example.com/gossip/12345",
		);
		expect(item?.title).toBe("明星出軌事件");
	});

	it("超過 20 條截斷為 20", async () => {
		const manyLinks = Array.from(
			{ length: 30 },
			(_, i) => `<a href="/gossip/${i + 1}">標題${i + 1}</a>`,
		).join("\n");
		const html = `<html><body>${manyLinks}</body></html>`;
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const results = await fetchList("https://example.com/latest");
		expect(results.length).toBeLessThanOrEqual(20);
	});

	it("所有 <a href> 都是外站 → 返回空陣列", async () => {
		const html =
			'<html><body><a href="https://other.com/gossip/1">外站</a></body></html>';
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("safeFetch 返回非 200 → 返回空陣列", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 503));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("safeFetch 拋出例外 → 返回空陣列", async () => {
		mockSafeFetch.mockRejectedValueOnce(new Error("Network error"));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("content-length 超過 5 MB → 返回空陣列", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("x", 200, 6 * 1024 * 1024),
		);
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});
});

describe("generic-adapter.fetchContent", () => {
	it("從 og:* meta 正確提取標題、正文、封面圖", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(ARTICLE_HTML));
		const result = await fetchContent("https://example.com/gossip/12345");
		expect(result.title).toBe("明星A出軌B事件始末");
		expect(result.body).toBe("明星A被拍到與B私會，前任C發文暗諷");
		expect(result.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
		expect(result.metadata?.publishedTime).toBe("2024-08-15");
	});

	it("HTTP 4xx 時拋出含狀態碼的 Error", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 404));
		await expect(
			fetchContent("https://example.com/gossip/99999"),
		).rejects.toThrow("HTTP 404");
	});

	it("content-length 超過 5 MB → 拋出 too large 錯誤", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("x", 200, 6 * 1024 * 1024),
		);
		await expect(
			fetchContent("https://example.com/gossip/12345"),
		).rejects.toThrow("too large");
	});

	it("og:* meta 缺失時 fallback 用 <title> 和 <h1>，body 可能為空", async () => {
		const html = `<html><head><title>純文字標題</title></head><body><h1>純文字標題</h1></body></html>`;
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const result = await fetchContent("https://example.com/gossip/plain");
		expect(result.title).toBe("純文字標題");
		expect(result.coverImageUrl).toBeUndefined();
		// og:description 缺失時 body 為空字串，這是預期行為
		expect(typeof result.body).toBe("string");
	});
});
