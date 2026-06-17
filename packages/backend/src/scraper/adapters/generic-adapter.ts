// 通用 HTML adapter：heuristic <a href> 過濾發現詳情頁 URL，fetchContent 提取 og meta 為主。

import type { RawContent } from "../site-adapter.js";
import { safeFetch } from "../ssrf-guard.js";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** 詳情頁路徑模式：/段/數字ID(.html?可選) 或 /YYYY/MM/slug 或 /YYYYMMDD/slug 格式。 */
const DETAIL_PATH_RE =
	/^\/[a-z0-9_-]+\/\d+(?:\.html?)?(?:[?#].*)?$|\/\d{4}\/\d{2}\/[^/]+|\/\d{8}\/[^/]+/i;

export interface DiscoveredUrl {
	url: string;
	title?: string;
}

function extractOgMeta(html: string, property: string): string {
	const re = new RegExp(
		`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`,
		"i",
	);
	const m = html.match(re);
	return (m?.[1] ?? m?.[2] ?? "").trim();
}

function extractMetaName(html: string, name: string): string {
	const re = new RegExp(
		`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`,
		"i",
	);
	const m = html.match(re);
	return (m?.[1] ?? m?.[2] ?? "").trim();
}

function extractTitle(html: string): string {
	const og = extractOgMeta(html, "og:title");
	if (og) return og;
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function extractH1(html: string): string {
	const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function extractBody(html: string): string {
	const og = extractOgMeta(html, "og:description");
	if (og) return og;
	const desc = extractMetaName(html, "description");
	if (desc) return desc;
	// 嘗試常見正文容器
	const bodyRe =
		/<(?:div|article|section)[^>]+(?:class|id)=["'][^"']*(?:post-content|article-content|entry-content|content-detail|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/i;
	const m = html.match(bodyRe);
	if (m)
		return m[1]
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	return "";
}

/**
 * 從清單頁 HTML 提取詳情頁 URL，帶 anchor text 作為 title。
 * 最多返回 20 條，不重複，同 hostname。
 */
export async function fetchList(listUrl: string): Promise<DiscoveredUrl[]> {
	let res: Response;
	try {
		res = await safeFetch(listUrl, {
			headers: {
				"User-Agent": UA,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "zh-TW,zh;q=0.9",
			},
		});
	} catch {
		return [];
	}
	if (!res.ok) return [];

	const MAX_BYTES = 5 * 1024 * 1024;
	const cl = Number(res.headers.get("content-length") ?? "0");
	if (cl > MAX_BYTES) {
		res.body?.cancel();
		return [];
	}

	const html = await res.text();
	const base = new URL(listUrl);
	const seen = new Set<string>();
	const results: DiscoveredUrl[] = [];

	const hrefRe = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
	for (
		let m = hrefRe.exec(html);
		m !== null && results.length < 20;
		m = hrefRe.exec(html)
	) {
		const href = m[1].trim();
		const anchorHtml = m[2];
		let absolute: URL;
		try {
			absolute = new URL(href, base);
		} catch {
			continue;
		}
		if (absolute.hostname !== base.hostname) continue;
		if (!DETAIL_PATH_RE.test(absolute.pathname)) continue;
		const normalized = `${absolute.origin}${absolute.pathname}`;
		if (seen.has(normalized)) continue;
		seen.add(normalized);

		// 從 anchor 提取純文字 title
		const anchorText = anchorHtml
			.replace(/<img[^>]*>/gi, "")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		results.push({ url: normalized, title: anchorText || undefined });
	}
	return results;
}

/**
 * 抓取單篇詳情頁，提取 RawContent。
 * HTTP 非 2xx 時拋出含狀態碼的 Error。
 */
export async function fetchContent(url: string): Promise<RawContent> {
	const res = await safeFetch(url, {
		headers: {
			"User-Agent": UA,
			Accept: "text/html,application/xhtml+xml",
			"Accept-Language": "zh-TW,zh;q=0.9",
		},
	});

	if (!res.ok) {
		res.body?.cancel();
		throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
	}

	const MAX_BYTES = 5 * 1024 * 1024;
	const cl = Number(res.headers.get("content-length") ?? "0");
	if (cl > MAX_BYTES) {
		res.body?.cancel();
		throw new Error(`Response too large (content-length: ${cl})`);
	}

	const html = await res.text();
	const title = extractH1(html) || extractTitle(html);
	const body = extractBody(html);
	const coverImageUrl = extractOgMeta(html, "og:image") || undefined;
	const publishedTime =
		extractOgMeta(html, "article:published_time") ||
		extractOgMeta(html, "og:updated_time") ||
		undefined;

	return {
		title,
		body,
		url,
		coverImageUrl,
		metadata: publishedTime ? { publishedTime } : undefined,
	};
}
