import { fetchWithTimeout } from "@51publisher/shared";
import { clearToken, getAuthHeaders } from "./auth-client";
import { getBackendUrl } from "./backend-url";

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

async function handleUnauthorized(res: Response): Promise<void> {
	if (res.status === 401) {
		await clearToken();
	}
}

/**
 * 从后端获取所有 Prompt 模板列表。
 */
export async function fetchPrompts(
	fetchFn?: typeof fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; prompts?: PromptTemplate[]; error?: string }> {
	try {
		const headers = await getAuthHeaders();
		const backendUrl = await getBackendUrl();
		const url = `${backendUrl}/api/v1/prompts`;
		const res = fetchFn
			? await fetchFn(url, { headers })
			: await fetchWithTimeout(url, {
					headers,
					timeoutMs,
				});
		if (!res.ok) {
			await handleUnauthorized(res);
			return { ok: false, error: `HTTP ${res.status}` };
		}
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
	fetchFn?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const headers = await getAuthHeaders();
		const backendUrl = await getBackendUrl();
		const url = `${backendUrl}/api/v1/prompts`;
		const init = {
			method: "POST",
			headers,
			body: JSON.stringify(data),
		};
		const res = fetchFn
			? await fetchFn(url, init)
			: await fetchWithTimeout(url, { ...init, timeoutMs });
		if (!res.ok) {
			await handleUnauthorized(res);
			return { ok: false, error: `HTTP ${res.status}` };
		}
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
	fetchFn?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const headers = await getAuthHeaders();
		const backendUrl = await getBackendUrl();
		const url = `${backendUrl}/api/v1/prompts/${id}`;
		const init = {
			method: "PUT",
			headers,
			body: JSON.stringify(data),
		};
		const res = fetchFn
			? await fetchFn(url, init)
			: await fetchWithTimeout(url, { ...init, timeoutMs });
		if (!res.ok) {
			await handleUnauthorized(res);
			return { ok: false, error: `HTTP ${res.status}` };
		}
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
