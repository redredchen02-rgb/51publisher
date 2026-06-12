import type {
	ContentDraft,
	FactsBlock,
	GenerateDraftResponse,
	Settings,
} from "@51publisher/shared";
import {
	assembleDraft,
	type DraftSlots,
	normalizeCategory,
	toDraft,
} from "@51publisher/shared";

export interface LlmDeps {
	settings: Settings;
	apiKey: string;
	facts?: FactsBlock;
	/** Web 搜索富化的格式化文本；为空则不注入。 */
	enrichment?: string;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
}

export const DRAFT_SLOTS_SCHEMA = {
	name: "draft_slots",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			titleSuffix: { type: ["string", "null"] },
			subtitle: { type: ["string", "null"] },
			intro: { type: "string" },
			highlights: { type: "string" },
			outro: { type: ["string", "null"] },
			category: { type: ["string", "null"] },
			tags: { type: ["array", "null"], items: { type: "string" } },
		},
		required: [
			"titleSuffix",
			"subtitle",
			"intro",
			"highlights",
			"outro",
			"category",
			"tags",
		],
	},
} as const;

interface BuiltRequest {
	url: string;
	init: RequestInit;
}

export function chatCompletionsUrl(endpoint: string): string {
	const e = endpoint.trim().replace(/\/+$/, "");
	return /\/chat\/completions$/.test(e) ? e : `${e}/chat/completions`;
}

export function buildRequest(
	prompt: string,
	settings: Settings,
	apiKey: string,
	opts: { jsonSchema?: boolean } = {},
): BuiltRequest {
	const response_format = opts.jsonSchema
		? { type: "json_schema" as const, json_schema: DRAFT_SLOTS_SCHEMA }
		: { type: "json_object" as const };
	const body = {
		model: settings.model,
		messages: [{ role: "user", content: prompt }],
		response_format,
	};
	return {
		url: chatCompletionsUrl(settings.endpoint),
		init: {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
	};
}

const str = (v: unknown): string =>
	typeof v === "string" ? v : v == null ? "" : String(v);

function extractContent(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return null;
	const choices = (
		raw as { choices?: Array<{ message?: { content?: unknown } }> }
	).choices;
	const content = choices?.[0]?.message?.content;
	return typeof content === "string" ? content : null;
}

function parseContentJson(content: string): Record<string, unknown> | null {
	const stripped = content
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	try {
		const obj = JSON.parse(stripped);
		return obj && typeof obj === "object" && !Array.isArray(obj)
			? (obj as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

type LlmJsonResult =
	| { ok: true; raw: unknown; parsed: Record<string, unknown>; content: string }
	| { ok: false; error: string };

async function callLlmForJson(
	prompt: string,
	deps: LlmDeps,
	label: string,
): Promise<LlmJsonResult> {
	const { settings, apiKey } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? 45_000;

	if (!apiKey || !settings.endpoint)
		return { ok: false, error: "未配置 API key 或端点。" };

	const { url, init } = buildRequest(prompt, settings, apiKey, {
		jsonSchema: false,
	});

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetchFn(url, { ...init, signal: controller.signal });
	} catch (err) {
		return {
			ok: false,
			error:
				err instanceof Error && err.name === "AbortError"
					? `${label}请求超时。`
					: "网络错误。",
		};
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok)
		return { ok: false, error: `${label}请求失败 (${res.status})。` };

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return { ok: false, error: `${label}响应非合法 JSON。` };
	}

	const content = extractContent(raw);
	if (!content) return { ok: false, error: `${label}响应格式不符。` };
	const parsed = parseContentJson(content);
	if (!parsed) return { ok: false, error: `${label}结果解析失败。` };

	return { ok: true, raw, parsed, content };
}

const optStr = (v: unknown): string | undefined => {
	const s = str(v);
	return s === "" ? undefined : s;
};

export function slotsFromParsed(parsed: Record<string, unknown>): DraftSlots {
	return {
		titleSuffix: optStr(parsed.titleSuffix),
		subtitle: optStr(parsed.subtitle),
		intro: str(parsed.intro),
		highlights: str(parsed.highlights),
		outro: optStr(parsed.outro),
	};
}

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

export async function generateDraft(
	prompt: string,
	deps: LlmDeps,
): Promise<GenerateDraftResponse> {
	const { settings, apiKey } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const now = deps.now ? deps.now() : new Date().toISOString();
	const id = deps.genId ? deps.genId() : `draft_${Date.now()}`;
	const timeoutMs = deps.timeoutMs ?? 60_000;
	const facts = deps.facts ?? {};

	// 注入 Web 搜索富化内容到 prompt 末尾
	const finalPrompt = deps.enrichment
		? `${prompt}\n\n${deps.enrichment}`
		: prompt;

	if (!apiKey || !settings.endpoint) {
		return { ok: false, kind: "no-key", error: "后端未配置 API key 或端点。" };
	}
	if (!isHttps(settings.endpoint)) {
		return {
			ok: false,
			kind: "network",
			error: "endpoint 必须是 https:// 地址。",
		};
	}

	const modelsToTry = [settings.model];
	if (settings.fallbackModel && settings.fallbackModel.trim().length > 0) {
		modelsToTry.push(settings.fallbackModel.trim());
	}

	let res: Response | undefined;
	let lastErrorMsg = "服务返回错误,请重试。";

	for (const currentModel of modelsToTry) {
		let successInCurrentModel = false;
		for (const useSchema of [true, false]) {
			const { url, init } = buildRequest(
				finalPrompt,
				{ ...settings, model: currentModel },
				apiKey,
				{
					jsonSchema: useSchema,
				},
			);
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			let fetchErr: unknown = null;
			try {
				res = await fetchFn(url, { ...init, signal: controller.signal });
			} catch (err) {
				fetchErr = err;
			} finally {
				clearTimeout(timer);
			}

			if (fetchErr) {
				const aborted =
					fetchErr instanceof Error && fetchErr.name === "AbortError";
				lastErrorMsg = aborted
					? "请求超时,请重试。"
					: "网络错误,请检查 endpoint 或网络后重试。";
				break;
			}

			if (res?.ok) {
				successInCurrentModel = true;
				break;
			}

			if (res && useSchema && res.status === 400) {
				continue;
			}

			if (res && (res.status === 429 || res.status >= 500)) {
				lastErrorMsg = `服务返回错误(${res.status} ${res.statusText})。`;
				break;
			}

			return {
				ok: false,
				kind: "network",
				error: `服务返回错误(${res?.status} ${res?.statusText})。`,
			};
		}

		if (successInCurrentModel) break;
	}

	if (!res?.ok) {
		return { ok: false, kind: "network", error: lastErrorMsg };
	}

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return {
			ok: false,
			kind: "format",
			error: "响应不是合法 JSON(可能 endpoint 非 OpenAI 兼容格式)。",
		};
	}

	const content = extractContent(raw);
	if (content == null) {
		return {
			ok: false,
			kind: "format",
			error: "响应结构与 OpenAI 兼容格式不符。",
		};
	}
	const parsed = parseContentJson(content);
	if (parsed == null) {
		return {
			ok: false,
			kind: "format",
			error: "模型未返回合法 JSON 草稿,请调整 prompt 或重试。",
		};
	}

	const assembled = assembleDraft(slotsFromParsed(parsed), facts);
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.map(str).filter(Boolean)
		: [];
	const category = normalizeCategory(str(parsed.category));
	const draft = toDraft(assembled, category, tags, id, now);

	// 质量评估
	const { evaluateQuality } = await import("@51publisher/shared");
	const quality = evaluateQuality(draft, facts);
	const qualityWarnings = quality.checks
		.filter((c) => !c.pass)
		.map((c) => ({ name: c.name, message: c.message }));

	return {
		ok: true,
		draft,
		...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
	};
}

export type ListModelsResult =
	| { ok: true; models: string[] }
	| { ok: false; error: string };

export function modelsUrl(endpoint: string): string {
	const e = endpoint
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/chat\/completions$/, "")
		.replace(/\/+$/, "");
	return `${e}/models`;
}

export async function listModels(
	endpoint: string,
	apiKey: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<ListModelsResult> {
	if (!apiKey || !endpoint)
		return { ok: false, error: "请先配置 API key 与 endpoint。" };
	if (!isHttps(endpoint))
		return { ok: false, error: "endpoint 必须是 https:// 地址。" };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetchFn(modelsUrl(endpoint), {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: controller.signal,
		});
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			error: aborted
				? "请求超时,请重试。"
				: "网络错误(可能 CORS 限制或 endpoint 不可达)。",
		};
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok)
		return {
			ok: false,
			error: `服务返回错误(${res.status} ${res.statusText})。`,
		};

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return {
			ok: false,
			error: "响应不是合法 JSON(可能非 OpenAI 兼容 /models)。",
		};
	}
	const data = (raw as { data?: unknown })?.data;
	if (!Array.isArray(data))
		return {
			ok: false,
			error: "响应无 data 数组(可能非 OpenAI 兼容 /models)。",
		};

	const models = data
		.map((m) =>
			m && typeof m === "object" ? (m as { id?: unknown }).id : undefined,
		)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
		.sort((a, b) => a.localeCompare(b));
	if (models.length === 0) return { ok: false, error: "模型列表为空。" };
	return { ok: true, models };
}

// ---- Phase 3: AI review & rewrite ----

import type { ReviewResult } from "@51publisher/shared";

/** 从 LLM 响应 raw JSON 中提取 token 用量。兼容 OpenAI 标准和部分代理格式。 */
export function extractUsage(
	raw: unknown,
): { prompt: number; completion: number } | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const u = (raw as Record<string, unknown>).usage;
	if (typeof u !== "object" || u === null) return undefined;
	const obj = u as Record<string, unknown>;
	const prompt =
		typeof obj.prompt_tokens === "number"
			? obj.prompt_tokens
			: typeof obj.inputTokens === "number"
				? obj.inputTokens
				: undefined;
	const completion =
		typeof obj.completion_tokens === "number"
			? obj.completion_tokens
			: typeof obj.outputTokens === "number"
				? obj.outputTokens
				: undefined;
	if (prompt === undefined || completion === undefined) return undefined;
	return { prompt, completion };
}

const DEFAULT_CRITERIA = `你是专业内容评审员。请对以下帖子草稿进行四维评审。

四个维度：
1. body_richness（正文丰富度）：正文字数≥150字、内容实质丰富、不空洞单薄。
2. community_tone（社区口吻）：文风贴近动漫社区，口语化接地气，不过于官方生硬。
3. title_quality（标题质量）：标题有信息量、吸引人，让读者想点进去看。
4. category_accuracy（分类准确性）：分类和标签准确匹配内容，标签有实际含义。

仅输出 JSON，格式：{"dimensions":[{"name":"body_richness","pass":true,"reason":"一句话"},{"name":"community_tone","pass":true,"reason":"一句话"},{"name":"title_quality","pass":true,"reason":"一句话"},{"name":"category_accuracy","pass":true,"reason":"一句话"}]}`;

const DIM_LABELS: Record<string, string> = {
	body_richness: "正文（需更丰富充实，≥150字，有实质内容）",
	community_tone: "正文风格（需更贴近动漫社区口吻，口语化接地气）",
	title_quality: "标题（需更吸引人、有信息量）",
	category_accuracy: "分类和标签（需更准确匹配内容）",
};

export function buildReviewPrompt(
	draft: ContentDraft,
	criteriaPrompt?: string,
): string {
	const criteria = criteriaPrompt?.trim() || DEFAULT_CRITERIA;
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `${criteria}

草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}`;
}

export function buildRewritePrompt(
	draft: ContentDraft,
	failedDims: string[],
): string {
	const targets = failedDims.map((d) => DIM_LABELS[d] ?? d).join("\n- ");
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `以下帖子草稿有以下维度未达标，请**仅**针对这些维度重写，其他字段不变：
- ${targets}

原草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}

仅输出 JSON（包含需重写的字段，未改动字段省略）：
{"title":"改后标题","body":"<p>改后正文</p>","tags":["改后标签1","改后标签2"]}`;
}

export type ReviewDraftResult =
	| {
			ok: true;
			result: ReviewResult;
			reviewCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function reviewDraftLlm(
	draft: ContentDraft,
	criteriaPrompt: string | undefined,
	deps: LlmDeps,
): Promise<ReviewDraftResult> {
	const prompt = buildReviewPrompt(draft, criteriaPrompt);
	const result = await callLlmForJson(prompt, deps, "评审");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const dims = parsed.dimensions;
	if (!Array.isArray(dims))
		return { ok: false, error: "评审结果缺少 dimensions 字段。" };

	const dimensions = dims
		.filter(
			(d): d is Record<string, unknown> => typeof d === "object" && d !== null,
		)
		.map((d) => ({
			name: String(d.name ?? ""),
			pass: Boolean(d.pass),
			...(d.reason !== undefined ? { reason: String(d.reason) } : {}),
		}))
		.filter((d) => d.name.length > 0);

	const reviewCostTokens = extractUsage(raw);
	return {
		ok: true,
		result: { ok: true, dimensions },
		...(reviewCostTokens ? { reviewCostTokens } : {}),
	};
}

export type RewriteDraftResult =
	| {
			ok: true;
			draft: ContentDraft;
			rewriteCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function rewriteDraftLlm(
	draft: ContentDraft,
	failedDims: string[],
	deps: LlmDeps,
): Promise<RewriteDraftResult> {
	const prompt = buildRewritePrompt(draft, failedDims);
	const result = await callLlmForJson(prompt, deps, "重写");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const rewritten: ContentDraft = { ...draft };
	if (typeof parsed.title === "string" && parsed.title.trim())
		rewritten.title = parsed.title.trim();
	if (typeof parsed.body === "string" && parsed.body.trim())
		rewritten.body = parsed.body.trim();
	if (Array.isArray(parsed.tags)) {
		rewritten.tags = parsed.tags.map((t) => String(t)).filter(Boolean);
	}

	const rewriteCostTokens = extractUsage(raw);
	return {
		ok: true,
		draft: rewritten,
		...(rewriteCostTokens ? { rewriteCostTokens } : {}),
	};
}
