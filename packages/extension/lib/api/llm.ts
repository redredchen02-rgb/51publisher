import type {
	ContentDraft,
	FactsBlock,
	GenerateDraftResponse,
	ReviewResult,
	Settings,
} from "@51guapi/shared";
import { clearToken, getToken } from "./auth-client";
import { getBackendUrl } from "./backend-url";

export interface LlmDeps {
	settings: Settings;
	apiKey: string; // Left in interface for compatibility, but ignored in execution
	facts?: FactsBlock;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
}

export type ListModelsResult =
	| { ok: true; models: string[] }
	| { ok: false; error: string };

// ---- Phase 3: review / rewrite proxy clients ----

export type ReviewDraftResponse =
	| {
			ok: true;
			result: ReviewResult;
			reviewCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; kind?: "network"; error: string };

export type RewriteDraftResponse =
	| {
			ok: true;
			draft: ContentDraft;
			rewriteCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; kind?: "network"; error: string };

// ---- 共享后端代理 ----
// 所有 LLM 函数共享相同的 auth+timeout+401+abort 模式。
// 提取为 backendProxy 消除 ~120 行重复样板。

interface ProxyInit {
	method?: string;
	body?: string;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

interface ProxyMessages {
	authExpired: string;
	timeout: string;
	network: string;
}

type ProxyError = { ok: false; kind?: string; error: string };

async function backendProxy<T>(
	path: string,
	init: ProxyInit,
	messages: ProxyMessages,
	/** 后端 !res.ok 时的自定义错误解析;默认读 JSON { error } 字段。 */
	parseError?: (res: Response) => Promise<ProxyError>,
): Promise<T> {
	const { method, body, fetchFn: fn = fetch, timeoutMs = 20_000 } = init;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;

		const backendUrl = await getBackendUrl();
		const res = await fn(`${backendUrl}${path}`, {
			method,
			body,
			headers,
			signal: controller.signal,
		});

		if (res.status === 401) {
			await clearToken();
			return { ok: false, kind: "network", error: messages.authExpired } as T;
		}

		if (!res.ok) {
			if (parseError) return (await parseError(res)) as T;
			return {
				ok: false,
				kind: "network",
				error: `后端服务返回错误 (${res.status})`,
			} as T;
		}

		return (await res.json()) as T;
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			kind: "network",
			error: aborted ? messages.timeout : messages.network,
		} as T;
	} finally {
		clearTimeout(timer);
	}
}

// ---- 默认错误解析（读 JSON body 中的 error 字段）----

async function defaultErrorParser(
	res: Response,
	fallback: string,
): Promise<ProxyError> {
	const errText = await res.text().catch(() => "");
	let errorDetail = fallback;
	try {
		const parsedErr = JSON.parse(errText);
		if (parsedErr.error) errorDetail = parsedErr.error;
	} catch {}
	return { ok: false, error: errorDetail };
}

// ---- Public API ----

/**
 * 拉取模型列表，转而请求本地后端服务。
 */
export async function listModels(
	_endpoint: string,
	_apiKey: string, // Kept for interface compatibility
	fetchFn: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<ListModelsResult> {
	return backendProxy<ListModelsResult>(
		"/api/v1/models",
		{ fetchFn, timeoutMs },
		{
			authExpired: "登录已过期，请重新登录。",
			timeout: "拉取模型超时，请检查服务。",
			network: "无法连接到后端服务，请确认后端已启动。",
		},
		(res) => defaultErrorParser(res, `后端服务返回错误 (${res.status})`),
	);
}

/**
 * 生成一条草稿，请求本地后端服务。
 */
export async function generateDraft(
	prompt: string,
	deps: LlmDeps,
): Promise<GenerateDraftResponse> {
	const { settings, facts } = deps;
	return backendProxy<GenerateDraftResponse>(
		"/api/v1/drafts/generate",
		{
			method: "POST",
			body: JSON.stringify({ prompt, settings, facts }),
			fetchFn: deps.fetchFn,
			timeoutMs: deps.timeoutMs ?? 60_000,
		},
		{
			authExpired: "登录已过期，请重新登录。",
			timeout: "后端请求超时，请检查服务状态。",
			network: "无法连接到后端服务，请确认后端已在 127.0.0.1:3001 启动。",
		},
		(res) => defaultErrorParser(res, `后端服务返回错误 (${res.status})`),
	);
}

/** POST /api/v1/drafts/review — 薄代理，不 throw，失败返回 ok:false。 */
export async function reviewDraft(
	draft: ContentDraft,
	criteriaPrompt: string | undefined,
	deps: LlmDeps,
): Promise<ReviewDraftResponse> {
	return backendProxy<ReviewDraftResponse>(
		"/api/v1/drafts/review",
		{
			method: "POST",
			body: JSON.stringify({ draft, criteriaPrompt, settings: deps.settings }),
			fetchFn: deps.fetchFn,
			timeoutMs: deps.timeoutMs ?? 45_000,
		},
		{
			authExpired: "登录已过期，请重新登录。",
			timeout: "评审请求超时。",
			network: "无法连接到后端服务。",
		},
	);
}

/** POST /api/v1/drafts/rewrite — 薄代理，不 throw，失败返回 ok:false。 */
export async function rewriteDraft(
	draft: ContentDraft,
	failedDims: string[],
	deps: LlmDeps,
): Promise<RewriteDraftResponse> {
	return backendProxy<RewriteDraftResponse>(
		"/api/v1/drafts/rewrite",
		{
			method: "POST",
			body: JSON.stringify({ draft, failedDims, settings: deps.settings }),
			fetchFn: deps.fetchFn,
			timeoutMs: deps.timeoutMs ?? 45_000,
		},
		{
			authExpired: "登录已过期，请重新登录。",
			timeout: "重写请求超时。",
			network: "无法连接到后端服务。",
		},
	);
}

/** 白名单合并：根据 failedDims 决定取 rewrite 的哪些字段；id/coverImageUrl/mediaId 始终保留 original。 */
export function mergeRewriteResult(
	original: ContentDraft,
	rewrite: Partial<ContentDraft>,
	failedDims: string[],
): ContentDraft {
	const merged: ContentDraft = { ...original };
	if (failedDims.includes("title_quality") && rewrite.title)
		merged.title = rewrite.title;
	if (
		(failedDims.includes("body_richness") ||
			failedDims.includes("community_tone")) &&
		rewrite.body
	) {
		merged.body = rewrite.body;
	}
	if (failedDims.includes("category_accuracy")) {
		if (rewrite.tags) merged.tags = rewrite.tags;
	}
	// 以下字段始终保留 original 值（非 AI 生成字段）
	merged.id = original.id;
	merged.coverImageUrl = original.coverImageUrl;
	merged.mediaId = original.mediaId;
	return merged;
}

import { toDraft } from "@51guapi/shared";

export { toDraft };
