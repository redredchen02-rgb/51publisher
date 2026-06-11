import type { Batch } from './batch';
import { getToken } from './auth-client';
import { createRemoteBatch, syncBatchItemStatus, fetchBatchState } from './config-client';

/**
 * 包装本地 save 函数，实现双写模式：本地优先 + 后端最佳同步。
 * - 第一次调用：创建远端批次 (createRemoteBatch)
 * - 后续调用：同步各 item 状态 (syncBatchItemStatus)
 * - 后端失败不阻塞本地流程 (fail-closed)
 */
export function withBackendSync(localSave: (batch: Batch) => Promise<void>): (batch: Batch) => Promise<void> {
  let createdRemote = false;

  return async (batch: Batch) => {
    // 1. 始终先写本地
    await localSave(batch);

    // 2. 最佳努力同步到后端
    try {
      const token = await getToken();
      if (!token) return;

      if (!createdRemote) {
        const result = await createRemoteBatch({
          id: batch.id,
          tabId: batch.tabId,
          authorizedHost: batch.authorizedHost,
          topics: batch.items.map((i) => i.topic),
          facts: batch.items.map((i) => i.facts) as (Record<string, unknown> | undefined)[],
        });
        if (result.ok) createdRemote = true;
      } else {
        await Promise.allSettled(
          batch.items.map((item) =>
            syncBatchItemStatus(batch.id, item.id, {
              status: item.status,
              ...(item.draft ? { draft: item.draft } : {}),
              ...(item.publishUrl ? { publishUrl: item.publishUrl } : {}),
              ...(item.error ? { error: item.error } : {}),
              ...(item.fillResults ? { fillResults: item.fillResults } : {}),
            }),
          ),
        );
      }
    } catch {
      // fail-closed
    }
  };
}

/**
 * SW 重启时尝试从后端恢复批次状态。
 * 后端不可达/未登录时回落本地恢复。
 */
export async function tryBackendRecovery(batchId: string | null): Promise<{ batch?: Batch }> {
  if (!batchId) return {};
  try {
    const token = await getToken();
    if (!token) return {};
    const result = await fetchBatchState(batchId);
    if (result.ok && result.batch) {
      return { batch: result.batch as Batch };
    }
  } catch {
    // fail-closed
  }
  return {};
}
