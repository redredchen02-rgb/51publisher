import { getToken, clearToken } from './auth-client';

const BACKEND_BASE = 'http://127.0.0.1:3001';

export interface PendingTopic {
  id: string;
  sourceUrl: string;
  siteName: string;
  title: string;
  rawContent?: { title: string; body: string; url: string; metadata?: Record<string, string> };
  facts: Record<string, string>;
  confidence: number;
  qualityScore?: number;
  status: 'pending' | 'approved' | 'rejected';
  rejectedReason?: string;
  coverImageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingTopicsResponse {
  ok: boolean;
  topics?: PendingTopic[];
  error?: string;
}

export interface PendingTopicResponse {
  ok: boolean;
  topic?: PendingTopic;
  error?: string;
}

export interface FetchPendingTopicsOptions {
  status?: string;
  sort_by?: 'score';
  fold_threshold?: number;
}

/**
 * 拉取待审核选题列表。支持按质量分排序（sort_by='score'）和折叠阈值。
 */
export async function fetchPendingTopics(
  statusOrOpts?: string | FetchPendingTopicsOptions,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<PendingTopic[]> {
  const opts: FetchPendingTopicsOptions =
    typeof statusOrOpts === 'string' ? { status: statusOrOpts } : (statusOrOpts ?? {});
  const qp = new URLSearchParams();
  if (opts.status) qp.set('status', opts.status);
  if (opts.sort_by) qp.set('sort_by', opts.sort_by);
  if (opts.fold_threshold !== undefined) qp.set('fold_threshold', String(opts.fold_threshold));
  const params = qp.toString() ? `?${qp.toString()}` : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/pending-topics${params}`, {
      headers,
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as PendingTopicsResponse;
    return data.ok && data.topics ? data.topics : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 局部更新待审核选题的事实字段（内联编辑后批准前调用）。
 */
export async function patchPendingTopic(
  id: string,
  patch: { facts?: Record<string, string> },
  fetchFn: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/pending-topics/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return false;
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 触发立即抓取（R3）。
 */
export async function triggerScrape(
  siteName: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/scraper/trigger`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ siteName }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return false;
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取已注册的适配器列表（R3）。
 */
export async function fetchAdapters(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/scraper/adapters`, {
      headers,
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { ok: boolean; adapters?: { name: string }[] };
    return data.ok && data.adapters ? data.adapters.map((a) => a.name) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 批准/拒绝待审核选题（更新后端状态）。
 */
export async function updatePendingStatus(
  id: string,
  status: 'pending' | 'approved' | 'rejected',
  rejectedReason?: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(`${BACKEND_BASE}/api/v1/pending-topics/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status, ...(rejectedReason ? { rejectedReason } : {}) }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      await clearToken();
      return false;
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
