import type { PublishResult } from './types';
import { getSettings, getBackendToken } from './storage';

export interface PublishedPostRecord {
  id: string;
  batchItemId: string;
  sourceTitle: string;
  publishUrl?: string;
  publishUrlSource?: PublishResult['urlSource'];
  publishedAt: string;
  outcome?: string;
}

/**
 * best-effort POST 到后端 published_posts 注册表。
 * backendUrl 未配置 / token 缺失 / 网络失败 → 静默跳过，trajectory 是本地 source of truth。
 */
export async function recordPublishedPost(record: PublishedPostRecord): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.backendUrl) return;
    const token = await getBackendToken();
    if (!token) return;
    await fetch(`${settings.backendUrl}/api/v1/published-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id: record.id,
        batch_item_id: record.batchItemId,
        source_title: record.sourceTitle,
        publish_url: record.publishUrl ?? null,
        publish_url_source: record.publishUrlSource ?? 'not_available',
        published_at: record.publishedAt,
        outcome: record.outcome ?? 'publish-confirmed',
      }),
    });
  } catch {
    // 吞噬：后端不可达时 trajectory 仍是权威数据源
  }
}
