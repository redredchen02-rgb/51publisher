import { apiFetch } from "./api-fetch";

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export interface PromptTemplate {
	id: string;
	name: string;
	template: string;
	fewShotExamples: string;
	model?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * 从后端获取所有 Prompt 模板列表。
 * (_fetchFn 历史遗留参数,实际请求走 apiFetch；保留签名避免破坏调用方。)
 */
export async function fetchPrompts(
	_fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; prompts?: PromptTemplate[]; error?: string }> {
	try {
		const res = await apiFetch("/api/v1/prompts", { timeoutMs });
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * 在后端创建新 Prompt 模板。
 */
export async function createPrompt(
	data: {
		name: string;
		template: string;
		fewShotExamples: string;
		model?: string;
	},
	timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch("/api/v1/prompts", {
			method: "POST",
			body: JSON.stringify(data),
			timeoutMs,
		});
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * 更新后端的 Prompt 模板。
 */
export async function updatePrompt(
	id: string,
	data: {
		name: string;
		template: string;
		fewShotExamples: string;
		model?: string;
	},
	timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch(`/api/v1/prompts/${id}`, {
			method: "PUT",
			body: JSON.stringify(data),
			timeoutMs,
		});
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
