import { describe, it, expect } from 'vitest';
import {
  createBatch,
  markGenerating,
  markFilled,
  markGenerateFailed,
  presentForApproval,
  markDispatched,
  markConfirmed,
  markPublishFailed,
  abortBatch,
  recoverBatch,
  releaseQuarantine,
  quarantinedTopics,
  filterReentrantTopics,
  batchPhase,
  batchSummary,
  retryBatchItem,
  type Batch,
} from './batch';
import type { ContentDraft } from './types';

const genId = (i: number) => `item_${i}`;

function draftFor(id: string): ContentDraft {
  return {
    id: `draft_${id}`,
    title: 't',
    subtitle: '',
    category: '2',
    coverImageUrl: '',
    body: '<p>正文</p>',
    tags: [],
    description: '',
    postStatus: '0',
    publishedAt: '',
    mediaId: '1',
    status: 'draft',
    createdAt: '2026-06-04T00:00:00.000Z',
  };
}

function newBatch(topics: string[]): Batch {
  return createBatch('b1', 42, 'dx-999-adm.ympxbys.xyz', topics, '2026-06-04T00:00:00.000Z', genId);
}

/** 推到全 awaiting-approval。 */
function fillAll(batch: Batch): Batch {
  let b = batch;
  for (const it of batch.items) {
    b = markGenerating(b, it.id);
    b = markFilled(b, it.id, draftFor(it.id));
  }
  return presentForApproval(b);
}

describe('batch 状态机', () => {
  it('happy:3 选题 → 全 awaiting-approval;approve→dispatched→confirmed→done', () => {
    let b = newBatch(['里番A', '里番B', '里番C']);
    expect(batchPhase(b)).toBe('generating');
    b = fillAll(b);
    expect(b.items.every((it) => it.status === 'awaiting-approval')).toBe(true);
    expect(batchPhase(b)).toBe('awaiting-approval');

    // 逐条 approve→发布
    b = markDispatched(b, 'item_0');
    expect(batchPhase(b)).toBe('publishing');
    b = markConfirmed(b, 'item_0', 'https://dx-999-adm.ympxbys.xyz/post/1');
    expect(b.items[0]!.status).toBe('publish-confirmed');
    expect(b.items[0]!.publishUrl).toContain('/post/1');

    for (const id of ['item_1', 'item_2']) {
      b = markConfirmed(markDispatched(b, id), id);
    }
    expect(batchPhase(b)).toBe('done');
    expect(batchSummary(b).confirmed).toBe(3);
  });

  it('越级转移被拒:queued 直接 markConfirmed 无效', () => {
    const b = newBatch(['x']);
    const after = markConfirmed(b, 'item_0');
    expect(after.items[0]!.status).toBe('queued');
  });

  it('单条生成失败标 error,不阻断其余', () => {
    let b = newBatch(['ok', 'bad']);
    b = markGenerating(b, 'item_0');
    b = markFilled(b, 'item_0', draftFor('item_0'));
    b = markGenerateFailed(b, 'item_1', 'llm-format');
    b = presentForApproval(b);
    expect(b.items[0]!.status).toBe('awaiting-approval');
    expect(b.items[1]!.status).toBe('error');
    expect(batchSummary(b).errored).toBe(1);
  });

  describe('幂等 / 崩溃恢复(关键)', () => {
    it('已 dispatched 无回执 → recoverBatch 转 needs-human-verification,不重发', () => {
      let b = fillAll(newBatch(['a', 'b']));
      b = markDispatched(b, 'item_0'); // 在途,SW 崩溃
      const recovered = recoverBatch(b);
      expect(recovered.items[0]!.status).toBe('needs-human-verification');
      expect(recovered.items[0]!.error).toMatch(/recovered/);
      // item_1 仍 awaiting,不受影响
      expect(recovered.items[1]!.status).toBe('awaiting-approval');
    });

    it('已回执 no-publish-target(确未触发)→ markPublishFailed 清回 error,不隔离', () => {
      let b = fillAll(newBatch(['a']));
      b = markDispatched(b, 'item_0');
      b = markPublishFailed(b, 'item_0', 'no-publish-target');
      expect(b.items[0]!.status).toBe('error');
      expect(b.items[0]!.error).toBe('no-publish-target');
    });

    it('已 confirmed 的项 recoverBatch 不动', () => {
      let b = fillAll(newBatch(['a']));
      b = markConfirmed(markDispatched(b, 'item_0'), 'item_0');
      expect(recoverBatch(b).items[0]!.status).toBe('publish-confirmed');
    });
  });

  describe('隔离退出 + 重入守卫', () => {
    it('needs-human-verification 仅 releaseQuarantine 可离开 → aborted', () => {
      let b = recoverBatch(markDispatched(fillAll(newBatch(['a'])), 'item_0'));
      expect(b.items[0]!.status).toBe('needs-human-verification');
      // 其它转移无效
      expect(markConfirmed(b, 'item_0').items[0]!.status).toBe('needs-human-verification');
      b = releaseQuarantine(b, 'item_0');
      expect(b.items[0]!.status).toBe('aborted');
    });

    it('新批次不重入已隔离的同选题', () => {
      const quarantined = recoverBatch(markDispatched(fillAll(newBatch(['里番A', '里番B'])), 'item_0'));
      const blocked = quarantinedTopics(quarantined);
      expect(blocked).toEqual(['里番A']);
      const next = filterReentrantTopics(['里番A', '里番C'], blocked);
      expect(next).toEqual(['里番C']);
    });
  });

  describe('急停', () => {
    it('KILL:未发布项→aborted;confirmed 不回退;在途 dispatched 不动', () => {
      let b = fillAll(newBatch(['a', 'b', 'c']));
      b = markConfirmed(markDispatched(b, 'item_0'), 'item_0'); // a: confirmed
      b = markDispatched(b, 'item_1'); // b: 在途
      // c: 仍 awaiting-approval
      const killed = abortBatch(b);
      expect(killed.items[0]!.status).toBe('publish-confirmed'); // 不回退
      expect(killed.items[1]!.status).toBe('publish-dispatched'); // 在飞不动
      expect(killed.items[2]!.status).toBe('aborted'); // 未发→停
    });
  });
});

// ================================================================
// retryBatchItem (U7 — operator override)
// ================================================================

describe('retryBatchItem', () => {
  it('error item → queued, error cleared', () => {
    let b = newBatch(['t']);
    b = markGenerateFailed(b, 'item_0', 'network');
    const result = retryBatchItem(b, 'item_0');
    expect(result.items[0]!.status).toBe('queued');
    expect(result.items[0]!.error).toBeUndefined();
  });

  it('aborted item → queued', () => {
    let b = newBatch(['t']);
    b = abortBatch(b);
    const result = retryBatchItem(b, 'item_0');
    expect(result.items[0]!.status).toBe('queued');
  });

  it('nonexistent itemId → batch unchanged', () => {
    const b = newBatch(['t']);
    const result = retryBatchItem(b, 'no-such-id');
    expect(result.items[0]!.status).toBe('queued'); // original status
    expect(result).toEqual(b); // identical
  });

  it('publish-confirmed item → still transitions to queued (operator override, no guard)', () => {
    let b = newBatch(['t']);
    b = fillAll(b);
    b = markDispatched(b, 'item_0');
    b = markConfirmed(b, 'item_0');
    const result = retryBatchItem(b, 'item_0');
    // Intentional: operator override bypasses guards
    expect(result.items[0]!.status).toBe('queued');
  });

  it('other items unchanged', () => {
    let b = newBatch(['a', 'b']);
    b = markGenerateFailed(b, 'item_0', 'err');
    const result = retryBatchItem(b, 'item_0');
    expect(result.items[1]!.status).toBe('queued'); // item_1 untouched
  });
});
