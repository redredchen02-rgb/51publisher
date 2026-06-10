import type { ContentDraft, GenerateDraftResponse, Settings } from '@51publisher/shared';
import type { FactsBlock } from '@51publisher/shared';
import { assembleDraft, type DraftSlots } from '@51publisher/shared';
import { normalizeCategory } from '@51publisher/shared';

export interface LlmDeps {
  settings: Settings;
  apiKey: string;
  facts?: FactsBlock;
  fetchFn?: typeof fetch;
  now?: () => string;
  genId?: () => string;
  timeoutMs?: number;
}

export const DRAFT_SLOTS_SCHEMA = {
  name: 'draft_slots',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      titleSuffix: { type: ['string', 'null'] },
      subtitle: { type: ['string', 'null'] },
      intro: { type: 'string' },
      highlights: { type: 'string' },
      outro: { type: ['string', 'null'] },
      category: { type: ['string', 'null'] },
      tags: { type: ['array', 'null'], items: { type: 'string' } },
    },
    required: ['titleSuffix', 'subtitle', 'intro', 'highlights', 'outro', 'category', 'tags'],
  },
} as const;

interface BuiltRequest {
  url: string;
  init: RequestInit;
}

export function chatCompletionsUrl(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(e) ? e : `${e}/chat/completions`;
}

export function buildRequest(
  prompt: string,
  settings: Settings,
  apiKey: string,
  opts: { jsonSchema?: boolean } = {},
): BuiltRequest {
  const response_format = opts.jsonSchema
    ? { type: 'json_schema' as const, json_schema: DRAFT_SLOTS_SCHEMA }
    : { type: 'json_object' as const };
  const body = {
    model: settings.model,
    messages: [{ role: 'user', content: prompt }],
    response_format,
  };
  return {
    url: chatCompletionsUrl(settings.endpoint),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function extractContent(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function parseContentJson(content: string): Record<string, unknown> | null {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const obj = JSON.parse(stripped);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const optStr = (v: unknown): string | undefined => {
  const s = str(v);
  return s === '' ? undefined : s;
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

export function toDraft(
  assembled: { title: string; subtitle: string; body: string; description: string },
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

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function generateDraft(prompt: string, deps: LlmDeps): Promise<GenerateDraftResponse> {
  const { settings, apiKey } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ? deps.now() : new Date().toISOString();
  const id = deps.genId ? deps.genId() : `draft_${Date.now()}`;
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const facts = deps.facts ?? {};

  if (!apiKey || !settings.endpoint) {
    return { ok: false, kind: 'no-key', error: '后端未配置 API key 或端点。' };
  }
  if (!isHttps(settings.endpoint)) {
    return { ok: false, kind: 'network', error: 'endpoint 必须是 https:// 地址。' };
  }

  const modelsToTry = [settings.model];
  if (settings.fallbackModel && settings.fallbackModel.trim().length > 0) {
    modelsToTry.push(settings.fallbackModel.trim());
  }

  let res: Response | undefined;
  let lastErrorMsg = '服务返回错误,请重试。';

  for (const currentModel of modelsToTry) {
    let successInCurrentModel = false;
    for (const useSchema of [true, false]) {
      const { url, init } = buildRequest(prompt, { ...settings, model: currentModel }, apiKey, { jsonSchema: useSchema });
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
        const aborted = fetchErr instanceof Error && fetchErr.name === 'AbortError';
        lastErrorMsg = aborted ? '请求超时,请重试。' : '网络错误,请检查 endpoint 或网络后重试。';
        break;
      }

      if (res && res.ok) {
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

      return { ok: false, kind: 'network', error: `服务返回错误(${res!.status} ${res!.statusText})。` };
    }

    if (successInCurrentModel) break;
  }

  if (!res || !res.ok) {
    return { ok: false, kind: 'network', error: lastErrorMsg };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, kind: 'format', error: '响应不是合法 JSON(可能 endpoint 非 OpenAI 兼容格式)。' };
  }

  const content = extractContent(raw);
  if (content == null) {
    return { ok: false, kind: 'format', error: '响应结构与 OpenAI 兼容格式不符。' };
  }
  const parsed = parseContentJson(content);
  if (parsed == null) {
    return { ok: false, kind: 'format', error: '模型未返回合法 JSON 草稿,请调整 prompt 或重试。' };
  }

  const assembled = assembleDraft(slotsFromParsed(parsed), facts);
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(str).filter(Boolean) : [];
  const category = normalizeCategory(str(parsed.category));
  return { ok: true, draft: toDraft(assembled, category, tags, id, now) };
}

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };

export function modelsUrl(endpoint: string): string {
  const e = endpoint
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/+$/, '');
  return `${e}/models`;
}

export async function listModels(
  endpoint: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<ListModelsResult> {
  if (!apiKey || !endpoint) return { ok: false, error: '请先配置 API key 与 endpoint。' };
  if (!isHttps(endpoint)) return { ok: false, error: 'endpoint 必须是 https:// 地址。' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(modelsUrl(endpoint), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? '请求超时,请重试。' : '网络错误(可能 CORS 限制或 endpoint 不可达)。' };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { ok: false, error: `服务返回错误(${res.status} ${res.statusText})。` };

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { ok: false, error: '响应不是合法 JSON(可能非 OpenAI 兼容 /models)。' };
  }
  const data = (raw as { data?: unknown })?.data;
  if (!Array.isArray(data)) return { ok: false, error: '响应无 data 数组(可能非 OpenAI 兼容 /models)。' };

  const models = data
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  if (models.length === 0) return { ok: false, error: '模型列表为空。' };
  return { ok: true, models };
}

