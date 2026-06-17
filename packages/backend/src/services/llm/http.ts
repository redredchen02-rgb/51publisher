import type { Settings } from "@51guapi/shared";
import type { LlmDeps } from "./types.js";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_CAP_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(res: Response, nowMs: number): number | null {
	const h = res.headers?.get?.("retry-after");
	if (!h) return null;
	const secs = Number(h);
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
	const date = Date.parse(h);
	if (Number.isFinite(date)) return Math.max(0, date - nowMs);
	return null;
}

export async function fetchWithBackoff(
	fetchFn: typeof fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	deps: LlmDeps,
): Promise<{ res?: Response; fetchErr?: unknown }> {
	const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseMs = deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
	const capMs = deps.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
	const sleep = deps.sleep ?? defaultSleep;

	for (let attempt = 0; ; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response | undefined;
		let fetchErr: unknown = null;
		try {
			res = await fetchFn(url, { ...init, signal: controller.signal });
		} catch (err) {
			fetchErr = err;
		} finally {
			clearTimeout(timer);
		}
		if (fetchErr) return { fetchErr };
		if (!res) return {};
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= maxRetries) return { res };
		const retryAfter = parseRetryAfter(res, Date.now());
		const expo = Math.min(capMs, baseMs * 2 ** attempt);
		const delay = Math.min(capMs, retryAfter ?? expo);
		console.warn(
			`[llm] retry status=${res.status} attempt=${attempt + 1} delay=${delay}ms`,
		);
		await sleep(delay);
	}
}

export function chatCompletionsUrl(endpoint: string): string {
	const e = endpoint.trim().replace(/\/+$/, "");
	return /\/chat\/completions$/.test(e) ? e : `${e}/chat/completions`;
}

interface BuiltRequest {
	url: string;
	init: RequestInit;
}

export function buildRequest(
	prompt: string,
	settings: Settings,
	apiKey: string,
	opts: { jsonSchema?: boolean; jsonSchemaDef?: object } = {},
): BuiltRequest {
	const response_format = opts.jsonSchema
		? { type: "json_schema" as const, json_schema: opts.jsonSchemaDef }
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

export function extractContent(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return null;
	const choices = (
		raw as { choices?: Array<{ message?: { content?: unknown } }> }
	).choices;
	const content = choices?.[0]?.message?.content;
	return typeof content === "string" ? content : null;
}

export function parseContentJson(
	content: string,
): Record<string, unknown> | null {
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

export function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

export type LlmJsonResult =
	| { ok: true; raw: unknown; parsed: Record<string, unknown>; content: string }
	| { ok: false; error: string };

export async function callLlmForJson(
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

	const { res, fetchErr } = await fetchWithBackoff(
		fetchFn,
		url,
		init,
		timeoutMs,
		deps,
	);
	if (fetchErr) {
		return {
			ok: false,
			error:
				fetchErr instanceof Error && fetchErr.name === "AbortError"
					? `${label}请求超时。`
					: "网络错误。",
		};
	}
	if (!res) return { ok: false, error: "网络错误。" };

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
