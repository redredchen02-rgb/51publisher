import type { ContentDraft, GenerateDraftResponse, Settings } from './types';

// 窄 provider adapter:首版只实现 OpenAI 兼容 chat/completions。
// 换厂商 = 加一个 buildRequest/parseResponse,而非改 background。

export interface LlmDeps {
  settings: Settings;
  apiKey: string;
  /** 注入点,便于测试。 */
  fetchFn?: typeof fetch;
  now?: () => string;
  genId?: () => string;
  timeoutMs?: number;
}

interface BuiltRequest {
  url: string;
  init: RequestInit;
}

/** 组装 OpenAI 兼容请求。鉴权头在此注入(绝不硬编码、绝不进日志)。 */
export function buildRequest(prompt: string, settings: Settings, apiKey: string): BuiltRequest {
  const body = {
    model: settings.model,
    messages: [{ role: 'user', content: prompt }],
    // 鼓励模型返回 JSON 对象。
    response_format: { type: 'json_object' as const },
  };
  return {
    url: settings.endpoint,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    },
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** 从 OpenAI 兼容响应里抠出 content 文本。 */
function extractContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** content 可能被 ```json 围栏包裹,剥掉后 JSON.parse。 */
function parseContentJson(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(stripped);
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 把解析出的对象映射为 ContentDraft;缺字段降级填空串,不崩溃。 */
export function toDraft(parsed: Record<string, unknown>, id: string, now: string): ContentDraft {
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(str).filter(Boolean) : [];
  return {
    id,
    title: str(parsed.title),
    subtitle: str(parsed.subtitle),
    category: str(parsed.category),
    coverImageUrl: str(parsed.coverImageUrl),
    body: str(parsed.body),
    tags,
    description: str(parsed.description),
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

  if (!apiKey || !settings.endpoint) {
    return { ok: false, kind: 'no-key', error: '请先在设置页配置 API key 与 endpoint。' };
  }
  if (!isHttps(settings.endpoint)) {
    return { ok: false, kind: 'network', error: 'endpoint 必须是 https:// 地址。' };
  }

  const { url, init } = buildRequest(prompt, settings, apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: controller.signal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, kind: 'network', error: aborted ? '请求超时,请重试。' : '网络错误,请检查 endpoint 或网络后重试。' };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 只用状态码/文本,绝不回传响应头或请求头。
    return { ok: false, kind: 'network', error: `服务返回错误(${res.status} ${res.statusText})。` };
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

  return { ok: true, draft: toDraft(parsed, id, now) };
}
