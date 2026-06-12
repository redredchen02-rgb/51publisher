import { clearToken, getToken } from "./auth-client";

const BACKEND_BASE = "http://127.0.0.1:3001";

export interface PendingTopic {
	id: string;
	sourceUrl: string;
	siteName: string;
	title: string;
	rawContent?: {
		title: string;
		body: string;
		url: string;
		metadata?: Record<string, string>;
	};
	facts: Record<string, string>;
	confidence: number;
	qualityScore?: number;
	status: "pending" | "approved" | "rejected";
	rejectedReason?: string;
	coverImageUrl?: string;
	/** 质量分低于 fold_threshold 时后端标记为折叠（低优先级）。 */
	folded?: boolean;
	/** 预格式化的 web 搜索富化文本，可直接注入 LLM prompt（后端 formatEnrichmentForPrompt 输出）。 */
	enrichmentText?: string;
	createdAt: string;
	updatedAt: string;
}

export interface FetchPendingTopicsOptions {
	status?: string;
	sort_by?: "score" | "created_at";
	fold_threshold?: number;
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

/**
 * 拉取待审核选题列表。支持按质量分排序（sort_by='score'）和折叠阈值。
 *
 * 两种调用方式（向前兼容）：
 *   fetchPendingTopics('pending')
 *   fetchPendingTopics('pending', 'score', 0.5)
 *   fetchPendingTopics({ status: 'pending', sort_by: 'score', fold_threshold: 0.5 })
 */
export async function fetchPendingTopics(
	statusOrOpts?: string | FetchPendingTopicsOptions,
	sortByOrFetch?: "score" | "created_at" | typeof fetch,
	foldThresholdOrTimeout?: number,
	fetchFnArg?: typeof fetch,
	timeoutMs = 10_000,
): Promise<PendingTopic[]> {
	// 解析重载参数
	let opts: FetchPendingTopicsOptions;
	let fetchFn: typeof fetch;
	let timeout: number;

	if (typeof statusOrOpts === "object" && statusOrOpts !== null) {
		// fetchPendingTopics(opts, fetchFn?, timeoutMs?)
		opts = statusOrOpts;
		fetchFn = (sortByOrFetch as typeof fetch | undefined) ?? fetch;
		timeout = (foldThresholdOrTimeout as number | undefined) ?? 10_000;
	} else if (typeof sortByOrFetch === "string" || sortByOrFetch === undefined) {
		// fetchPendingTopics(status?, sortBy?, foldThreshold?, fetchFn?, timeoutMs?)
		opts = {
			status: statusOrOpts as string | undefined,
			sort_by: sortByOrFetch as "score" | "created_at" | undefined,
			fold_threshold:
				typeof foldThresholdOrTimeout === "number"
					? foldThresholdOrTimeout
					: undefined,
		};
		fetchFn = fetchFnArg ?? fetch;
		timeout = timeoutMs;
	} else {
		// fetchPendingTopics(status?, fetchFn, timeoutMs?)
		opts = { status: statusOrOpts as string | undefined };
		fetchFn = sortByOrFetch as typeof fetch;
		timeout = (foldThresholdOrTimeout as number | undefined) ?? 10_000;
	}

	const qp = new URLSearchParams();
	if (opts.status) qp.set("status", opts.status);
	if (opts.sort_by) qp.set("sort_by", opts.sort_by);
	if (opts.fold_threshold !== undefined)
		qp.set("fold_threshold", String(opts.fold_threshold));
	const params = qp.toString() ? `?${qp.toString()}` : "";
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const res = await fetchFn(
			`${BACKEND_BASE}/api/v1/pending-topics${params}`,
			{
				headers,
				signal: controller.signal,
			},
		);
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
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const res = await fetchFn(
			`${BACKEND_BASE}/api/v1/pending-topics/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify(patch),
				signal: controller.signal,
			},
		);
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
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const res = await fetchFn(`${BACKEND_BASE}/api/v1/scraper/trigger`, {
			method: "POST",
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
export async function fetchAdapters(
	fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<string[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const res = await fetchFn(`${BACKEND_BASE}/api/v1/scraper/adapters`, {
			headers,
			signal: controller.signal,
		});
		if (res.status === 401) {
			await clearToken();
			return [];
		}
		if (!res.ok) return [];
		const data = (await res.json()) as {
			ok: boolean;
			adapters?: { name: string }[];
		};
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
	status: "pending" | "approved" | "rejected",
	rejectedReason?: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const res = await fetchFn(
			`${BACKEND_BASE}/api/v1/pending-topics/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				headers,
				body: JSON.stringify({
					status,
					...(rejectedReason ? { rejectedReason } : {}),
				}),
				signal: controller.signal,
			},
		);
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
