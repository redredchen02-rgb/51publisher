import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { initPendingDb, getDb } from './pending-db.js';
import { savePendingTopic, type PendingTopic } from './pending-store.js';
import { registerPendingRoutes } from './pending-routes.js';

// ---- helpers ----

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
    title: '测试选题',
    facts: { 作品名: '测试作品' },
    confidence: 0.8,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerPendingRoutes(app);
  await app.ready();
  return app;
}

// ---- setup ----

let app: FastifyInstance;

beforeEach(async () => {
  resetDb();
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
});

// ================================================================
// PATCH /api/v1/pending-topics/:id — rejectedReason 校验
// ================================================================

describe('PATCH /api/v1/pending-topics/:id — rejectedReason validation', () => {
  it('valid reason "duplicate" → 200，DB 存储该值', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pending-topics/${topic.id}`,
      payload: { status: 'rejected', rejectedReason: 'duplicate' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.topic.status).toBe('rejected');
    expect(body.topic.rejectedReason).toBe('duplicate');
  });

  it('无效 reason "made_up" → 400', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pending-topics/${topic.id}`,
      payload: { status: 'rejected', rejectedReason: 'made_up' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/made_up/);
  });

  it('无 rejectedReason → 200，rejectedReason 存储为 null/undefined', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pending-topics/${topic.id}`,
      payload: { status: 'rejected' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.topic.status).toBe('rejected');
    // rejectedReason 未提供时存 null，返回 JSON 中为 undefined 或缺失
    expect(body.topic.rejectedReason ?? null).toBeNull();
  });

  it('非 rejected 状态携带 rejectedReason → 200（reason 被忽略，不报错）', async () => {
    const topic = makeTopic();
    await savePendingTopic(topic);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pending-topics/${topic.id}`,
      payload: { status: 'approved', rejectedReason: 'quality' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.topic.status).toBe('approved');
  });

  it('不存在的 id → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/pending-topics/nonexistent-id',
      payload: { status: 'rejected', rejectedReason: 'quality' },
    });

    expect(res.statusCode).toBe(404);
  });
});
