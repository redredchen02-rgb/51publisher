import type { ContentDraft, GenerateDraftResponse, Settings } from '@51publisher/shared';
import type { FactsBlock } from '@51publisher/shared';
import type { DraftSlots } from '@51publisher/shared';
import { getToken, clearToken } from './auth-client';

export interface LlmDeps {
  settings: Settings;
  apiKey: string; // Left in interface for compatibility, but ignored in execution
  facts?: FactsBlock;
  fetchFn?: typeof fetch;
  now?: () => string;
  genId?: () => string;
  timeoutMs?: number;
}

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };

const BACKEND_BASE = 'http://127.0.0.1:3001';

/**
 * 拉取模型列表，转而请求本地后端服务。
 */
export async function listModels(
  endpoint: string,
  apiKey: string, // Kept for interface compatibility
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<ListModelsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/models`, {
      headers,
      signal: controller.signal,
    });

    if (res.status === 401) {
      await clearToken();
      return { ok: false, error: '登录已过期，请重新登录。' };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errorDetail = `后端服务返回错误 (${res.status})`;
      try {
        const parsedErr = JSON.parse(errText);
        if (parsedErr.error) errorDetail = parsedErr.error;
      } catch {}
      return { ok: false, error: errorDetail };
    }

    const data = (await res.json()) as ListModelsResult;
    return data;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? '拉取模型超时，请检查服务。' : '无法连接到后端服务，请确认后端已启动。' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 生成一条草稿，请求本地后端服务。
 */
export async function generateDraft(prompt: string, deps: LlmDeps): Promise<GenerateDraftResponse> {
  const { settings, facts } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/drafts/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        settings,
        facts,
      }),
      signal: controller.signal,
    });

    if (res.status === 401) {
      await clearToken();
      return { ok: false, kind: 'network', error: '登录已过期，请重新登录。' };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errorDetail = `后端服务返回错误 (${res.status})`;
      try {
        const parsedErr = JSON.parse(errText);
        if (parsedErr.error) errorDetail = parsedErr.error;
      } catch {}
      return { ok: false, kind: 'network', error: errorDetail };
    }

    const data = (await res.json()) as GenerateDraftResponse;
    return data;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      kind: 'network',
      error: aborted ? '后端请求超时，请检查服务状态。' : '无法连接到后端服务，请确认后端已在 127.0.0.1:3001 启动。',
    };
  } finally {
    clearTimeout(timer);
  }
}

import { type AssembledDraft } from '@51publisher/shared';
export function toDraft(
  assembled: AssembledDraft,
  category: string,
  tags: string[],
  id: string,
  now: string,
): ContentDraft {
  return {
    id,
    title: assembled.title,
    subtitle: assembled.subtitle,
    category,
    coverImageUrl: '',
    body: assembled.body,
    tags,
    description: assembled.description,
    postStatus: '1',
    publishedAt: '',
    mediaId: '',
    status: 'draft',
    createdAt: now,
  };
}
