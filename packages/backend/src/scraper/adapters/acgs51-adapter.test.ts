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
	host: string,
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

		const result = await acgs51Adapter.fetchList!(BASE);

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

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toHaveLength(1);
		expect(result[0]).toBe("https://51acgs.com/acg/2001.html");
	});

	it("页面内重复链接只返回一次", async () => {
		const html = `
      <a href="/acg/3001.html">dup1</a>
      <a href="/acg/3001.html">dup2</a>
      <a href="https://51acgs.com/acg/3001.html">dup3</a>
    `;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toHaveLength(1);
	});

	it("HTTP 请求失败 → 返回空数组（不抛出）", async () => {
		mockFetch.mockRejectedValue(new Error("network error"));

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toEqual([]);
	});

	it("非 2xx 状态码 → 返回空数组", async () => {
		mockFetch.mockResolvedValue(makeResponse("", false, 503));

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toEqual([]);
	});

	it("HTML 中无匹配详情页链接 → 返回空数组", async () => {
		const html = `
      <a href="/">首页</a>
      <a href="/about">关于</a>
      <a href="/category/action">分类</a>
    `;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toEqual([]);
	});

	it("不带 .html 后缀的详情页路径也能识别", async () => {
		const html = `<a href="/anime/4001">无后缀详情页</a>`;
		mockFetch.mockResolvedValue(makeResponse(html));

		const result = await acgs51Adapter.fetchList!(BASE);

		expect(result).toHaveLength(1);
		expect(result[0]).toBe("https://51acgs.com/anime/4001");
	});
});
