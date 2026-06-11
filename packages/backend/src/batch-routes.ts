import type { FastifyInstance } from 'fastify';
import { err } from './error-response.js';
import { CreateBatchBody } from './schemas.js';
import {
  loadBatch,
  saveBatch,
  listBatches,
  recoverBatch,
  type Batch,
  type BatchItem,
  type BatchItemStatus,
} from './batch-store.js';

/**
 * Batch 状态管理 API。
 *
 * POST   /api/v1/batches              — 创建新批次
 * GET    /api/v1/batches              — 列出最近批次
 * GET    /api/v1/batches/:id          — 获取单个批次(含崩溃恢复)
 * PATCH  /api/v1/batches/:id/items/:itemId — 更新单项状态
 *
 * 设计原则:
 *   1. 前端 MV3 SW 随时被回收,所有状态推进由后端落库
 *   2. SW 重启后拉取 GET /api/v1/batches/:id 即可恢复 UI
 *   3. 绝不自动提交/发布(R4 铁律);后端只跟踪状态,publish grant 仍由前端控制
 */

interface CreateBatchBody {
  id: string;
  tabId: number;
  authorizedHost: string;
  topics: string[];
  facts?: (Record<string, unknown> | undefined)[];
}

interface PatchItemBody {
  status?: BatchItemStatus;
  draft?: import('@51publisher/shared').ContentDraft;
  publishUrl?: string;
  error?: string;
  fillResults?: import('@51publisher/shared').FieldFillResult[];
}

interface BatchIdParams {
  id: string;
}

interface BatchItemParams {
  id: string;
  itemId: string;
}

// 合法的状态转移表(源 → 允许的目标)
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<BatchItemStatus>> = {
  queued: new Set(['generating', 'aborted']),
  generating: new Set(['filled', 'error', 'aborted']),
  filled: new Set(['awaiting-approval', 'error', 'aborted']),
  'awaiting-approval': new Set(['publish-dispatched', 'aborted']),
  'publish-dispatched': new Set(['publish-confirmed', 'error', 'needs-human-verification']),
  error: new Set(['queued']), // retry
  'needs-human-verification': new Set(['aborted']), // release quarantine
};

export async function registerBatchRoutes(app: FastifyInstance): Promise<void> {
  // 创建批次
  app.post<{ Body: CreateBatchBody }>(
    '/api/v1/batches',
    {
      schema: {
        body: CreateBatchBody,
      },
    },
    async (request, reply) => {
      const { id, tabId, authorizedHost, topics, facts } = request.body;

      if (!id || !tabId || !authorizedHost || !Array.isArray(topics) || topics.length === 0) {
        return err(reply, 400, 'Missing required fields: id, tabId, authorizedHost, topics[]');
      }

      const now = new Date().toISOString();
      const batch: Batch = {
        id,
        tabId,
        authorizedHost,
        createdAt: now,
        updatedAt: now,
        items: topics.map((topic, i) => ({
          id: `${id}_item_${i}`,
          topic,
          status: 'queued' as const,
          ...(facts?.[i] ? { facts: facts[i] } : {}),
        })),
      };

      await saveBatch(batch);
      return { ok: true, batch };
    },
  );

  // 列出批次
  app.get<{ Querystring: { limit?: string } }>('/api/v1/batches', async (request) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
    const batches = await listBatches(limit);
    return { ok: true, batches };
  });

  // 获取单个批次(含崩溃恢复)
  app.get<{ Params: BatchIdParams }>('/api/v1/batches/:id', async (request, reply) => {
    const batch = await loadBatch(request.params.id);
    if (!batch) return err(reply, 404, 'Batch not found');

    // 自动崩溃恢复:publish-dispatched 无回执 → 隔离
    const recovered = recoverBatch(batch);
    // 如果恢复有变动,持久化
    const changed = JSON.stringify(recovered) !== JSON.stringify(batch);
    if (changed) await saveBatch(recovered);

    return { ok: true, batch: recovered };
  });

  // 更新单项状态
  app.patch<{ Params: BatchItemParams; Body: PatchItemBody }>(
    '/api/v1/batches/:id/items/:itemId',
    async (request, reply) => {
      const batch = await loadBatch(request.params.id);
      if (!batch) return err(reply, 404, 'Batch not found');

      const itemIdx = batch.items.findIndex((it) => it.id === request.params.itemId);
      if (itemIdx === -1) return err(reply, 404, 'Item not found');

      const item = batch.items[itemIdx];
      const body = request.body;

      // 校验状态转移
      if (body.status) {
        const allowed = ALLOWED_TRANSITIONS[item.status];
        if (!allowed || !allowed.has(body.status)) {
          return reply.status(409).send({
            ok: false,
            error: `Invalid state transition: ${item.status} → ${body.status}`,
            currentStatus: item.status,
          });
        }
        item.status = body.status;
      }

      // 合并可选字段
      if (body.draft !== undefined) item.draft = body.draft;
      if (body.publishUrl !== undefined) item.publishUrl = body.publishUrl;
      if (body.error !== undefined) item.error = body.error;
      if (body.fillResults !== undefined) item.fillResults = body.fillResults;

      batch.items[itemIdx] = item;
      await saveBatch(batch);

      return { ok: true, item };
    },
  );
}
