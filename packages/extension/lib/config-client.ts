import type { FieldMapping } from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { apiFetch } from "./api-fetch";

/**
 * 后端配置客户端。
 *
 * 扩展启动时拉取 GET /api/v1/config/mappings，获得最新的选择器映射;
 * 后端不可达时 fail-closed 回落到编译期默认值(DEFAULT_FIELD_MAPPING),
 * 保证离线环境下扩展仍可正常工作。
 *
 * 注:各方法历史上带 `fetchFn` 注入参数,迁移到 apiFetch 后该参数为遗留
 * (实际请求统一走 apiFetch + fetchWithTimeout 超时);保留签名避免破坏调用方。
 */

export interface MappingsResponse {
	ok: boolean;
	mappings?: FieldMapping;
	version?: number;
	error?: string;
}

/**
 * 拉取后端最新的字段映射配置。
 * @returns 映射对象;后端不可达或返回异常时回落 DEFAULT_FIELD_MAPPING。
 */
export async function fetchRemoteMappings(
	_fetchFn: typeof fetch = fetch,
	timeoutMs = 5_000,
): Promise<{ mappings: FieldMapping; remote: boolean }> {
	try {
		const res = await apiFetch("/api/v1/config/mappings", { timeoutMs });

		if (res.status === 401) {
			return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
		}
		if (!res.ok) {
			console.warn("[config-client] 后端返回非 2xx，回落默认映射");
			return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
		}

		const data = (await res.json()) as MappingsResponse;
		if (data.ok && data.mappings) {
			console.debug(
				"[config-client] 成功拉取远程映射 (version=%d)",
				data.version,
			);
			return { mappings: data.mappings, remote: true };
		}

		console.warn("[config-client] 后端返回无效数据，回落默认映射");
		return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		console.warn(
			"[config-client] %s，回落默认映射",
			aborted ? "拉取映射超时" : "无法连接后端",
		);
		return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
	}
}

// ---- Batch 状态同步客户端 ----

/**
 * 向后端同步 Batch 状态更新。
 * 发送 PATCH 请求更新单个 item 的状态,失败时不阻断流程(best-effort)。
 */
export async function syncBatchItemStatus(
	batchId: string,
	itemId: string,
	patch: {
		status?: string;
		draft?: unknown;
		publishUrl?: string;
		error?: string;
		fillResults?: unknown[];
	},
	_fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch(
			`/api/v1/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
			{
				method: "PATCH",
				body: JSON.stringify(patch),
				timeoutMs,
			},
		);

		if (res.status === 401) {
			return { ok: false, error: "登录已过期" };
		}
		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			console.warn(
				"[config-client] Batch 状态同步失败 (%d): %s",
				res.status,
				errText,
			);
			return { ok: false, error: `HTTP ${res.status}` };
		}

		return { ok: true };
	} catch (err) {
		console.warn("[config-client] Batch 状态同步异常:", err);
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * 从后端拉取批次最新状态(含崩溃恢复)。
 * SW 重启后调用此接口恢复 UI 进度。
 */
export async function fetchBatchState(
	batchId: string,
	_fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; batch?: unknown; error?: string }> {
	try {
		const res = await apiFetch(
			`/api/v1/batches/${encodeURIComponent(batchId)}`,
			{ timeoutMs },
		);

		if (res.status === 401) {
			return { ok: false, error: "登录已过期" };
		}
		if (!res.ok) {
			return { ok: false, error: `HTTP ${res.status}` };
		}

		const data = await res.json();
		return { ok: true, batch: (data as { batch?: unknown }).batch };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * 在后端创建新批次。
 */
export async function createRemoteBatch(
	payload: {
		id: string;
		tabId: number;
		authorizedHost: string;
		topics: string[];
		facts?: (Record<string, unknown> | undefined)[];
	},
	_fetchFn: typeof fetch = fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch("/api/v1/batches", {
			method: "POST",
			body: JSON.stringify(payload),
			timeoutMs,
		});

		if (res.status === 401) {
			return { ok: false, error: "登录已过期" };
		}
		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			return { ok: false, error: `HTTP ${res.status}: ${errText}` };
		}

		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
