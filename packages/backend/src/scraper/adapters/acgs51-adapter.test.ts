import { beforeEach, describe, expect, it, vi } from "vitest";
import { acgs51Adapter } from "./acgs51-adapter.js";

// 模拟 safeFetch，避免真实网络请求
vi.mock("../ssrf-guard.js", () => ({
	safeFetch: vi.fn(),
	assertUrlSafe: vi.fn(),
}));

import { safeFetch } from "../ssrf-guard.js";

const mockFetch = vi.mocked(safeFetch);

function makeResponse(html: string, ok = true, status = 200): Response {
	return {
		ok,
		status,
		text: async () => html,
		headers: new Headers(),
	} as unknown as Response;
}

/** 构造包含 N 条同 host 详情页链接的列表 HTML */
function listHtml(
	_host: string,
	paths: string[],
	extras: string[] = [],
): string {
	const links = paths.map((p) => `<a href="${p}">Link</a>`).join("\n");
	const extLinks = extras.map((u) => `<a href="${u}">Ext</a>`).join("\n");
	return `<html><body>${links}${extLinks}</body></html>`;
}

const BASE = "https://51acgs.com/acg/";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("acgs51Adapter.fetchList", () => {
	it("从列表页提取同 host 详情页 URL（5 条）", async () => {
		const paths = [
			"/acg/1001.html",
			"/acg/1002.html",
			"/acg/1003.html",
			"/acg/1004.html",
			"/acg/1005.html",
		];
		mockFetch.mockResolvedValue(makeResponse(listHtml("51acgs.com", paths)));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toHaveLength(5);
		for (const path of paths) {
			expect(result).toContain(`https://51acgs.com${path}`);
		}
	});

	it("过滤掉外部域名的链接", async () => {
		const html = `
      <a href="/acg/2001.html">内部</a>
      <a href="https://other.com/acg/9999.html">外部1</a>
      <a href="http://evil.org/steal">外部2</a>
    `;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toHaveLength(1);
		expect(result?.[0]).toBe("https://51acgs.com/acg/2001.html");
	});

	it("页面内重复链接只返回一次", async () => {
		const html = `
      <a href="/acg/3001.html">dup1</a>
      <a href="/acg/3001.html">dup2</a>
      <a href="https://51acgs.com/acg/3001.html">dup3</a>
    `;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toHaveLength(1);
	});

	it("HTTP 请求失败 → 返回空数组（不抛出）", async () => {
		mockFetch.mockRejectedValue(new Error("network error"));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toEqual([]);
	});

	it("非 2xx 状态码 → 返回空数组", async () => {
		mockFetch.mockResolvedValue(makeResponse("", false, 503));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toEqual([]);
	});

	it("HTML 中无匹配详情页链接 → 返回空数组", async () => {
		const html = `
      <a href="/">首页</a>
      <a href="/about">关于</a>
      <a href="/category/action">分类</a>
    `;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toEqual([]);
	});

	it("不带 .html 后缀的详情页路径也能识别", async () => {
		const html = `<a href="/anime/4001">无后缀详情页</a>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList?.(BASE);

		expect(result).toHaveLength(1);
		expect(result?.[0]).toBe("https://51acgs.com/anime/4001");
	});
});

const DETAIL_URL = "https://51acgs.com/acg/12345.html";

describe("acgs51Adapter.fetchContent", () => {
	it("正常：h1 + title + og:image → 返回 title/body/coverImageUrl", async () => {
		const html = `<html><head>
<title>测试作品 - 51acgs.com</title>
<meta property="og:image" content="https://cdn.example.com/cover.jpg" />
</head><body>
<h1>测试作品</h1>
<meta name="description" content="这是一篇测试描述内容，超过五十个字符以确保 body 被正确提取并传回给调用方。" />
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.title).toBe("测试作品");
		expect(result.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
		expect(result.url).toBe(DETAIL_URL);
	});

	it("无 h1 时 fallback 到 title（去掉站名后缀）", async () => {
		const html = `<html><head>
<title>漫画作品名 - 51acgs</title>
<meta name="description" content="描述" />
</head><body></body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.title).toBe("漫画作品名");
	});

	it("HTTP 错误 → throw Error 含状态码", async () => {
		mockFetch.mockResolvedValue(makeResponse("", false, 404));

		await expect(acgs51Adapter.fetchContent(DETAIL_URL)).rejects.toThrow(
			"HTTP 404",
		);
	});

	it("无法提取 title → throw 'Could not extract title'", async () => {
		const html = `<html><body><p>无标题页面</p></body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		await expect(acgs51Adapter.fetchContent(DETAIL_URL)).rejects.toThrow(
			"Could not extract title",
		);
	});

	it("og:image content-first 格式（content=xxx property=og:image）", async () => {
		const html = `<html><head>
<title>作品</title>
<h1>作品</h1>
<meta content="https://cdn.example.com/alt-cover.jpg" property="og:image" />
</head></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.coverImageUrl).toBe("https://cdn.example.com/alt-cover.jpg");
	});

	it("有效 data-comic-info JSON → metadata 含题材/标签", async () => {
		const info = JSON.stringify({
			comic_type_name: "奇幻",
			comic_tag_name: "冒险,热血",
		}).replace(/"/g, "&quot;");
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<div data-comic-info="${info}"></div>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.题材).toBe("奇幻");
		expect(result.metadata?.标签).toBe("冒险,热血");
	});

	it("data-comic-info JSON 格式错误 → 静默跳过不崩溃", async () => {
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<div data-comic-info="not-valid-json-&quot;broken"></div>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		await expect(acgs51Adapter.fetchContent(DETAIL_URL)).resolves.toBeDefined();
	});

	it("HTML 含作者 /creator/ URL pattern → metadata.制作 被填充", async () => {
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<span>作者：</span><a href="/creator/42"><span>山田太郎</span></a>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.制作).toBe("山田太郎");
	});

	it("标题含 [作者名] 括号 → metadata.制作 被提取", async () => {
		const html = `<html><head><title>[画师ABC] 漫画标题 - 51acgs</title></head><body>
<h1>[画师ABC] 漫画标题</h1>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.制作).toBe("画师ABC");
	});

	it("标题含 [中国翻訳] → metadata.漢化 被填充", async () => {
		const html = `<html><head><title>[中国翻訳] 漫画作品</title></head><body>
<h1>漫画作品</h1>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.漢化).toBe("中国翻訳");
	});

	it("标题含 无修正 → metadata.無修 被填充", async () => {
		const html = `<html><head><title>漫画作品 无修正版</title></head><body>
<h1>漫画作品</h1>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.無修).toBe("無修正版");
	});

	it("HTML 含 class='is-serial' → metadata.状态 = '连载'", async () => {
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<span class="is-serial">连载中</span>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.状态).toBe("连载");
	});

	it("HTML 含 class='is-complete' → metadata.状态 = '完结'", async () => {
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<span class="is-complete">已完结</span>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.状态).toBe("完结");
	});

	it("HTML 有 chapter/ 链接 → metadata.章节数 被填充", async () => {
		const html = `<html><head><title>作品</title></head><body>
<h1>作品</h1>
<a href="/chapter/101">第1话</a>
<a href="/chapter/102">第2话</a>
<a href="/chapter/103">第3话</a>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata?.章节数).toBe("3");
	});

	it("无 body 内容区 → fallback 到 meta description 作为 body", async () => {
		const html = `<html><head>
<title>作品</title>
<meta name="description" content="这是从 meta description 提取的内容作为正文备用" />
</head><body><h1>作品</h1></body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.body).toContain("meta description");
	});

	it("无任何结构化元数据 → rawContent.metadata 为 undefined", async () => {
		const html = `<html><head><title>纯净作品</title></head><body>
<h1>纯净作品</h1>
</body></html>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchContent(DETAIL_URL);

		expect(result.metadata).toBeUndefined();
	});
});
