// Web 搜索富化模块：用 Jina (r.jina.ai) 抓取 pixiv 作者页面补充作品资讯。
// 搜索结果喂入 LLM prompt，让文章更丰富有深度。
// 搜索失败时静默降级，不影响主管线。

import type { FactsBlock } from "@51publisher/shared";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const JINA_PREFIX = "https://r.jina.ai/";

export interface SearchResult {
	title: string;
	snippet: string;
	url: string;
}

export interface EnrichedContext {
	queryResults: Array<{
		query: string;
		results: SearchResult[];
	}>;
	collectedAt: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** 从 Jina 返回的 Markdown 中提取有用信息。 */
function parseJinaContent(content: string, sourceUrl: string): SearchResult[] {
	const results: SearchResult[] = [];

	// 提取标题
	const titleMatch = content.match(/^Title:\s*(.+)$/m);
	const title = titleMatch ? titleMatch[1].trim() : "";

	// 提取页面描述或前几段作为摘要
	const lines = content.split("\n").filter((l) => l.trim());
	const snippetLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// 跳过导航、图片链接等
		if (
			trimmed.startsWith("[![") ||
			trimmed.startsWith("* [") ||
			trimmed.startsWith("- [") ||
			trimmed.includes("pixiv.net/en/") ||
			trimmed.includes("pximg.net") ||
			trimmed.length < 10
		) {
			continue;
		}
		// 收集有意义的文本行
		if (snippetLines.length < 3 && !trimmed.startsWith("#")) {
			snippetLines.push(trimmed);
		}
	}

	const snippet = snippetLines.join(" ").slice(0, 300);

	if (title || snippet) {
		results.push({
			title: title || "pixiv 作者页面",
			snippet,
			url: sourceUrl,
		});
	}

	return results;
}

/** 用 Jina 抓取 pixiv 作者标签页面。 */
async function fetchPixivByArtist(
	artistName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(artistName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(artistName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 用 Jina 抓取 pixiv 搜索页面（作品名）。 */
async function fetchPixivByWork(
	workName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// 去掉特殊字符，保留可搜索部分
		const cleanName = workName
			.replace(/[～〜~]/g, " ")
			.replace(/[（(][^）)]*[）)]/g, "")
			.replace(/\s+/g, " ")
			.trim();

		if (!cleanName) return [];

		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(cleanName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(cleanName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 根据事实构建搜索任务列表。 */
function buildSearchTasks(
	facts: FactsBlock,
	maxQueries: number,
): Array<{ type: "artist" | "work"; query: string }> {
	const tasks: Array<{ type: "artist" | "work"; query: string }> = [];

	const maker = facts.制作?.trim();
	const name = facts.作品名?.trim();

	// 优先用作者名搜 pixiv（同人作者的主要平台）
	if (maker) {
		const coreMaker = maker.replace(/[（(][^）)]*[）)]/g, "").trim() || maker;
		tasks.push({ type: "artist", query: coreMaker });
	}

	// 用作品名搜 pixiv
	if (name && tasks.length < maxQueries) {
		tasks.push({ type: "work", query: name });
	}

	return tasks.slice(0, maxQueries);
}

/** 格式化富化上下文为 LLM prompt 可用的文本。 */
export function formatEnrichmentForPrompt(ctx: EnrichedContext): string {
	const hasAny = ctx.queryResults.some((qr) => qr.results.length > 0);
	if (!hasAny) return "";

	const lines: string[] = [
		"【网络参考资料】(以下为网络搜索结果，可参考用于丰富文章内容，但不得直接复制):",
	];

	for (const qr of ctx.queryResults) {
		if (qr.results.length === 0) continue;
		lines.push(`\n搜索「${qr.query}」结果：`);
		for (const r of qr.results) {
			lines.push(`- ${r.title}：${r.snippet}`);
			lines.push(`  来源：${r.url}`);
		}
	}

	const text = lines.join("\n");
	return text.length > 2000 ? text.slice(0, 2000) + "\n...(已截断)" : text;
}

export interface EnrichDeps {
	facts: FactsBlock;
	maxQueries?: number;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

/** 主入口：根据事实执行搜索富化，返回结构化上下文。 */
export async function enrichContext(
	deps: EnrichDeps,
): Promise<EnrichedContext> {
	const { facts, maxQueries = 3, fetchFn = fetch, timeoutMs = 15_000 } = deps;

	const tasks = buildSearchTasks(facts, maxQueries);
	const queryResults: EnrichedContext["queryResults"] = [];

	for (const task of tasks) {
		let results: SearchResult[];

		if (task.type === "artist") {
			results = await fetchPixivByArtist(task.query, fetchFn, timeoutMs);
		} else {
			results = await fetchPixivByWork(task.query, fetchFn, timeoutMs);
		}

		queryResults.push({ query: task.query, results });

		// 搜索间隔，避免触发限流
		if (tasks.indexOf(task) < tasks.length - 1) {
			await sleep(800 + Math.random() * 400);
		}
	}

	return {
		queryResults,
		collectedAt: new Date().toISOString(),
	};
}
