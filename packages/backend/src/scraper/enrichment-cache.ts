// 富化缓存层：内存 LRU + SQLite 双层缓存。
// 从 web-enricher.ts 提取，使搜索逻辑与缓存解耦。

import type { FactsBlock } from "@51guapi/shared";
import { getDb } from "./pending-db.js";
import type { EnrichedContext } from "./web-enricher.js";

// ---- 内存缓存 ----

const memoryCache = new Map<
	string,
	{ data: EnrichedContext; expiresAt: number; lastAccessedAt: number }
>();
const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 小时
const MEMORY_CACHE_SIZE = 500; // 增大缓存容量，减少 LRU 淘汰频率

function evictLruFromMemoryCache(): void {
	let lruKey: string | undefined;
	let lruTime = Infinity;
	for (const [k, v] of memoryCache) {
		if (v.lastAccessedAt < lruTime) {
			lruTime = v.lastAccessedAt;
			lruKey = k;
		}
	}
	if (lruKey) memoryCache.delete(lruKey);
}

// ---- SQLite 缓存 ----

const DB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

let _enrichmentTableReady = false;

/** 初始化富化缓存表（幂等，只执行一次）。 */
function initEnrichmentCacheTable(): void {
	if (_enrichmentTableReady) return;
	_enrichmentTableReady = true;
	try {
		const db = getDb();
		db.exec(`
			CREATE TABLE IF NOT EXISTS enrichment_cache (
				cache_key TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_enrichment_created ON enrichment_cache(created_at);
		`);
		// 清理过期缓存（24小时）
		db.prepare(
			"DELETE FROM enrichment_cache WHERE created_at < datetime('now', '-1 day')",
		).run();
	} catch {
		// 初始化失败不影响主流程
	}
}

/** 从 SQLite 加载缓存。 */
function loadFromDbCache(key: string): EnrichedContext | null {
	try {
		initEnrichmentCacheTable();
		const db = getDb();
		const row = db
			.prepare(
				`SELECT data, created_at FROM enrichment_cache WHERE cache_key = ?`,
			)
			.get(key) as { data: string; created_at: string } | undefined;

		if (!row) return null;

		const age = Date.now() - new Date(row.created_at).getTime();
		if (age > DB_CACHE_TTL) {
			db.prepare("DELETE FROM enrichment_cache WHERE cache_key = ?").run(key);
			return null;
		}

		return JSON.parse(row.data) as EnrichedContext;
	} catch {
		return null;
	}
}

/** 保存到 SQLite 缓存。 */
function saveToDbCache(key: string, data: EnrichedContext): void {
	try {
		initEnrichmentCacheTable();
		const db = getDb();
		db.prepare(
			`INSERT OR REPLACE INTO enrichment_cache (cache_key, data, created_at)
			 VALUES (?, ?, ?)`,
		).run(key, JSON.stringify(data), new Date().toISOString());
	} catch {
		// 保存失败不影响主流程
	}
}

// ---- 公共接口 ----

/** 生成缓存键。 */
export function getCacheKey(facts: FactsBlock): string {
	return `${facts.制作 || ""}|${facts.作品名 || ""}`;
}

/** 查询缓存（内存优先 → SQLite）。命中时自动回填内存缓存。 */
export function getFromCache(key: string): EnrichedContext | null {
	// 1. 检查内存缓存
	const memoryCached = memoryCache.get(key);
	if (memoryCached && memoryCached.expiresAt > Date.now()) {
		memoryCached.lastAccessedAt = Date.now();
		return memoryCached.data;
	}

	// 2. 检查 SQLite 缓存
	const dbCached = loadFromDbCache(key);
	if (dbCached) {
		// 回填内存缓存
		if (memoryCache.size >= MEMORY_CACHE_SIZE) {
			evictLruFromMemoryCache();
		}
		memoryCache.set(key, {
			data: dbCached,
			expiresAt: Date.now() + MEMORY_CACHE_TTL,
			lastAccessedAt: Date.now(),
		});
		return dbCached;
	}

	return null;
}

/** 写入缓存（内存 + SQLite 双写）。 */
export function saveToCache(key: string, data: EnrichedContext): void {
	if (memoryCache.size >= MEMORY_CACHE_SIZE) {
		evictLruFromMemoryCache();
	}
	memoryCache.set(key, {
		data,
		expiresAt: Date.now() + MEMORY_CACHE_TTL,
		lastAccessedAt: Date.now(),
	});
	saveToDbCache(key, data);
}
