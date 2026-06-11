import { describe, it, expect } from 'vitest';
import {
  appendRecord,
  buildRecord,
  verifyTrajectory,
  rollbackTargets,
  type TrajectoryRecord,
  type TrajectoryInput,
} from './trajectory';

function input(over: Partial<TrajectoryInput> = {}): TrajectoryInput {
  return {
    id: 'i1',
    topic: '番A',
    fields: [{ field: 'title', status: 'filled' }],
    status: 'publish-confirmed',
    ts: '2026-06-04T00:00:00.000Z',
    ...over,
  };
}

describe('trajectory', () => {
  it('append:seq 递增、hash 链接续', () => {
    let list: TrajectoryRecord[] = [];
    list = appendRecord(list, input({ id: 'a' })).list;
    list = appendRecord(list, input({ id: 'b' })).list;
    expect(list.map((r) => r.seq)).toEqual([1, 2]);
    expect(list[0]!.hash).not.toBe(list[1]!.hash);
    expect(verifyTrajectory(list)).toBe(true);
  });

  it('记录含字段 + URL + publishedAsDraft', () => {
    const { list } = appendRecord([], input({ publishUrl: '/post/9', publishedAsDraft: true }));
    expect(list[0]!.publishUrl).toBe('/post/9');
    expect(list[0]!.publishedAsDraft).toBe(true);
    expect(list[0]!.fields[0]!.field).toBe('title');
  });

  describe('脱敏闸门 fail-closed', () => {
    it('干净快照 → 存清洗结果', () => {
      const { list, snapshotDropped } = appendRecord([], input({ rawSnapshot: '<input name="title" value="t">' }));
      expect(snapshotDropped).toBe(false);
      expect(list[0]!.snapshot).toBeDefined();
      expect(list[0]!.snapshot).not.toMatch(/value="t"/); // 值被剥
    });

    it('含机密且清洗后仍残留 → 丢弃快照,record 仍落(不带 snapshot)', () => {
      const { list, snapshotDropped } = appendRecord(
        [],
        input({ rawSnapshot: '<span>PHPSESSID=deadbeefdeadbeef</span>' }),
      );
      expect(snapshotDropped).toBe(true);
      expect(list[0]!.snapshot).toBeUndefined();
      expect(list[0]!.status).toBe('publish-confirmed'); // 记录本身仍在
    });

    it('hidden value 含机密 → 被剥,快照可存', () => {
      const { list } = appendRecord(
        [],
        input({ rawSnapshot: '<input type=hidden name=_token value=abcdef1234567890abcdef1234567890>' }),
      );
      expect(list[0]!.snapshot).toBeDefined();
      expect(list[0]!.snapshot).not.toMatch(/_token/);
    });
  });

  describe('篡改可检', () => {
    it('改某条字段 → verify 失败', () => {
      let list: TrajectoryRecord[] = [];
      list = appendRecord(list, input({ id: 'a' })).list;
      list = appendRecord(list, input({ id: 'b' })).list;
      const tampered = list.map((r, i) => (i === 0 ? { ...r, topic: '被改' } : r));
      expect(verifyTrajectory(tampered)).toBe(false);
    });

    it('删中间一条(seq 断裂)→ verify 失败', () => {
      let list: TrajectoryRecord[] = [];
      for (const id of ['a', 'b', 'c']) list = appendRecord(list, input({ id })).list;
      const broken = [list[0]!, list[2]!]; // 删 seq=2
      expect(verifyTrajectory(broken)).toBe(false);
    });
  });

  it('rollbackTargets:仅 confirmed + 有 URL', () => {
    let list: TrajectoryRecord[] = [];
    list = appendRecord(list, input({ id: 'a', publishUrl: '/post/1' })).list;
    list = appendRecord(list, input({ id: 'b', status: 'error', publishUrl: undefined })).list;
    list = appendRecord(list, input({ id: 'c', status: 'publish-confirmed' })).list; // 无 URL
    expect(rollbackTargets(list).map((r) => r.id)).toEqual(['a']);
  });

  it('buildRecord 直接用:相同输入 + 链同 → 确定性 hash', () => {
    const a = buildRecord(input(), 1, '0').record;
    const b = buildRecord(input(), 1, '0').record;
    expect(a.hash).toBe(b.hash);
  });
});
