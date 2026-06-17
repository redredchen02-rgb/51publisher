import type {
	FactsBlock,
	GenerateDraftResponse,
	Settings,
} from "@51guapi/shared";
import {
	assembleDraft,
	type DraftSlots,
	normalizeCategory,
	toDraft,
} from "@51guapi/shared";
import {
	buildRequest,
	extractContent,
	fetchWithBackoff,
	isHttps,
	parseContentJson,
} from "./http.js";
import type { LlmDeps } from "./types.js";

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

const str = (v: unknown): string =>
	typeof v === "string" ? v : v == null ? "" : String(v);

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
				{ jsonSchema: useSchema, jsonSchemaDef: DRAFT_SLOTS_SCHEMA },
			);
			const attempt = await fetchWithBackoff(
				fetchFn,
				url,
				init,
				timeoutMs,
				deps,
			);
			res = attempt.res;
			const fetchErr = attempt.fetchErr;

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

	const slots = slotsFromParsed(parsed);
	const assembled = assembleDraft(slots, facts as FactsBlock);
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.map(str).filter(Boolean)
		: [];
	const category = normalizeCategory(str(parsed.category));
	const draft = toDraft(assembled, category, tags, id, now);

	const { evaluateQuality } = await import("@51guapi/shared");
	const quality = evaluateQuality(draft, facts as FactsBlock);
	const qualityWarnings = quality.checks
		.filter((c) => !c.pass)
		.map((c) => ({ name: c.name, message: c.message }));

	return {
		ok: true,
		draft,
		slots,
		...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
	};
}
