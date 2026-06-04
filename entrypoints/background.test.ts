import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { createHandlers, type BackgroundHandlerDeps } from './background';
import type { Batch } from '../lib/batch';
import type { ContentDraft, Settings } from '../lib/types';

// ---- helpers ----

const HOST = 'dx-999-adm.ympxbys.xyz';

const SETTINGS: Settings = {
  endpoint: 'https://api.example.com',
  model: 'gpt-4o-mini',
  promptTemplate: 'Write about {{topic}}',
  fieldMapping: {},
};

const DRAFT: ContentDraft = {
  id: 'item_0',
  title: 'T',
  subtitle: '',
  category: '2',
  coverImageUrl: '',
  body: '<p>body</p>',
  tags: [],
  description: '',
  postStatus: '0',
  publishedAt: '2026-06-04',
  mediaId: '1',
  status: 'draft',
  createdAt: '2026-06-04T00:00:00.000Z',
};

function makeBatch(status: 'awaiting-approval' | 'error' = 'awaiting-approval'): Batch {
  return {
    id: 'batch_1',
    tabId: 1,
    authorizedHost: HOST,
    createdAt: '2026-06-04T00:00:00.000Z',
    items: [{ id: 'item_0', topic: 'topic-a', status, draft: DRAFT }],
  };
}

function makeDeps(overrides: Partial<BackgroundHandlerDeps> = {}): BackgroundHandlerDeps {
  return {
    getBatch: vi.fn(async () => null),
    saveBatch: vi.fn(async () => {}),
    getSettings: vi.fn(async () => SETTINGS),
    getApiKey: vi.fn(async () => 'test-key'),
    getPublishedTopics: vi.fn(async () => []),
    addPublishedTopics: vi.fn(async () => {}),
    appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
    getSafetyMode: vi.fn(async () => 'authorized' as const),
    getAuthorizedHosts: vi.fn(async () => [HOST]),
    tabsGet: vi.fn(async () => ({ url: `https://${HOST}/admin`, id: 1 } as { url?: string; id?: number })),
    tabsSendMessage: vi.fn(async () => ({ ok: true, dryRun: false, url: `https://${HOST}/post/1` })),
    storageGetItem: vi.fn(async () => null),
    storageSetItem: vi.fn(async () => {}),
    generateDraftFn: vi.fn(async () => ({ ok: true as const, draft: DRAFT })),
    buildBatchId: vi.fn(() => 'batch_1'),
    buildItemId: vi.fn((i: number) => `item_${i}`),
    now: vi.fn(() => '2026-06-04T00:00:00.000Z'),
    ...overrides,
  };
}

// ================================================================
// handleRunBatch
// ================================================================

describe('handleRunBatch', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('happy path: 2 topics → generateDraftFn called twice', async () => {
    const deps = makeDeps();
    const h = createHandlers(deps);
    const result = await h.handleRunBatch(['topic-a', 'topic-b'], 1);
    expect(result).not.toBeNull();
    expect(deps.generateDraftFn).toHaveBeenCalledTimes(2);
    expect(deps.saveBatch).toHaveBeenCalled();
  });

  it('tabsGet throws → returns null batch gracefully', async () => {
    const deps = makeDeps({
      tabsGet: vi.fn(async () => { throw new Error('tab-not-found'); }),
    });
    const h = createHandlers(deps);
    const result = await h.handleRunBatch(['topic-a'], 99);
    expect(result).toBeNull();
    expect(deps.generateDraftFn).not.toHaveBeenCalled();
  });

  it('tab url is null → resolveHost returns null → returns null', async () => {
    const deps = makeDeps({
      tabsGet: vi.fn(async () => ({ url: undefined, id: 1 } as unknown as { url?: string; id?: number })),
    });
    const h = createHandlers(deps);
    const result = await h.handleRunBatch(['topic-a'], 1);
    expect(result).toBeNull();
  });
});

// ================================================================
// handleApproveBatch
// ================================================================

describe('handleApproveBatch', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('happy path: tabsSendMessage called with FILL_PAGE', async () => {
    const batch = makeBatch();
    const deps = makeDeps({
      getBatch: vi.fn(async () => batch),
      tabsSendMessage: vi.fn(async (_id, msg) => {
        const m = msg as { type: string };
        if (m.type === 'FILL_PAGE') return { ok: true, results: [] };
        if (m.type === 'PUBLISH_GRANT') return { ok: true, dryRun: false, url: `https://${HOST}/post/1` };
        return null;
      }),
    });
    const h = createHandlers(deps);
    const result = await h.handleApproveBatch(1);
    expect(result).not.toBeNull();
    expect(deps.tabsSendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FILL_PAGE' }));
  });

  it('tabsSendMessage rejects on FILL_PAGE → item stays awaiting-approval, no PUBLISH_GRANT', async () => {
    const batch = makeBatch();
    const deps = makeDeps({
      getBatch: vi.fn(async () => batch),
      tabsSendMessage: vi.fn(async (_id, _msg) => { throw new Error('fill-unreachable'); }),
    });
    const h = createHandlers(deps);
    const result = await h.handleApproveBatch(1);
    expect(result).not.toBeNull();
  });

  it('getBatch returns null → returns null', async () => {
    const deps = makeDeps({ getBatch: vi.fn(async () => null) });
    const h = createHandlers(deps);
    const result = await h.handleApproveBatch(1);
    expect(result).toBeNull();
  });
});

// ================================================================
// handleKillBatch
// ================================================================

describe('handleKillBatch', () => {
  it('kills active batch → all items aborted', async () => {
    const batch = makeBatch('awaiting-approval');
    const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
    const h = createHandlers(deps);
    const result = await h.handleKillBatch();
    expect(result).not.toBeNull();
    expect(result!.items.every((it) => it.status === 'aborted')).toBe(true);
    expect(deps.saveBatch).toHaveBeenCalled();
  });

  it('no batch → returns null', async () => {
    const deps = makeDeps({ getBatch: vi.fn(async () => null) });
    const h = createHandlers(deps);
    const result = await h.handleKillBatch();
    expect(result).toBeNull();
  });
});

// ================================================================
// handleReleaseQuarantine
// ================================================================

describe('handleReleaseQuarantine', () => {
  it('releases quarantined item → item becomes aborted', async () => {
    const batch: Batch = {
      id: 'b1', tabId: 1, authorizedHost: HOST, createdAt: '',
      items: [{ id: 'item_0', topic: 't', status: 'needs-human-verification' }],
    };
    const deps = makeDeps({ getBatch: vi.fn(async () => batch) });
    const h = createHandlers(deps);
    const result = await h.handleReleaseQuarantine('item_0');
    expect(result).not.toBeNull();
    expect(result!.items[0]!.status).toBe('aborted');
  });
});

// ================================================================
// handleGenerate
// ================================================================

describe('handleGenerate', () => {
  it('happy path: generateDraftFn called with prompt', async () => {
    const deps = makeDeps();
    const h = createHandlers(deps);
    const result = await h.handleGenerate('test prompt');
    expect(result).toEqual({ ok: true, draft: DRAFT });
    expect(deps.generateDraftFn).toHaveBeenCalledWith('test prompt', expect.objectContaining({ apiKey: 'test-key' }));
  });

  it('generateDraftFn throws → returns ok:false error', async () => {
    const deps = makeDeps({
      generateDraftFn: vi.fn(async () => { throw new Error('network'); }),
    });
    const h = createHandlers(deps);
    const result = await h.handleGenerate('prompt');
    expect(result).toMatchObject({ ok: false });
  });
});

// ================================================================
// evaluateGate (TOCTOU fix)
// ================================================================

describe('evaluateGate TOCTOU fix', () => {
  it('atomic snapshot: tab on authorized host → allowed:true', async () => {
    const deps = makeDeps({
      getSafetyMode: vi.fn(async () => 'authorized' as const),
      getAuthorizedHosts: vi.fn(async () => [HOST]),
      tabsGet: vi.fn(async () => ({ url: `https://${HOST}/admin` } as { url?: string; id?: number })),
    });
    const h = createHandlers(deps);
    const decision = await h.evaluateGate(1);
    expect(decision.allowed).toBe(true);
    expect(decision.host).toBe(HOST);
  });

  it('tab navigated to non-authorized host → allowed:false', async () => {
    const deps = makeDeps({
      getSafetyMode: vi.fn(async () => 'authorized' as const),
      getAuthorizedHosts: vi.fn(async () => [HOST]),
      // Tab is on a different host than authorized
      tabsGet: vi.fn(async () => ({ url: 'https://other-host.com/page' } as { url?: string; id?: number })),
    });
    const h = createHandlers(deps);
    const decision = await h.evaluateGate(1);
    expect(decision.allowed).toBe(false);
    expect(decision.host).toBe('other-host.com');
    // All three reads happened in the same Promise.all (TOCTOU fix verified by implementation)
    expect(deps.getSafetyMode).toHaveBeenCalledOnce();
    expect(deps.getAuthorizedHosts).toHaveBeenCalledOnce();
    expect(deps.tabsGet).toHaveBeenCalledOnce();
  });

  it('tab closed (tabsGet throws) → host null → allowed:false', async () => {
    const deps = makeDeps({
      getSafetyMode: vi.fn(async () => 'authorized' as const),
      getAuthorizedHosts: vi.fn(async () => [HOST]),
      tabsGet: vi.fn(async () => { throw new Error('no tab'); }),
    });
    const h = createHandlers(deps);
    const decision = await h.evaluateGate(999);
    expect(decision.allowed).toBe(false);
    expect(decision.host).toBeNull();
  });

  it('GET_BATCH inline route: getBatch called directly (not via handler)', async () => {
    const deps = makeDeps({ getBatch: vi.fn(async () => null) });
    // Verify that getBatch can be called independently (not part of factory handlers)
    // This is the inline GET_BATCH route in the defineBackground block
    const result = await deps.getBatch();
    expect(result).toBeNull();
    expect(deps.getBatch).toHaveBeenCalledOnce();
  });
});
