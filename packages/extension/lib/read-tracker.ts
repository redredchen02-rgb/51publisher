import { storage } from "#imports";

// 持久化「已读」标记:操作者展开审阅条目 → 写盘,SW kill 后不丢失。
// 每次新批次启动(handleRunBatch)时由 background 调 clearReadItems() 重置。

const READ_ITEMS_KEY = "local:readItems";

/** 标记条目为已读。幂等(Set 语义,不重复写入)。 */
export async function markItemRead(itemId: string): Promise<void> {
	const current = await storage.getItem<string[]>(READ_ITEMS_KEY);
	const arr = Array.isArray(current) ? current : [];
	if (arr.includes(itemId)) return;
	await storage.setItem(READ_ITEMS_KEY, [...arr, itemId]);
}

/** 查询单个条目是否已读。 */
export async function isItemRead(itemId: string): Promise<boolean> {
	const current = await storage.getItem<string[]>(READ_ITEMS_KEY);
	const arr = Array.isArray(current) ? current : [];
	return arr.includes(itemId);
}

/** 返回所有已读条目 id 的 Set。 */
export async function getReadItems(): Promise<Set<string>> {
	const current = await storage.getItem<string[]>(READ_ITEMS_KEY);
	const arr = Array.isArray(current) ? current : [];
	return new Set(arr);
}

/** 清空已读记录(新批次启动时调用)。 */
export async function clearReadItems(): Promise<void> {
	await storage.setItem(READ_ITEMS_KEY, []);
}
