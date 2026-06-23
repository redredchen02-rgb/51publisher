import type { SafetyMode } from "@51publisher/shared";
import { storage } from "#imports";

const SAFETY_MODE_KEY = "local:safetyMode";
const AUTHORIZED_HOSTS_KEY = "local:authorizedHosts";
const PUBLISHED_TOPICS_KEY = "local:publishedTopics";
const PUBLISHED_TOPICS_MAX = 1000;
const FILL_TOMBSTONES_KEY = "local:fillTombstones";
const QUARANTINE_ALERT_KEY = "local:pendingQuarantineAlert";
const FIRST_FLIGHT_KEY = "local:firstFlight";
const FIRST_FLIGHT_PENDING_KEY = "local:firstFlightPending";
const FIRST_FLIGHT_RESET_COUNT_KEY = "local:firstFlightResetCount";

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

// ---- First-flight 安全标记(自家授权站「首飞」互锁)----
// 单一持久化键 local:firstFlight,承载 {mode, pending}:
//   - mode:首飞期间被「降级保护」的工作档位(arm 前的档位,通常 dry-run);revert 时回落到它。
//   - pending:一次性发布意图的指纹(itemId/tabId/host/contentHash/nonce/ts)。
// 写入是 durable(await + 读回确认),绝不 fire-and-forget。
// fail-closed 读取:present-but-unparseable → { bad:true }(调用方据此 block + 强制 reset);
// cleanly-absent → { absent:true }(忽略,无标记走正常 canSubmit 路径)。

export interface FirstFlightPending {
	itemId: string;
	tabId: number;
	host: string;
	/** 彩排时对 item.draft 算的 SHA-256;派发时重算比对(防「彩排 A 发 B」)。 */
	contentHash: string;
	/** arm 时在 SW 内存生成并持久化;interlock 额外要求活动内存 nonce 相等。 */
	nonce: string;
	ts: string;
}

export interface FirstFlightMarker {
	/** arm 前被保护的工作档位(revert 目标);取值同 SafetyMode。 */
	mode: SafetyMode;
	pending: FirstFlightPending | null;
}

/** getFirstFlight 的判别式结果:干净缺失 / 坏值 / 正常解析。 */
export type FirstFlightRead =
	| { state: "absent" }
	| { state: "bad" }
	| { state: "ok"; marker: FirstFlightMarker };

function isValidPending(v: unknown): v is FirstFlightPending {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	return (
		typeof o.itemId === "string" &&
		typeof o.tabId === "number" &&
		typeof o.host === "string" &&
		typeof o.contentHash === "string" &&
		typeof o.nonce === "string" &&
		typeof o.ts === "string"
	);
}

function parseFirstFlight(v: unknown): FirstFlightRead {
	if (v === undefined || v === null) return { state: "absent" };
	if (typeof v !== "object") return { state: "bad" };
	const o = v as Record<string, unknown>;
	const mode = o.mode;
	if (mode !== "off" && mode !== "dry-run" && mode !== "authorized")
		return { state: "bad" };
	const pending = o.pending;
	if (pending === null || pending === undefined)
		return { state: "ok", marker: { mode, pending: null } };
	if (!isValidPending(pending)) return { state: "bad" };
	return { state: "ok", marker: { mode, pending } };
}

/** 读首飞标记;干净缺失 / 坏值 / 正常解析三态判别。 */
export async function getFirstFlight(): Promise<FirstFlightRead> {
	const v = await storage.getItem<unknown>(FIRST_FLIGHT_KEY);
	return parseFirstFlight(v);
}

/**
 * durable 写首飞标记:写入 → 读回确认。
 * 读回与期望不一致(写失败 / 并发覆盖)→ 返回 false,调用方据此 REJECT arm,
 * 绝不进入「authorized 已置但标记缺失」的危险态。
 */
export async function writeFirstFlight(
	marker: FirstFlightMarker,
): Promise<boolean> {
	await storage.setItem(FIRST_FLIGHT_KEY, marker);
	const readBack = await storage.getItem<unknown>(FIRST_FLIGHT_KEY);
	const parsed = parseFirstFlight(readBack);
	if (parsed.state !== "ok") return false;
	const m = parsed.marker;
	if (m.mode !== marker.mode) return false;
	if ((m.pending === null) !== (marker.pending === null)) return false;
	if (m.pending && marker.pending) {
		if (
			m.pending.itemId !== marker.pending.itemId ||
			m.pending.tabId !== marker.pending.tabId ||
			m.pending.host !== marker.pending.host ||
			m.pending.contentHash !== marker.pending.contentHash ||
			m.pending.nonce !== marker.pending.nonce
		)
			return false;
	}
	return true;
}

/** 清整个首飞标记(连 mode 字段一起)。 */
export async function clearFirstFlight(): Promise<void> {
	await storage.removeItem(FIRST_FLIGHT_KEY);
}

// ---- 首飞授权标记(R7 fail-safe,PR-B Unit 4)----
// 与 `local:safetyMode` **分离**的 pending 键(纯加性,不动核心档位存储)。
// 不变量「mode=authorized ⟹ pending 在场」由 background 的 arm/revert **严格排序**维持:
//   arm:  写 pending → 再 setSafetyMode('authorized')(authorized 时标记必已在场)
//   revert: setSafetyMode('dry-run') → 再 clear pending(降档在先,绝不留 authorized+无标记)
// 故崩溃时持久态只可能是 {dry-run,无} / {dry-run,有} / {authorized,有},永不 {authorized,无}。
// pending.nonce 持久化,与 SW 内存活动 nonce 比对:内存 nonce 随 SW 回收消失 → 残留 pending
// 必不匹配 → interlock block + 启动复位(顺带封纯 storage 层伪造)。

function isFirstFlightPending(v: unknown): v is FirstFlightPending {
	if (!v || typeof v !== "object") return false;
	const p = v as Record<string, unknown>;
	return (
		typeof p.itemId === "string" &&
		p.itemId.length > 0 &&
		typeof p.tabId === "number" &&
		typeof p.host === "string" &&
		p.host.length > 0 &&
		typeof p.contentHash === "string" &&
		p.contentHash.length > 0 &&
		typeof p.nonce === "string" &&
		p.nonce.length > 0 &&
		typeof p.ts === "string"
	);
}

/**
 * 读首飞标记。
 * - 缺失 → `{pending:null, corrupt:false}`(常态,无授权窗口)。
 * - 存在且形态合法 → `{pending, corrupt:false}`。
 * - 存在但形态非法 → `{pending:null, corrupt:true}`(启动复位据此**强制降档**,绝不当无窗口忽略)。
 */
export async function getFirstFlightPending(): Promise<{
	pending: FirstFlightPending | null;
	corrupt: boolean;
}> {
	const v = await storage.getItem<unknown>(FIRST_FLIGHT_PENDING_KEY);
	if (v === undefined || v === null) return { pending: null, corrupt: false };
	if (!isFirstFlightPending(v)) return { pending: null, corrupt: true };
	return { pending: v, corrupt: false };
}

/** 写首飞标记(arm:**必须在** `setSafetyMode('authorized')` 之前调用)。 */
export async function setFirstFlightPending(
	pending: FirstFlightPending,
): Promise<void> {
	await storage.setItem(FIRST_FLIGHT_PENDING_KEY, pending);
}

/** 清首飞标记(revert:**必须在** `setSafetyMode('dry-run')` 之后调用)。幂等。 */
export async function clearFirstFlightPending(): Promise<void> {
	await storage.removeItem(FIRST_FLIGHT_PENDING_KEY);
}

// 连续强制复位计数(持久,跨 SW 重启)。每次启动复位 +1;干净 settle(成功退档)归 0。
// 达阈值 → 回落 off + 需显式重启用(防持续 wedge 被当噪音)。

/** 读连续复位计数;非法/缺失 → 0。 */
export async function getFirstFlightResetCount(): Promise<number> {
	const v = await storage.getItem<unknown>(FIRST_FLIGHT_RESET_COUNT_KEY);
	return typeof v === "number" && v > 0 ? v : 0;
}

export async function setFirstFlightResetCount(n: number): Promise<void> {
	await storage.setItem(FIRST_FLIGHT_RESET_COUNT_KEY, n);
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
