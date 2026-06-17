import type { SafetyMode } from "@51guapi/shared";
import { storage } from "#imports";

const SAFETY_MODE_KEY = "local:safetyMode";
const AUTHORIZED_HOSTS_KEY = "local:authorizedHosts";
const PUBLISHED_TOPICS_KEY = "local:publishedTopics";
const PUBLISHED_TOPICS_MAX = 1000;
const FILL_TOMBSTONES_KEY = "local:fillTombstones";
const QUARANTINE_ALERT_KEY = "local:pendingQuarantineAlert";
/** 默认档位:off == 今天的行为(永不发布)。fail-closed 的安全默认。 */
const DEFAULT_SAFETY_MODE: SafetyMode = "off";
/** 初始授权名单种子(admin 站);用户经 side panel 可改。 */
const SEED_AUTHORIZED_HOSTS = ["dx-999-adm.ympxbys.xyz"];

// ---- 发布安全档位 + 授权名单 ----
// 写入仅限 side panel 用户动作(经 background);content 只读。
// 解析失败一律 fail-closed:档位回落 off、名单回落空,绝不"坏值放行"。

/** 读档位;非法/缺失 → 'off'(fail-closed)。 */
export async function getSafetyMode(): Promise<SafetyMode> {
	const v = await storage.getItem<unknown>(SAFETY_MODE_KEY);
	return v === "authorized" || v === "dry-run" || v === "off"
		? v
		: DEFAULT_SAFETY_MODE;
}

export async function setSafetyMode(mode: SafetyMode): Promise<void> {
	await storage.setItem(SAFETY_MODE_KEY, mode);
}

/**
 * 读授权名单。从未设置 → 种子名单;设置过但坏值(非数组)→ 空名单(fail-closed)。
 * 数组内非字符串/空串项被过滤掉。
 */
export async function getAuthorizedHosts(): Promise<string[]> {
	const v = await storage.getItem<unknown>(AUTHORIZED_HOSTS_KEY);
	if (v === undefined || v === null) return [...SEED_AUTHORIZED_HOSTS];
	if (!Array.isArray(v)) return [];
	return v.filter(
		(x): x is string => typeof x === "string" && x.trim().length > 0,
	);
}

export async function setAuthorizedHosts(hosts: string[]): Promise<void> {
	await storage.setItem(AUTHORIZED_HOSTS_KEY, hosts);
}

// ---- 跨 session 选题去重 ----
// SW 重启后 in-memory quarantinedTopics 会清零;此 store 持久化已发布选题,防跨批次重发。
// 写入为 best-effort(fire-and-forget);fail-closed 读取:非法值 → 空数组,绝不抛出。
// 上限 PUBLISHED_TOPICS_MAX 条,每次写入时修剪最旧条目。

/** 读取已发布选题集合;非法/缺失 → []。 */
export async function getPublishedTopics(): Promise<string[]> {
	const v = await storage.getItem<unknown>(PUBLISHED_TOPICS_KEY);
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string");
}

/**
 * 追加新选题到持久化集合。
 * - Set 合并去重(相同选题不重复计入)。
 * - 超过 PUBLISHED_TOPICS_MAX 时保留最新的条目(截取尾部)。
 */
export async function addPublishedTopics(topics: string[]): Promise<void> {
	if (topics.length === 0) return;
	const existing = await getPublishedTopics();
	const merged = [...new Set([...existing, ...topics])];
	const pruned =
		merged.length > PUBLISHED_TOPICS_MAX
			? merged.slice(merged.length - PUBLISHED_TOPICS_MAX)
			: merged;
	await storage.setItem(PUBLISHED_TOPICS_KEY, pruned);
}

// ---- Fill tombstone 协议(崩溃恢复) ----
// sendFill 前写盘;fill ACK 后清除。SW 重启时扫描残留 tombstone → 隔离未回执条目。

type TombstoneMap = Record<string, { tabId: number; ts: string }>;

function isTombstoneMap(v: unknown): v is TombstoneMap {
	return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function getFillTombstones(): Promise<TombstoneMap> {
	const v = await storage.getItem<unknown>(FILL_TOMBSTONES_KEY);
	return isTombstoneMap(v) ? v : {};
}

export async function writeFillTombstone(
	itemId: string,
	data: { tabId: number; ts: string },
): Promise<void> {
	const current = await getFillTombstones();
	await storage.setItem(FILL_TOMBSTONES_KEY, { ...current, [itemId]: data });
}

export async function clearFillTombstone(itemId: string): Promise<void> {
	const current = await getFillTombstones();
	const { [itemId]: _removed, ...rest } = current;
	await storage.setItem(FILL_TOMBSTONES_KEY, rest);
}

export async function clearAllFillTombstones(): Promise<void> {
	await storage.setItem(FILL_TOMBSTONES_KEY, {});
}

/** 读取待确认隔离通知数量;非法/缺失 → 0。 */
export async function getPendingQuarantineAlert(): Promise<number> {
	const v = await storage.getItem<unknown>(QUARANTINE_ALERT_KEY);
	return typeof v === "number" && v > 0 ? v : 0;
}

export async function setPendingQuarantineAlert(count: number): Promise<void> {
	await storage.setItem(QUARANTINE_ALERT_KEY, count);
}

export async function clearPendingQuarantineAlert(): Promise<void> {
	await storage.removeItem(QUARANTINE_ALERT_KEY);
}
