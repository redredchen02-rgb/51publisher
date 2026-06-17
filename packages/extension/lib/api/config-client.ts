import type { FieldMapping } from "@51guapi/shared";
import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";
import { logger } from "../logger";
import { apiFetch } from "./api-fetch";

/**
 * 后端配置客户端。
 *
 * 扩展启动时拉取 GET /api/v1/config/mappings，获得最新的选择器映射;
 * 后端不可达时 fail-closed 回落到编译期默认值(DEFAULT_FIELD_MAPPING),
 * 保证离线环境下扩展仍可正常工作。
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
	fetchFn?: typeof fetch,
	timeoutMs = 5_000,
): Promise<{ mappings: FieldMapping; remote: boolean }> {
	try {
		const res = await apiFetch("/api/v1/config/mappings", {
			fetchFn,
			timeoutMs,
		});

		if (res.status === 401) {
			return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
		}

		if (!res.ok) {
			logger.warn("config-client", "后端返回非 2xx，回落默认映射");
			return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
		}

		const data = (await res.json()) as MappingsResponse;
		if (data.ok && data.mappings) {
			logger.debug("config-client", "成功拉取远程映射", {
				version: data.version,
			});
			return { mappings: data.mappings, remote: true };
		}

		logger.warn("config-client", "后端返回无效数据，回落默认映射");
		return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		logger.warn("config-client", aborted ? "拉取映射超时" : "无法连接后端");
		return { mappings: DEFAULT_FIELD_MAPPING, remote: false };
	}
}
