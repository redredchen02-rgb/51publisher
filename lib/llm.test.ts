import { describe, it, expect, vi } from 'vitest';
import { generateDraft, toDraft, buildRequest } from './llm';
import { DEFAULT_SETTINGS } from './storage';
import type { Settings } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  endpoint: 'https://api.example.com/v1/chat/completions',
  model: 'gpt-4o-mini',
};

function mockFetch(payload: unknown, init?: { ok?: boolean; status?: number; statusText?: string; throwName?: string }) {
  return vi.fn(async () => {
    if (init?.throwName) {
      const e = new Error('boom');
      e.name = init.throwName;
      throw e;
    }
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      json: async () => payload,
    } as Response;
  });
}

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });
const base = { now: () => '2026-06-03T00:00:00.000Z', genId: () => 'draft_1' };

describe('generateDraft', () => {
  it('happy path:解析出完整 ContentDraft,status=draft', async () => {
    const content = JSON.stringify({
      title: '标题', subtitle: '副标题', category: '2', body: '<p>正文</p>',
      tags: ['奇幻', '冒險'], description: '摘要',
    });
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply(content)), ...base });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.title).toBe('标题');
      expect(res.draft.body).toBe('<p>正文</p>');
      expect(res.draft.tags).toEqual(['奇幻', '冒險']);
      expect(res.draft.status).toBe('draft');
      expect(res.draft.postStatus).toBe('1'); // 非 AI 默认值
      expect(res.draft.createdAt).toBe('2026-06-03T00:00:00.000Z');
    }
  });

  it('content 带 ```json 围栏也能解析', async () => {
    const content = '```json\n{"title":"T","body":"B"}\n```';
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply(content)), ...base });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.title).toBe('T');
  });

  it('缺字段降级填空串,不崩溃', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply('{"title":"只有标题"}')), ...base });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.title).toBe('只有标题');
      expect(res.draft.body).toBe('');
      expect(res.draft.tags).toEqual([]);
    }
  });

  it('未配置 key/endpoint → no-key,不发请求', async () => {
    const f = mockFetch(oaiReply('{}'));
    const res = await generateDraft('主题', { settings: { ...settings }, apiKey: '', fetchFn: f, ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('no-key');
    expect(f).not.toHaveBeenCalled();
  });

  it('endpoint 非 https → 拒绝', async () => {
    const f = mockFetch(oaiReply('{}'));
    const res = await generateDraft('主题', { settings: { ...settings, endpoint: 'http://insecure.com' }, apiKey: 'k', fetchFn: f, ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('network');
    expect(f).not.toHaveBeenCalled();
  });

  it('4xx/5xx → 结构化 network 错误,不含鉴权信息', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch({}, { ok: false, status: 401, statusText: 'Unauthorized' }), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.error).not.toMatch(/Bearer|apiKey|Authorization/i);
    }
  });

  it('超时(AbortError)→ 可重试网络错误', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch({}, { throwName: 'AbortError' }), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.error).toMatch(/超时/);
    }
  });

  it('响应非 OpenAI 结构 → format 错误', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch({ unexpected: true }), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('format');
  });

  it('content 非 JSON → format 错误', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply('就是一段普通文字,不是 JSON')), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('format');
  });
});

describe('buildRequest', () => {
  it('注入 Bearer 鉴权头与 JSON body', () => {
    const { url, init } = buildRequest('hi', settings, 'secret');
    expect(url).toBe(settings.endpoint);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini');
  });
});

describe('toDraft', () => {
  it('tags 非数组时安全降级为空数组', () => {
    const d = toDraft({ title: 'x', tags: 'notarray' }, 'id1', '2026-06-03T00:00:00.000Z');
    expect(d.tags).toEqual([]);
    expect(d.id).toBe('id1');
  });
});
