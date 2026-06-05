import type { ContentDraft, GenerateDraftResponse, Settings } from './types';
import type { FactsBlock } from './facts';
import { assembleDraft, type AssembledDraft, type DraftSlots } from './post-assembler';
import { normalizeCategory } from './vocab';

// 窄 provider adapter:首版只实现 OpenAI 兼容 chat/completions。
// 换厂商 = 加一个 buildRequest/parseResponse,而非改 background。
//
// 程序化结构化生成(U2):模型只回「叙事槽位」(intro/highlights/套话),不回 body;
// 程式用 assembleDraft 把 facts verbatim 注入正文。response_format 优先 json_schema strict,
// 端点不支持(400)则回落 json_object —— 真正的安全网是 assembleDraft,strict 只是锦上添花。

export interface LlmDeps {
  settings: Settings;
  apiKey: string;
  /** 源接地事实块:供 assembleDraft 把作品名/集数/连结 verbatim 注入正文。省略=零事实(全骨架【待补】)。 */
  facts?: FactsBlock;
  /** 注入点,便于测试。 */
  fetchFn?: typeof fetch;
  now?: () => string;
  genId?: () => string;
  timeoutMs?: number;
}

/** 模型叙事槽位的 JSON Schema(strict)。无 body 字段 —— 正文由程式组装。 */
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

/**
 * 从 endpoint 派生 chat/completions 完整地址:已含则原样,只给 base(如 .../v1)则补全。
 * 让用户既可填完整地址,也可只填 base URL。
 */
export function chatCompletionsUrl(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(e) ? e : `${e}/chat/completions`;
}

/** 从 endpoint 派生 /models 地址(剥掉尾部 /chat/completions 再补 /models)。 */
export function modelsUrl(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
  return `${e}/models`;
}

/** 组装 OpenAI 兼容请求。鉴权头在此注入(绝不硬编码、绝不进日志)。 */
export function buildRequest(
  prompt: string,
  settings: Settings,
  apiKey: string,
  opts: { jsonSchema?: boolean } = {},
): BuiltRequest {
  const response_format = opts.jsonSchema
    ? ({ type: 'json_schema' as const, json_schema: DRAFT_SLOTS_SCHEMA })
    : ({ type: 'json_object' as const });
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

export type ListModelsResult = { ok: true; models: string[] } | { ok: false; error: string };

/**
 * 拉取模型列表(GET {base}/models)。结构化错误,绝不在错误里带 key。
 * 供设置页"填 base+key → 拉模型 → 选择"用。
 */
export async function listModels(
  endpoint: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<ListModelsResult> {
  if (!apiKey || !endpoint) return { ok: false, error: '请先填写 endpoint 与 API key。' };
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

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 从 OpenAI 兼容响应里抠出 content 文本。 */
function extractContent(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** content 可能被 ```json 围栏包裹,剥掉后 JSON.parse。 */
function parseContentJson(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(stripped);
    // 必须是普通对象:拒绝数组与标量(它们 JSON.parse 也成功但不是草稿结构)。
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 非空字符串 → 该值;否则 undefined(供 DraftSlots 可选字段)。 */
const optStr = (v: unknown): string | undefined => {
  const s = str(v);
  return s === '' ? undefined : s;
};

/** 从模型 JSON 抠出叙事槽位;忽略任何 body 字段(正文由程式组装,旧式返回向后容错)。 */
export function slotsFromParsed(parsed: Record<string, unknown>): DraftSlots {
  return {
    titleSuffix: optStr(parsed.titleSuffix),
    subtitle: optStr(parsed.subtitle),
    intro: str(parsed.intro),
    highlights: str(parsed.highlights),
    outro: optStr(parsed.outro),
  };
}

/** 组装好的 title/subtitle/body/description + 模型给的 category/tags → ContentDraft。 */
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
    // 非 AI 字段:取默认,由 side panel 人工调整。
    postStatus: '1',
    publishedAt: '',
    mediaId: '',
    status: 'draft',
    createdAt: now,
  };
}

/** 校验 endpoint:必须为 https(防 key 经明文/内网外泄)。 */
function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 生成一条草稿。全部错误结构化返回,绝不抛未捕获异常,绝不在错误里带 key/鉴权头。
 */
export async function generateDraft(prompt: string, deps: LlmDeps): Promise<GenerateDraftResponse> {
  const { settings, apiKey } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ? deps.now() : new Date().toISOString();
  const id = deps.genId ? deps.genId() : `draft_${Date.now()}`;
  const timeoutMs = deps.timeoutMs ?? 60_000;
  const facts = deps.facts ?? {};

  if (!apiKey || !settings.endpoint) {
    return { ok: false, kind: 'no-key', error: '请先在设置页配置 API key 与 endpoint。' };
  }
  if (!isHttps(settings.endpoint)) {
    return { ok: false, kind: 'network', error: 'endpoint 必须是 https:// 地址。' };
  }

  // 先试 json_schema strict;端点不支持(400)→ 回落 json_object 重试一次。
  let res: Response | undefined;
  for (const useSchema of [true, false]) {
    const { url, init } = buildRequest(prompt, settings, apiKey, { jsonSchema: useSchema });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetchFn(url, { ...init, signal: controller.signal });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return { ok: false, kind: 'network', error: aborted ? '请求超时,请重试。' : '网络错误,请检查 endpoint 或网络后重试。' };
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) break;
    // schema 尝试遇 400(多为端点不支持 response_format)→ 回落 json_object 再试一次。
    if (useSchema && res.status === 400) continue;
    // 只用状态码/文本,绝不回传响应头或请求头。
    return { ok: false, kind: 'network', error: `服务返回错误(${res.status} ${res.statusText})。` };
  }
  if (!res || !res.ok) {
    return { ok: false, kind: 'network', error: '服务返回错误,请重试。' };
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

  // 程序化组装:facts verbatim 注入正文,模型只贡献口吻槽位。
  const assembled = assembleDraft(slotsFromParsed(parsed), facts);
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(str).filter(Boolean) : [];
  // 分类归一化:模型自由文字(「同人」「成人動畫」)→ 后台真实 label,避免填充 degrade。
  const category = normalizeCategory(str(parsed.category));
  return { ok: true, draft: toDraft(assembled, category, tags, id, now) };
}
