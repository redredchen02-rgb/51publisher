import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBatch, approveBatch, retryItem } from './batch-orchestrator';
import type { RunBatchDeps, ApproveBatchDeps, RetryItemDeps } from './batch-orchestrator';
import type { Batch } from './batch';
import type { ContentDraft } from './types';

// ---- helpers ----

const TOPIC_A = 'topic-a';
const TOPIC_B = 'topic-b';
const HOST = 'dx-999-adm.ympxbys.xyz';

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

function makeRunDeps(overrides: Partial<RunBatchDeps> = {}): RunBatchDeps {
  return {
    topics: [TOPIC_A, TOPIC_B],
    tabId: 1,
    resolveHost: vi.fn(async () => HOST),
    getExistingBatch: vi.fn(async () => null),
    pinnedHostOk: vi.fn(async () => true),
    generateDraft: vi.fn(async () => ({ ok: true as const, draft: { ...DRAFT } })),
    save: vi.fn(async () => {}),
    genBatchId: vi.fn(() => 'batch_1'),
    genItemId: vi.fn((i: number) => `item_${i}`),
    now: vi.fn(() => '2026-06-04T00:00:00.000Z'),
    ...overrides,
  };
}

function makeApproveDeps(overrides: Partial<ApproveBatchDeps> = {}): ApproveBatchDeps {
  return {
    getBatch: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    pinnedHostOk: vi.fn(async () => true),
    sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
    evaluateGate: vi.fn(async () => ({ mode: 'authorized' as const, allowed: true, host: HOST })),
    sendGrant: vi.fn(async () => ({ ok: true, dryRun: false, url: 'https://dx-999-adm.ympxbys.xyz/post/1' })),
    appendTrajectory: vi.fn(async () => ({ snapshotDropped: false })),
    ...overrides,
  };
}

/** 生成一个含 N 条 awaiting-approval 条目的 batch(用于 approveBatch 测试)。 */
function makeAwaitingBatch(topics: string[] = [TOPIC_A]): Batch {
  return {
    id: 'batch_1',
    tabId: 1,
    authorizedHost: HOST,
    createdAt: '2026-06-04T00:00:00.000Z',
    items: topics.map((topic, i) => ({
      id: `item_${i}`,
      topic,
      status: 'awaiting-approval' as const,
      draft: { ...DRAFT, id: `item_${i}` },
    })),
  };
}

// ================================================================
// runBatch
// ================================================================

describe('runBatch', () => {
  it('happy path: 2 个 topic 均生成成功 → 全部 awaiting-approval', async () => {
    const deps = makeRunDeps();
    const result = await runBatch(deps);
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.items.every((it) => it.status === 'awaiting-approval')).toBe(true);
    // generateDraft 被调用 2 次
    expect(deps.generateDraft).toHaveBeenCalledTimes(2);
    // 签名改为 (topic, facts);无事实时 facts=undefined。
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, undefined);
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_B, undefined);
  });

  it('源接地:facts 与 topics 同序平行,透传给 generateDraft 并落到 item.facts', async () => {
    const factsA = { 作品名: 'A作', 漢化: 'https://h/a' };
    const factsB = { 作品名: 'B作' };
    const deps = makeRunDeps({ facts: [factsA, factsB] });
    const result = await runBatch(deps);
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, factsA);
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_B, factsB);
    expect(result!.items[0]!.facts).toEqual(factsA);
    expect(result!.items[1]!.facts).toEqual(factsB);
  });

  it('重入闸:默认过滤已发布选题(persistentBlockedTopics)', async () => {
    const deps = makeRunDeps({ persistentBlockedTopics: [TOPIC_A] });
    const result = await runBatch(deps);
    expect(result!.items.map((it) => it.topic)).toEqual([TOPIC_B]);
  });

  it('R8 迭代通道:bypassReentry=true 时不过滤已发布选题(可重跑对比)', async () => {
    const deps = makeRunDeps({ persistentBlockedTopics: [TOPIC_A], bypassReentry: true });
    const result = await runBatch(deps);
    expect(result!.items.map((it) => it.topic)).toEqual([TOPIC_A, TOPIC_B]);
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, undefined);
  });

  it('tab 漂移中断: pinnedHostOk 第 2 次返回 false → 只生成第 1 条', async () => {
    let call = 0;
    const deps = makeRunDeps({
      pinnedHostOk: vi.fn(async () => {
        call += 1;
        return call === 1; // 第 1 次 ok,第 2 次漂移
      }),
    });
    const result = await runBatch(deps);
    expect(result).not.toBeNull();
    // generateDraft 只被调 1 次(第 2 条因漂移跳过)
    expect(deps.generateDraft).toHaveBeenCalledTimes(1);
  });

  it('生成失败降级: 第 1 条失败 → error;第 2 条继续成功', async () => {
    let call = 0;
    const deps = makeRunDeps({
      generateDraft: vi.fn(async () => {
        call += 1;
        if (call === 1) return { ok: false as const, error: 'network', kind: 'network' as const };
        return { ok: true as const, draft: { ...DRAFT } };
      }),
    });
    const result = await runBatch(deps);
    expect(result).not.toBeNull();
    const statuses = result!.items.map((it) => it.status);
    // 第 1 条 error,第 2 条 awaiting-approval
    expect(statuses[0]).toBe('error');
    expect(statuses[1]).toBe('awaiting-approval');
  });

  it('重入守卫: topic-a 已被隔离 → 只生成 topic-b', async () => {
    const quarantinedBatch: Batch = {
      id: 'old_batch',
      tabId: 1,
      authorizedHost: HOST,
      createdAt: '2026-06-04T00:00:00.000Z',
      items: [{ id: 'old_0', topic: TOPIC_A, status: 'needs-human-verification' }],
    };
    const deps = makeRunDeps({
      getExistingBatch: vi.fn(async () => quarantinedBatch),
      topics: [TOPIC_A, TOPIC_B],
    });
    const result = await runBatch(deps);
    expect(result).not.toBeNull();
    // TOPIC_A 被过滤,只生成 TOPIC_B
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0]!.topic).toBe(TOPIC_B);
  });

  it('host 解析失败 → 返回 null,不创建批次', async () => {
    const deps = makeRunDeps({ resolveHost: vi.fn(async () => null) });
    const result = await runBatch(deps);
    expect(result).toBeNull();
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.generateDraft).not.toHaveBeenCalled();
  });
});

// ================================================================
// approveBatch
// ================================================================

describe('approveBatch', () => {
  it('happy path (authorized 真发): 条目变 publish-confirmed,appendTrajectory 被调 1 次', async () => {
    const batch = makeAwaitingBatch();
    const deps = makeApproveDeps({ getBatch: vi.fn(async () => batch) });
    const result = await approveBatch(deps);
    expect(result).not.toBeNull();
    expect(result!.items[0]!.status).toBe('publish-confirmed');
    expect(deps.sendGrant).toHaveBeenCalledOnce();
    expect(deps.appendTrajectory).toHaveBeenCalledOnce();
  });

  it('填充失败: sendFill 返回 ok:false → 条目留在 awaiting-approval(markGenerateFailed 对此状态无效,已知行为),sendGrant/appendTrajectory 不被调', async () => {
    // markGenerateFailed 仅接受 queued/generating/filled,awaiting-approval 转移无效 → 状态不变。
    // 这是与 background.ts 原始行为的语义一致:不改动 batch.ts 状态机。
    const batch = makeAwaitingBatch();
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      sendFill: vi.fn(async () => ({ ok: false as const, error: 'fill-unreachable' })),
    });
    const result = await approveBatch(deps);
    expect(result).not.toBeNull();
    // 状态维持 awaiting-approval(原 background.ts 同等行为)
    expect(result!.items[0]!.status).toBe('awaiting-approval');
    expect(deps.sendGrant).not.toHaveBeenCalled();
    expect(deps.appendTrajectory).not.toHaveBeenCalled();
  });

  it('闸门拒绝 (blocked): evaluateGate allowed=false → 条目留在 awaiting-approval,循环 break', async () => {
    // blocked:orchestratePublish 返回 { ok:false, dryRun:false, error:'blocked' }。
    // writeConfirmed 不被 orchestratePublish 调用 → 状态留在 awaiting-approval。
    // !result.dryRun → appendTrajectory 被调 1 次(与原 background.ts 行为一致)。
    const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      evaluateGate: vi.fn(async () => ({ mode: 'authorized' as const, allowed: false, host: HOST })),
    });
    const result = await approveBatch(deps);
    expect(result).not.toBeNull();
    // 两条都留在 awaiting-approval
    expect(result!.items.every((it) => it.status === 'awaiting-approval')).toBe(true);
    expect(deps.sendGrant).not.toHaveBeenCalled();
    // appendTrajectory 被调:blocked 时 dryRun=false,记录第一条条目的尝试(原始行为)
    expect(deps.appendTrajectory).toHaveBeenCalledOnce();
    // 第 2 条因 break 未处理 → sendFill 只调 1 次
    expect(deps.sendFill).toHaveBeenCalledOnce();
  });

  it('dry-run: sendGrant 不被调,条目状态不变,appendTrajectory 不被调', async () => {
    const batch = makeAwaitingBatch();
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      evaluateGate: vi.fn(async () => ({ mode: 'dry-run' as const, allowed: false, host: HOST })),
    });
    const result = await approveBatch(deps);
    expect(result).not.toBeNull();
    expect(result!.items[0]!.status).toBe('awaiting-approval'); // 未变
    expect(deps.sendGrant).not.toHaveBeenCalled();
    expect(deps.appendTrajectory).not.toHaveBeenCalled();
  });

  it('tab 漂移: pinnedHostOk 返回 false → 循环 break,sendFill 不被调', async () => {
    const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      pinnedHostOk: vi.fn(async () => false),
    });
    const result = await approveBatch(deps);
    expect(result).not.toBeNull();
    expect(deps.sendFill).not.toHaveBeenCalled();
    expect(deps.sendGrant).not.toHaveBeenCalled();
  });

  it('快照丢弃: appendTrajectory 返回 snapshotDropped=true → onSnapshotDropped 被调', async () => {
    const batch = makeAwaitingBatch();
    const onDropped = vi.fn();
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      appendTrajectory: vi.fn(async () => ({ snapshotDropped: true })),
      onSnapshotDropped: onDropped,
    });
    await approveBatch(deps);
    expect(onDropped).toHaveBeenCalledOnce();
    expect(onDropped).toHaveBeenCalledWith('item_0');
  });
});

// ================================================================
// approveBatch — dry-run report (U6)
// ================================================================

describe('approveBatch dry-run report', () => {
  it('dry-run: saveDryRunReportFn called with 1 item containing fillResults', async () => {
    const batch = makeAwaitingBatch([TOPIC_A]);
    const saveFn = vi.fn(async () => {});
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      evaluateGate: vi.fn(async () => ({ mode: 'dry-run' as const, allowed: false, host: HOST })),
      sendFill: vi.fn(async () => ({ ok: true as const, results: [{ field: 'title', status: 'filled' as const }] })),
      saveDryRunReportFn: saveFn,
    });
    await approveBatch(deps);
    expect(saveFn).toHaveBeenCalledOnce();
    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: 'batch_1',
        items: expect.arrayContaining([
          expect.objectContaining({
            topic: TOPIC_A,
            fillResults: [{ field: 'title', status: 'filled' }],
          }),
        ]),
      }),
    );
  });

  it('dry-run: saveDryRunReportFn called with correct count for 2 items', async () => {
    const batch = makeAwaitingBatch([TOPIC_A, TOPIC_B]);
    const saveFn = vi.fn(async () => {});
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      evaluateGate: vi.fn(async () => ({ mode: 'dry-run' as const, allowed: false, host: HOST })),
      sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
      saveDryRunReportFn: saveFn,
    });
    await approveBatch(deps);
    expect(saveFn).toHaveBeenCalledOnce();
    expect(saveFn).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining([expect.anything(), expect.anything()]) }));
  });

  it('authorized (non-dry-run): saveDryRunReportFn NOT called', async () => {
    const batch = makeAwaitingBatch([TOPIC_A]);
    const saveFn = vi.fn(async () => {});
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      saveDryRunReportFn: saveFn,
    });
    await approveBatch(deps);
    expect(saveFn).not.toHaveBeenCalled();
  });
});

// ================================================================
// approveBatch — tombstone protocol (U5)
// ================================================================

describe('approveBatch tombstone protocol', () => {
  it('tombstone written before sendFill, cleared after successful fill', async () => {
    const batch = makeAwaitingBatch([TOPIC_A]);
    const callOrder: string[] = [];
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      sendFill: vi.fn(async () => { callOrder.push('sendFill'); return { ok: true as const, results: [] }; }),
      writeTombstone: vi.fn(async () => { callOrder.push('write'); }),
      clearTombstone: vi.fn(async () => { callOrder.push('clear'); }),
    });
    await approveBatch(deps);
    expect(callOrder).toEqual(['write', 'sendFill', 'clear']);
  });

  it('sendFill fails: tombstone still cleared (item enters error, not limbo)', async () => {
    const batch = makeAwaitingBatch([TOPIC_A]);
    const clearTombstone = vi.fn(async () => {});
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      sendFill: vi.fn(async () => ({ ok: false as const, error: 'fill-fail' })),
      writeTombstone: vi.fn(async () => {}),
      clearTombstone,
    });
    await approveBatch(deps);
    expect(clearTombstone).toHaveBeenCalledWith('item_0');
  });
});

describe('approveBatch dry-run report', () => {
  it('saveDryRunReportFn throws: approveBatch does not rethrow', async () => {
    const batch = makeAwaitingBatch([TOPIC_A]);
    const deps = makeApproveDeps({
      getBatch: vi.fn(async () => batch),
      evaluateGate: vi.fn(async () => ({ mode: 'dry-run' as const, allowed: false, host: HOST })),
      sendFill: vi.fn(async () => ({ ok: true as const, results: [] })),
      saveDryRunReportFn: vi.fn(async () => { throw new Error('storage-fail'); }),
    });
    await expect(approveBatch(deps)).resolves.not.toThrow();
  });
});

// ================================================================
// retryItem (U7)
// ================================================================

describe('retryItem', () => {
  function makeRetryDeps(batch: Batch, overrides: Partial<RetryItemDeps> = {}): RetryItemDeps {
    return {
      getBatch: vi.fn(async () => batch),
      save: vi.fn(async () => {}),
      generateDraft: vi.fn(async () => ({ ok: true as const, draft: { ...DRAFT } })),
      ...overrides,
    };
  }

  function errorBatch(topic: string): Batch {
    return {
      id: 'batch_1', tabId: 1, authorizedHost: HOST, createdAt: '',
      items: [{ id: 'item_0', topic, status: 'error' as const, error: 'prev-error' }],
    };
  }

  it('happy path: error item retried → awaiting-approval, generateDraft called once', async () => {
    const batch = errorBatch(TOPIC_A);
    const deps = makeRetryDeps(batch);
    const result = await retryItem(deps, 'item_0');
    expect(result).not.toBeNull();
    expect(result!.items[0]!.status).toBe('awaiting-approval');
    expect(deps.generateDraft).toHaveBeenCalledOnce();
    expect(deps.generateDraft).toHaveBeenCalledWith(TOPIC_A, undefined);
  });

  it('other items in batch not modified', async () => {
    const batch: Batch = {
      id: 'batch_1', tabId: 1, authorizedHost: HOST, createdAt: '',
      items: [
        { id: 'item_0', topic: TOPIC_A, status: 'error' as const },
        { id: 'item_1', topic: TOPIC_B, status: 'publish-confirmed' as const },
      ],
    };
    const deps = makeRetryDeps(batch);
    const result = await retryItem(deps, 'item_0');
    expect(result!.items[1]!.status).toBe('publish-confirmed');
  });

  it('generateDraft fails: item marked error again, no throw', async () => {
    const batch = errorBatch(TOPIC_A);
    const deps = makeRetryDeps(batch, {
      generateDraft: vi.fn(async () => ({ ok: false as const, error: 'network', kind: 'network' as const })),
    });
    const result = await retryItem(deps, 'item_0');
    expect(result).not.toBeNull();
    expect(result!.items[0]!.status).toBe('error');
    expect(result!.items[0]!.error).toBe('network');
  });

  it('no batch: returns null', async () => {
    const deps = makeRetryDeps(errorBatch(TOPIC_A), { getBatch: vi.fn(async () => null) });
    const result = await retryItem(deps, 'item_0');
    expect(result).toBeNull();
  });

  it('save called at least twice: once after retryBatchItem, once after presentForApproval', async () => {
    const batch = errorBatch(TOPIC_A);
    const save = vi.fn(async () => {});
    const deps = makeRetryDeps(batch, { save });
    await retryItem(deps, 'item_0');
    expect(save).toHaveBeenCalledTimes(3); // queued, generating, filled+approval
  });
});
