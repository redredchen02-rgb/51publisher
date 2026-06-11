import { describe, it, expect } from 'vitest';
import { aggregateDegradeStats } from './degrade-stats';
import type { BatchItem } from './batch';

function item(id: string, fillResults?: BatchItem['fillResults']): BatchItem {
  return { id, topic: `topic-${id}`, status: 'publish-confirmed', fillResults };
}

describe('aggregateDegradeStats', () => {
  it('空数组 → 全零', () => {
    const r = aggregateDegradeStats([]);
    expect(r).toEqual({ itemsWithAnyDegrade: 0, totalItemsWithResults: 0, topFields: [] });
  });

  it('所有字段 filled → 无降级', () => {
    const r = aggregateDegradeStats([
      item('a', [
        { field: 'title', status: 'filled' },
        { field: 'category', status: 'filled' },
      ]),
    ]);
    expect(r.itemsWithAnyDegrade).toBe(0);
    expect(r.totalItemsWithResults).toBe(1);
    expect(r.topFields).toHaveLength(0);
  });

  it('一条有降级 → itemsWithAnyDegrade=1', () => {
    const r = aggregateDegradeStats([
      item('a', [
        { field: 'category', status: 'degraded' },
        { field: 'title', status: 'filled' },
      ]),
      item('b', [{ field: 'title', status: 'filled' }]),
    ]);
    expect(r.itemsWithAnyDegrade).toBe(1);
    expect(r.totalItemsWithResults).toBe(2);
    expect(r.topFields).toEqual([{ field: 'category', count: 1 }]);
  });

  it('多条同字段降级 → topFields 按次数降序', () => {
    const r = aggregateDegradeStats([
      item('a', [
        { field: 'category', status: 'degraded' },
        { field: 'tags', status: 'degraded' },
      ]),
      item('b', [{ field: 'category', status: 'degraded' }]),
      item('c', [
        { field: 'category', status: 'degraded' },
        { field: 'tags', status: 'filled' },
      ]),
    ]);
    expect(r.topFields[0]).toEqual({ field: 'category', count: 3 });
    expect(r.topFields[1]).toEqual({ field: 'tags', count: 1 });
  });

  it('topFields 最多取 5 个', () => {
    const fields = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
    const r = aggregateDegradeStats([
      item(
        'a',
        fields.map((f) => ({ field: f, status: 'degraded' as const })),
      ),
    ]);
    expect(r.topFields).toHaveLength(5);
  });

  it('无 fillResults 的条目不计入分母', () => {
    const r = aggregateDegradeStats([
      item('a', undefined), // 无结果
      item('b', [{ field: 'title', status: 'degraded' }]), // 有结果
    ]);
    expect(r.totalItemsWithResults).toBe(1);
    expect(r.itemsWithAnyDegrade).toBe(1);
  });
});
