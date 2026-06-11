import { getDb } from "./scraper/pending-db.js";

/**
 * SQLite 持久化 key-value 配置储存。
 * 对应 config_store 表 (key TEXT PRIMARY KEY, value TEXT)。
 * value 存 JSON 字符串，调用方自行序列化/反序列化。
 */

/** 取出字符串值，不存在返回 null。 */
export function configGet(key: string): string | null {
	const db = getDb();
	const row = db
		.prepare("SELECT value FROM config_store WHERE key = ?")
		.get(key) as { value: string } | undefined;
	return row ? row.value : null;
}

/** 设置字符串值 (UPSERT)。 */
export function configSet(key: string, value: string): void {
	const db = getDb();
	db.prepare(
		"INSERT INTO config_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
}

/** 列出全部键名。 */
export function configKeys(): string[] {
	const db = getDb();
	return (
		db.prepare("SELECT key FROM config_store").all() as { key: string }[]
	).map((r) => r.key);
}

/** 删除一个键。 */
export function configDelete(key: string): void {
	const db = getDb();
	db.prepare("DELETE FROM config_store WHERE key = ?").run(key);
}
