import { isHttps } from "./http.js";

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
