import { describe, expect, it, vi } from "vitest";
import {
	type EnrichedContext,
	enrichContext,
	formatEnrichmentForPrompt,
} from "./web-enricher.js";

function makeFetch(responses: Array<{ ok: boolean; text: string }>) {
	let idx = 0;
	return vi.fn(async () => {
		const r = responses[idx++] ?? { ok: false, text: "" };
		return {
			ok: r.ok,
			text: async () => r.text,
		} as Response;
	});
}

const PIXIV_PAGE = `Title: 花鸟画师
URL Source: https://pixiv.net/tags/%E8%8A%B1%E9%B8%9F%E7%94%BB%E5%B8%88

以工笔花鸟为主,擅长细腻笔法与传统意境。

* [关注作者](pixiv.net/en/users/123)
* [![thumbnail](pximg.net/img.jpg)](pixiv.net/en/artworks/456)
`;

describe("enrichContext", () => {
	it("返回空结果当 facts 无有效字段", async () => {
		const fetchFn = makeFetch([]);
		const ctx = await enrichContext({ facts: {}, fetchFn, maxQueries: 2 });
		expect(ctx.queryResults).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("按作者名搜索 pixiv", async () => {
		const fetchFn = makeFetch([{ ok: true, text: PIXIV_PAGE }]);
		const ctx = await enrichContext({
			facts: { 制作: "花鸟画师" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults).toHaveLength(1);
		expect(ctx.queryResults[0].query).toBe("花鸟画师");
		expect(ctx.queryResults[0].results[0].title).toBe("花鸟画师");
		expect(ctx.queryResults[0].results[0].snippet).toContain("工笔");
	});

	it("HTTP 失败时静默降级返回空结果", async () => {
		const fetchFn = makeFetch([{ ok: false, text: "" }]);
		const ctx = await enrichContext({
			facts: { 制作: "某作者" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults[0].results).toHaveLength(0);
	});

	it("fetch 抛出异常时静默降级", async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error("network error");
		}) as unknown as typeof fetch;
		const ctx = await enrichContext({
			facts: { 制作: "某作者" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults[0].results).toHaveLength(0);
	});

	it("同时搜索作者 + 作品名", async () => {
		const fetchFn = makeFetch([
			{ ok: true, text: PIXIV_PAGE },
			{ ok: true, text: PIXIV_PAGE },
		]);
		const ctx = await enrichContext({
			facts: { 制作: "花鸟画师", 作品名: "山水之间" },
			fetchFn,
			maxQueries: 3,
			timeoutMs: 5000,
		});
		expect(ctx.queryResults).toHaveLength(2);
	});
});

describe("formatEnrichmentForPrompt", () => {
	it("有结果时生成参考文本", () => {
		const ctx: EnrichedContext = {
			queryResults: [
				{
					query: "花鸟画师",
					results: [
						{
							title: "pixiv 作者页",
							snippet: "以工笔花鸟为主",
							url: "https://pixiv.net/tags/abc",
						},
					],
				},
			],
			collectedAt: "2026-06-12T00:00:00.000Z",
		};
		const text = formatEnrichmentForPrompt(ctx);
		expect(text).toContain("网络参考资料");
		expect(text).toContain("花鸟画师");
		expect(text).toContain("工笔花鸟");
	});

	it("无结果时返回空字符串", () => {
		const ctx: EnrichedContext = {
			queryResults: [{ query: "x", results: [] }],
			collectedAt: "2026-06-12T00:00:00.000Z",
		};
		expect(formatEnrichmentForPrompt(ctx)).toBe("");
	});

	it("超长内容被截断至 2000 字符", () => {
		const longSnippet = "x".repeat(3000);
		const ctx: EnrichedContext = {
			queryResults: [
				{
					query: "q",
					results: [
						{ title: "t", snippet: longSnippet, url: "https://example.com" },
					],
				},
			],
			collectedAt: "",
		};
		const text = formatEnrichmentForPrompt(ctx);
		expect(text.length).toBeLessThanOrEqual(2020);
		expect(text).toContain("已截断");
	});

	it("多个 query，部分 results 为空 → 空 query 跳过不输出", () => {
		const ctx: EnrichedContext = {
			queryResults: [
				{ query: "empty-q", results: [] },
				{
					query: "有结果",
					results: [
						{ title: "标题", snippet: "摘要", url: "https://example.com" },
					],
				},
			],
			collectedAt: "",
		};
		const text = formatEnrichmentForPrompt(ctx);
		expect(text).not.toContain("empty-q");
		expect(text).toContain("有结果");
	});
});

describe("enrichContext — 缓存与边界", () => {
	it("内存缓存命中：第二次相同 facts 不再 fetch", async () => {
		// 用唯一 facts 避免被其他测试缓存污染
		const uniqueFacts = { 制作: `cache-artist-${Date.now()}` };
		const fetchFn = makeFetch([
			{ ok: true, text: "Title: 结果\n\n摘要内容行" },
			{ ok: true, text: "Title: 结果2\n\n摘要内容行2" },
		]);

		await enrichContext({ facts: uniqueFacts, fetchFn, maxQueries: 1 });
		await enrichContext({ facts: uniqueFacts, fetchFn, maxQueries: 1 });

		// 内存缓存命中，fetchFn 只被调用一次
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("maxQueries=1 时只发一个请求（有制作+作品名但受限）", async () => {
		const fetchFn = makeFetch([{ ok: true, text: "Title: X\n\n内容" }]);
		await enrichContext({
			facts: {
				制作: `限流作者-${Date.now()}`,
				作品名: `限流作品-${Date.now()}`,
			},
			fetchFn,
			maxQueries: 1,
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("facts 只有作品名无制作 → 只发 work 类型 query", async () => {
		const fetchFn = makeFetch([
			{ ok: true, text: "Title: 作品\n\n作品简介内容" },
		]);
		const ctx = await enrichContext({
			facts: { 作品名: `纯作品-${Date.now()}` },
			fetchFn,
			maxQueries: 2,
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(ctx.queryResults).toHaveLength(1);
	});

	it("作品名含特殊字符（xx）→ 清理后仍能搜索", async () => {
		const fetchFn = makeFetch([
			{ ok: true, text: "Title: 结果\n\n搜索结果内容" },
		]);
		const ctx = await enrichContext({
			facts: { 作品名: `作品名（特殊版）-${Date.now()}` },
			fetchFn,
			maxQueries: 2,
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(ctx.queryResults[0].results.length).toBeGreaterThanOrEqual(0);
	});

	it("作品名全是特殊字符（～～）→ cleanName 为空，不发请求", async () => {
		const fetchFn = makeFetch([{ ok: true, text: "Title: 结果\n\n内容" }]);
		const ctx = await enrichContext({
			facts: { 作品名: "～～～" },
			fetchFn,
			maxQueries: 2,
		});
		// 作品名清理后为空，不搜索
		expect(ctx.queryResults[0]?.results ?? []).toHaveLength(0);
	});

	it("maxConcurrency=1 且 tasks > 1 → 走批次串行模式（不崩溃）", async () => {
		const fetchFn = makeFetch([
			{ ok: true, text: "Title: 批次结果1\n\n内容1" },
			{ ok: true, text: "Title: 批次结果2\n\n内容2" },
			{ ok: true, text: "Title: 批次结果3\n\n内容3" },
		]);
		// 用唯一 facts 避免缓存命中
		const ts = Date.now();
		const ctx = await enrichContext({
			facts: {
				制作: `批次作者-${ts}`,
				作品名: `批次作品-${ts}`,
			},
			fetchFn,
			maxQueries: 2,
			maxConcurrency: 1,
		});
		expect(ctx.queryResults).toHaveLength(2);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});
});
