import { describe, it, expect, vi } from 'vitest';
import { generateDraft, toDraft, buildRequest, chatCompletionsUrl, modelsUrl, listModels } from './llm';
import { DEFAULT_SETTINGS } from './storage';
import type { Settings } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  endpoint: 'https://api.example.com/v1/chat/completions',
  model: 'gpt-4o-mini',
};

function mockFetch(
  payload: unknown,
  init?: { ok?: boolean; status?: number; statusText?: string; throwName?: string; throwJson?: boolean },
) {
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
      json: async () => {
        if (init?.throwJson) throw new SyntaxError('invalid json');
        return payload;
      },
    } as Response;
  });
}

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });
const base = { now: () => '2026-06-03T00:00:00.000Z', genId: () => 'draft_1' };

describe('chatCompletionsUrl / modelsUrl', () => {
  it('base URL → 补全 chat/completions 与 models', () => {
    expect(chatCompletionsUrl('https://h.com/v1')).toBe('https://h.com/v1/chat/completions');
    expect(modelsUrl('https://h.com/v1')).toBe('https://h.com/v1/models');
  });
  it('完整地址 → chat 原样、models 剥换', () => {
    expect(chatCompletionsUrl('https://h.com/v1/chat/completions')).toBe('https://h.com/v1/chat/completions');
    expect(modelsUrl('https://h.com/v1/chat/completions')).toBe('https://h.com/v1/models');
  });
  it('容忍尾斜杠', () => {
    expect(chatCompletionsUrl('https://h.com/v1/')).toBe('https://h.com/v1/chat/completions');
    expect(modelsUrl('https://h.com/v1/')).toBe('https://h.com/v1/models');
  });
});

describe('buildRequest', () => {
  it('用派生的 chat/completions 地址(支持 base URL)', () => {
    const r = buildRequest('p', { ...settings, endpoint: 'https://h.com/v1' }, 'k');
    expect(r.url).toBe('https://h.com/v1/chat/completions');
  });
});

describe('listModels', () => {
  it('happy path:解析 data[].id 并排序', async () => {
    const f = mockFetch({ data: [{ id: 'gpt-4o' }, { id: 'claude-3' }, { id: 'gpt-4o-mini' }] });
    const r = await listModels('https://h.com/v1', 'k', f);
    expect(r).toEqual({ ok: true, models: ['claude-3', 'gpt-4o', 'gpt-4o-mini'] });
    // 打到 /models
    expect(f).toHaveBeenCalledWith('https://h.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer k' } }));
  });
  it('缺 key/endpoint → 结构化错误,不发请求', async () => {
    const f = mockFetch({});
    expect(await listModels('', 'k', f)).toEqual({ ok: false, error: expect.stringContaining('endpoint') });
    expect(f).not.toHaveBeenCalled();
  });
  it('非 https → 拒绝', async () => {
    const r = await listModels('http://h.com/v1', 'k', mockFetch({}));
    expect(r.ok).toBe(false);
  });
  it('HTTP 错误 → 结构化错误', async () => {
    const r = await listModels('https://h.com/v1', 'k', mockFetch({}, { ok: false, status: 401, statusText: 'Unauthorized' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('401') });
  });
  it('无 data 数组 → 错误', async () => {
    const r = await listModels('https://h.com/v1', 'k', mockFetch({ nope: true }));
    expect(r.ok).toBe(false);
  });
  it('超时 → 提示重试', async () => {
    const r = await listModels('https://h.com/v1', 'k', mockFetch({}, { throwName: 'AbortError' }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('超时') });
  });
});

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

  it('res.json() 抛错 → format 错误(响应体非 JSON)', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(null, { throwJson: true }), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('format');
  });

  it('非 AbortError 的 fetch 异常 → 通用网络错误', async () => {
    const res = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch({}, { throwName: 'TypeError' }), ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.kind).toBe('network');
      expect(res.error).toMatch(/网络错误/);
      expect(res.error).not.toMatch(/超时/);
    }
  });

  it('content 是合法 JSON 但非对象(标量/数组)→ format 错误', async () => {
    const scalar = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply('"只是字符串"')), ...base });
    expect(scalar.ok).toBe(false);
    if (!scalar.ok) expect(scalar.kind).toBe('format');
    const arr = await generateDraft('主题', { settings, apiKey: 'k', fetchFn: mockFetch(oaiReply('[1,2,3]')), ...base });
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.kind).toBe('format');
  });

  it('畸形 endpoint URL → network,且不发请求', async () => {
    const f = mockFetch(oaiReply('{}'));
    const res = await generateDraft('主题', { settings: { ...settings, endpoint: 'not a url' }, apiKey: 'k', fetchFn: f, ...base });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('network');
    expect(f).not.toHaveBeenCalled();
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
