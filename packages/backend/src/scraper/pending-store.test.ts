import { describe, it, expect, beforeEach } from 'vitest';

import { initPendingDb, getDb } from './pending-db.js';
import {
  savePendingTopic,
  loadPendingTopic,
  listPendingTopics,
  deletePendingTopic,
  updatePendingTopicStatus,
  type PendingTopic,
} from './pending-store.js';

/** 初始化一次 DB 单例，每次测试前清空表（比重建文件快且无单例问题）。 */
function resetDb() {
  initPendingDb();
  getDb().exec('DELETE FROM pending_topics');
}

function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
  const now = new Date().toISOString();
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sourceUrl: 'https://51acgs.com/article/123',
    siteName: 'acgs51',
    title: '测试作品 #1',
    facts: { 作品名: '测试作品', 简介: '一段简介' },
    confidence: 0.85,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('pending-store (SQLite)', () => {
  beforeEach(() => {
    resetDb();
  });

  // ---- savePendingTopic / loadPendingTopic ----

  it('save → load: 字段完整往返', async () => {
    const topic = makeTopic({ coverImageUrl: 'https://cdn.example.com/cover.jpg' });
    await savePendingTopic(topic);
    const loaded = await loadPendingTopic(topic.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe(topic.title);
    expect(loaded!.siteName).toBe('acgs51');
    expect(loaded!.confidence).toBe(0.85);
    expect(loaded!.status).toBe('pending');
    expect(loaded!.coverImageUrl).toBe('https://cdn.example.com/cover.jpg');
    expect(loaded!.facts['作品名']).toBe('测试作品');
  });

  it('load 不存在的 id → null', async () => {
    const result = await loadPendingTopic('nonexistent-id');
    expect(result).toBeNull();
  });

  it('save 同 id 两次 → upsert，以最新值为准', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);
    const updated = { ...topic, title: '更新后标题' };
    await savePendingTopic(updated);
    const loaded = await loadPendingTopic(topic.id);
    expect(loaded!.title).toBe('更新后标题');
  });

  it('savePendingTopic 自动刷新 updatedAt', async () => {
    const topic = makeTopic();
    const before = topic.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await savePendingTopic(topic);
    const loaded = await loadPendingTopic(topic.id);
    expect(loaded!.updatedAt >= before).toBe(true);
  });

  // ---- listPendingTopics ----

  it('空 DB → 返回空数组', async () => {
    const list = await listPendingTopics();
    expect(list).toEqual([]);
  });

  it('listPendingTopics 无筛选 → 返回所有记录，按 created_at DESC', async () => {
    const t1 = makeTopic({ id: 'id-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    const t2 = makeTopic({ id: 'id-2', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' });
    await savePendingTopic(t1);
    await savePendingTopic(t2);
    const list = await listPendingTopics();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('id-2'); // newest first
  });

  it('listPendingTopics(status) → 只返回对应状态', async () => {
    const pending = makeTopic({ id: 'p1', status: 'pending' });
    const approved = makeTopic({ id: 'a1', status: 'approved' });
    await savePendingTopic(pending);
    await savePendingTopic(approved);
    const pendingList = await listPendingTopics(50, 'pending');
    expect(pendingList.every((t) => t.status === 'pending')).toBe(true);
    expect(pendingList.find((t) => t.id === 'a1')).toBeUndefined();
  });

  it('listPendingTopics(limit) → 最多返回 limit 条', async () => {
    for (let i = 0; i < 5; i++) await savePendingTopic(makeTopic());
    const list = await listPendingTopics(3);
    expect(list.length).toBe(3);
  });

  // ---- deletePendingTopic ----

  it('delete → 记录消失', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);
    await deletePendingTopic(topic.id);
    const loaded = await loadPendingTopic(topic.id);
    expect(loaded).toBeNull();
  });

  it('delete 不存在的 id → 不抛出', async () => {
    await expect(deletePendingTopic('ghost-id')).resolves.toBeUndefined();
  });

  // ---- updatePendingTopicStatus ----

  it('approve → status 变更，updatedAt 刷新', async () => {
    const topic = makeTopic({ status: 'pending' });
    await savePendingTopic(topic);
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updatePendingTopicStatus(topic.id, 'approved');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('approved');
    expect(updated!.updatedAt > topic.updatedAt).toBe(true);
  });

  it('reject with reason → rejectedReason 被保存', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);
    const updated = await updatePendingTopicStatus(topic.id, 'rejected', '内容质量不足');
    expect(updated!.status).toBe('rejected');
    expect(updated!.rejectedReason).toBe('内容质量不足');
  });

  it('updatePendingTopicStatus 不存在的 id → null', async () => {
    const result = await updatePendingTopicStatus('ghost-id', 'approved');
    expect(result).toBeNull();
  });

  // ---- rawContent JSON 往返 ----

  it('rawContent 序列化 → 反序列化字段完整', async () => {
    const topic = makeTopic({
      rawContent: {
        title: '原始标题',
        body: '<p>正文</p>',
        url: 'https://51acgs.com/detail',
        metadata: { 制作: 'Studio X' },
        coverImageUrl: 'https://cdn.example.com/img.jpg',
      },
    });
    await savePendingTopic(topic);
    const loaded = await loadPendingTopic(topic.id);
    expect(loaded!.rawContent?.title).toBe('原始标题');
    expect(loaded!.rawContent?.metadata?.['制作']).toBe('Studio X');
    expect(loaded!.rawContent?.coverImageUrl).toBe('https://cdn.example.com/img.jpg');
  });
});
