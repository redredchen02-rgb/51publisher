import { clearToken, getToken } from "./auth-client";

const BACKEND_BASE = "http://127.0.0.1:3001";

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

async function authHeaders(): Promise<Record<string, string>> {
	const token = await getToken();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
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
	fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; prompts?: PromptTemplate[]; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetchFn(`${BACKEND_BASE}/api/v1/prompts`, { headers });
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
	fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetchFn(`${BACKEND_BASE}/api/v1/prompts`, {
			method: "POST",
			headers,
			body: JSON.stringify(data),
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
	fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetchFn(`${BACKEND_BASE}/api/v1/prompts/${id}`, {
			method: "PUT",
			headers,
			body: JSON.stringify(data),
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
