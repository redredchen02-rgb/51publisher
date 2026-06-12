// 51acgs.com 内容详情页适配器。
// 每次 cron 触发抓取配置中指定的单条详情页 URL。
// 选择器基于 51acgs.com 常见页面结构——运营者可在 scraper-config 中调整目标 URL。
import type { RawContent, SiteAdapter } from "../site-adapter.js";
import { safeFetch } from "../ssrf-guard.js";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** 从 <title> 提取标题，去掉 " - 站名" 后缀。 */
function extractTitle(html: string): string {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!m) return "";
	return m[1]
		.replace(/\s*[-|–]\s*.*?(?:acg|51|acgs).*$/i, "")
		.replace(/&amp;/g, "&")
		.trim();
}

/** 提取 <h1> 文本(作为备用标题来源)。 */
function extractH1(html: string): string {
	const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	if (!m) return "";
	return m[1].replace(/<[^>]*>/g, "").trim();
}

/** 提取 meta description。 */
function extractMetaDescription(html: string): string {
	const m =
		html.match(
			/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
		) ??
		html.match(
			/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
		);
	return m ? m[1].trim() : "";
}

/** 提取 og:image URL。 */
function extractOgImage(html: string): string {
	const m =
		html.match(
			/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i,
		) ??
		html.match(
			/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:image["']/i,
		);
	return m ? m[1].trim() : "";
}

/** 按顺序尝试多个 CSS 选择器模式(regex 近似),返回第一个命中的内部文本。 */
function extractByPatterns(html: string, patterns: RegExp[]): string {
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			return m[1]
				.replace(/<[^>]*>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
	}
	return "";
}

/** 从页面 HTML 提取结构化元数据字段(制作/漢化/集数等)。 */
function extractMetadata(html: string): Record<string, string> {
	const meta: Record<string, string> = {};

	// 1. 优先从 data-comic-info JSON 提取（51acgs.com 特有结构化数据）
	const comicInfoMatch = html.match(/data-comic-info="([^"]+)"/i);
	if (comicInfoMatch) {
		try {
			const decoded = comicInfoMatch[1]
				.replace(/&quot;/g, '"')
				.replace(/&amp;/g, "&");
			const info = JSON.parse(decoded);
			if (info.comic_type_name) meta["题材"] = info.comic_type_name;
			if (info.comic_tag_name) meta["标签"] = info.comic_tag_name;
		} catch {
			// JSON parse failed, skip
		}
	}

	// 2. 提取作者信息（从 "作者：" 区域，需要是 /creator/ 链接）
	const authorMatch = html.match(
		/<span[^>]*>作者[：:]?<\/span>\s*<a[^>]*href="[^"]*\/creator\/\d+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/i,
	);
	if (authorMatch) {
		const authorName = authorMatch[1].trim();
		// 过滤掉明显不是作者名的内容
		if (authorName && authorName.length > 1 && !/^(剧情|简介|标签|分类|默认)/.test(authorName)) {
			meta["制作"] = authorName;
		}
	}

	// 3. 从标题提取作者（格式通常是 [作者名] 作品名）
	if (!meta["制作"]) {
		const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		if (titleMatch) {
			const titleText = titleMatch[1].replace(/&amp;/g, "&").trim();
			const authorInTitle = titleText.match(/^\[([^\]]+)\]/);
			if (authorInTitle) {
				meta["制作"] = authorInTitle[1];
			}
		}
	}

	// 4. 从标题提取汉化组（格式通常是 [中国翻訳] 等）
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (titleMatch) {
		const titleText = titleMatch[1].replace(/&amp;/g, "&").trim();
		const hanhuaMatch = titleText.match(/\[(中国翻訳|中国翻译[^\]]*)\]/i);
		if (hanhuaMatch) {
			meta["漢化"] = hanhuaMatch[1];
		}
	}

	// 5. 从标题提取无修信息
	if (titleMatch) {
		const titleText = titleMatch[1].replace(/&amp;/g, "&").trim();
		if (/无修正|無修正|uncensored|uncen/i.test(titleText)) {
			meta["無修"] = "無修正版";
		}
	}

	// 6. 提取状态（连载/完结）
	if (html.includes('class="is-serial"') || html.includes("连载")) {
		meta["状态"] = "连载";
	} else if (html.includes('class="is-complete"') || html.includes("完结")) {
		meta["状态"] = "完结";
	}

	// 7. 提取章节数
	const chapterIds = new Set(html.match(/chapter\/(\d+)/g)?.map((m) => m) ?? []);
	if (chapterIds.size > 0) {
		meta["章节数"] = String(chapterIds.size);
	}

	// 8. 从 meta description 提取信息
	const desc = extractMetaDescription(html);
	if (desc && !meta["简介"]) {
		meta["简介"] = desc;
	}

	return meta;
}

/** 提取主要内容正文。 */
function extractBody(html: string): string {
	// 尝试常见的内容容器选择器(按精确度降序)
	const body = extractByPatterns(html, [
		/<(?:div|article|section)[^>]+(?:class|id)=["'][^"']*(?:post-content|article-content|entry-content|content-detail|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/i,
		/<(?:div|article)[^>]+(?:class|id)=["'][^"']*(?:content|article|post)[^"']*["'][^>]*>([\s\S]{100,}?)<\/(?:div|article)>/i,
	]);
	if (body && body.length >= 50) return body;

	// 回退到 meta description
	return extractMetaDescription(html);
}

/**
 * 匹配详情页路径：/分类段/数字ID(.html可选)
 * 例: /acg/12345.html  /anime/67890
 */
const DETAIL_PATH_RE = /^\/[a-z0-9_-]+\/\d+(?:\.html?)?(?:[?#].*)?$/i;

export const acgs51Adapter: SiteAdapter = {
	name: "acgs51",

	async fetchList(listUrl: string): Promise<string[]> {
		let res: Response;
		try {
			res = await safeFetch(listUrl, {
				headers: {
					"User-Agent": UA,
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "zh-TW,zh;q=0.9,ja;q=0.8",
				},
			});
		} catch {
			return [];
		}
		if (!res.ok) return [];

		const html = await res.text();
		const base = new URL(listUrl);
		const seen = new Set<string>();
		const urls: string[] = [];

		// 提取所有 <a href="..."> 值
		const hrefRe = /<a\s[^>]*href=["']([^"'#][^"']*)["']/gi;
		for (let m = hrefRe.exec(html); m !== null; m = hrefRe.exec(html)) {
			const href = m[1].trim();
			// 处理相对路径
			let absolute: URL;
			try {
				absolute = new URL(href, base);
			} catch {
				continue;
			}
			// 必须同 host + 匹配详情页路径模式
			if (absolute.hostname !== base.hostname) continue;
			if (!DETAIL_PATH_RE.test(absolute.pathname)) continue;
			// 去除 query/hash 后去重
			const normalized = `${absolute.origin}${absolute.pathname}`;
			if (seen.has(normalized)) continue;
			seen.add(normalized);
			urls.push(normalized);
		}
		return urls;
	},

	async fetchContent(url: string): Promise<RawContent> {
		const res = await safeFetch(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "zh-TW,zh;q=0.9,ja;q=0.8",
			},
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
		}

		const html = await res.text();
		const title = extractH1(html) || extractTitle(html);

		if (!title) {
			throw new Error(`Could not extract title from ${url}`);
		}

		const body = extractBody(html);
		const ogImage = extractOgImage(html);
		const structuredMeta = extractMetadata(html);

		return {
			title,
			body,
			url,
			metadata:
				Object.keys(structuredMeta).length > 0 ? structuredMeta : undefined,
			coverImageUrl: ogImage || undefined,
		};
	},
};
