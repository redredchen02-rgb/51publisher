import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateDraft, listModels } from './llm';
import type { Settings } from '@51publisher/shared';

vi.mock('./auth-client', () => ({
  getToken: vi.fn(async () => null),
  clearToken: vi.fn(async () => {}),
}));

function mockFetch(
  payload: unknown,
  init?: { ok?: boolean; status?: number; statusText?: string; throwName?: string },
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
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as Response;
  });
}

const settings: Settings = {
  endpoint: 'http://127.0.0.1:3001',
  model: 'gpt-4o-mini',
  fallbackModel: '',
  promptTemplate: 'test template',
  fewShotExamples: 'test few shot',
  fieldMapping: {},
};

describe('Extension LLM client proxy', () => {
  it('generateDraft forwards options to backend server', async () => {
    const fakeDraft = { id: 'draft_1', title: 'hello', body: 'body content' };
    const f = mockFetch({ ok: true, draft: fakeDraft });

    const res = await generateDraft('hi', {
      settings,
      apiKey: '',
      facts: {},
      fetchFn: f,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.draft.title).toBe('hello');
    }
    expect(f).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/v1/drafts/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prompt: 'hi',
          settings,
          facts: {},
        }),
      }),
    );
  });

  it('generateDraft returns error when backend returns non-ok response', async () => {
    const f = mockFetch({ error: 'Backend error' }, { ok: false, status: 500 });

    const res = await generateDraft('hi', {
      settings,
      apiKey: '',
      facts: {},
      fetchFn: f,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Backend error');
    }
  });

  it('listModels calls backend list models endpoint', async () => {
    const f = mockFetch({ ok: true, models: ['model-1', 'model-2'] });

    const res = await listModels('http://127.0.0.1:3001', '', f);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.models).toEqual(['model-1', 'model-2']);
    }
    expect(f).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/v1/models',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
});
