import type {
	ContentDraft,
	FewShotPair,
	SafetyMode,
	Settings,
} from "@51publisher/shared";
import { DEFAULT_FIELD_MAPPING } from "@51publisher/shared";
import { storage } from "#imports";
import { clearBackendUrlCache } from "./backend-url";
import type { Batch } from "./batch";
import { recoverBatch } from "./batch";
import { fetchRemoteMappings } from "./config-client";
import type { TrajectoryInput, TrajectoryRecord } from "./trajectory";
import { appendRecord } from "./trajectory";

const SETTINGS_KEY = "local:settings";
const API_KEY = "local:apiKey";
const BACKEND_TOKEN_KEY = "local:backendToken";
const CURRENT_DRAFT_KEY = "local:currentDraft";
const SAFETY_MODE_KEY = "local:safetyMode";
const AUTHORIZED_HOSTS_KEY = "local:authorizedHosts";
const BATCH_KEY = "local:batch";
const TRAJECTORY_KEY = "local:trajectory";
const PUBLISHED_TOPICS_KEY = "local:publishedTopics";
const PUBLISHED_TOPICS_MAX = 1000;

/** 默认档位:off == 今天的行为(永不发布)。fail-closed 的安全默认。 */
const DEFAULT_SAFETY_MODE: SafetyMode = "off";
/** 初始授权名单种子(admin 站);用户经 side panel 可改。 */
const SEED_AUTHORIZED_HOSTS = ["dx-999-adm.ympxbys.xyz"];

/** 默认设置。字段映射拆到 lib/field-mapping.ts(不依赖 #imports,供 e2e/contract 复用)。 */
export const DEFAULT_SETTINGS: Settings = {
	endpoint: "",
	model: "gpt-4o-mini",
	fallbackModel: "",
	// 程序化结构化生成(防幻觉):模型只写口吻散文「槽位」,作品名/集数/制作/连结/分类由系统注入。
	// 占位符:{{fewshot}} few-shot 范例 / {{topic}} 选题 / {{facts}} 结构化事实块。
	promptTemplate: [
		"{{fewshot}}你是「51娘」,成人動畫/裏番與成人同人漫畫介紹站的看板娘,口吻活潑,以「嗨嗨~大家好我是51娘」開場、結尾招呼各位紳士。",
		"",
		"你的任务:只写「口吻散文」,不要拼装整篇正文。作品名、集数、制作、连结、抬头、分类标签由系统填入,你绝不要自己写它们。",
		"",
		"铁律:",
		"1. 只根据【事实】写;严禁编造或陈述任何【事实】未给出的具体信息(年份、声优、剧情细节等),缺的信息直接不提。",
		"2. 散文里绝不写任何 URL/连结,也不要写「漢化連結」「無修連結」这类条目——这些由系统注入。",
		"3. 不要罗列「作品名=…」「集数=…」这类字段,那由系统的抬头块负责;你只写引子与看点的口语化介绍。",
		"",
		"以 JSON 返回这些字段(全部纯文本,不含 HTML):",
		"- intro:开场引子(51娘 口吻,1–3 句)",
		"- highlights:看点介绍(2–4 句,只用【事实】范围内的卖点)",
		"- titleSuffix:标题后缀(如「成人動畫介紹」「成人同人推薦」;系统会前置作品名)",
		"- subtitle:一句俏皮副标题",
		"- outro:结尾招呼(可选)",
		"- category:分类(从后台已知分类里挑;不确定就留空)",
		"- tags:标签数组(题材相关;不确定就给空数组)",
		"",
		"主题:{{topic}}",
		"",
		"{{facts}}",
	].join("\n"),
	fewShotPairs: [] as FewShotPair[],
	recommendedTags: [] as string[],
	fieldMapping: DEFAULT_FIELD_MAPPING,
	dailyBatchSize: 5,
};

/** dailyBatchSize 合法范围 [1, 20];undefined → 默认 5。 */
function clampDailyBatchSize(v: number | undefined): number {
	if (v === undefined) return 5;
	return Math.max(1, Math.min(20, Math.round(v)));
}

/** 读取设置,缺失项回落默认值(storage 为空时返回完整默认对象)。 */
export async function getSettings(): Promise<Settings> {
	const stored = await storage.getItem<Partial<Settings>>(SETTINGS_KEY);
	if (!stored) return structuredClone(DEFAULT_SETTINGS);
	const merged: Settings = {
		...DEFAULT_SETTINGS,
		...stored,
		fieldMapping: {
			...DEFAULT_SETTINGS.fieldMapping,
			...(stored.fieldMapping ?? {}),
		},
	};
	// fewShotPairs is the source of truth for fewShotExamples; when pairs are
	// explicitly stored as empty, clear fewShotExamples instead of falling back
	// to the DEFAULT_SETTINGS example string.
	if (stored.fewShotPairs !== undefined && stored.fewShotPairs.length === 0) {
		merged.fewShotExamples = undefined;
	} else if (merged.fewShotPairs && merged.fewShotPairs.length > 0) {
		merged.fewShotExamples = deriveFewShotExamples(merged.fewShotPairs);
	}
	// 读取时确保 dailyBatchSize 始终在合法范围内
	merged.dailyBatchSize = clampDailyBatchSize(merged.dailyBatchSize);
	return merged;
}

export async function saveSettings(settings: Settings): Promise<void> {
	// 写入前 clamp dailyBatchSize，防止越界值落盘
	const toSave: Settings = {
		...settings,
		dailyBatchSize: clampDailyBatchSize(settings.dailyBatchSize),
	};
	await storage.setItem(SETTINGS_KEY, toSave);
	// 清除后端 URL 缓存，确保下次请求使用新地址
	clearBackendUrlCache();
}

/** API key 单独存取(明文存于 chrome.storage.local,设置页须提示风险)。 */
export async function getApiKey(): Promise<string> {
	return (await storage.getItem<string>(API_KEY)) ?? "";
}

export async function saveApiKey(key: string): Promise<void> {
	await storage.setItem(API_KEY, key);
}

/** 后端 JWT token（与 apiKey 分开存取）。 */
export async function getBackendToken(): Promise<string> {
	return (await storage.getItem<string>(BACKEND_TOKEN_KEY)) ?? "";
}

export async function saveBackendToken(token: string): Promise<void> {
	await storage.setItem(BACKEND_TOKEN_KEY, token);
}

// 当前在编草稿的崩溃恢复(≠ 草稿库):side panel 重开/SW 回收/目标页刷新都可能丢失,
// 故每次草稿变更写一份;"下一条"或发布完成时清除。
export async function getCurrentDraft(): Promise<ContentDraft | null> {
	return (await storage.getItem<ContentDraft>(CURRENT_DRAFT_KEY)) ?? null;
}

export async function saveCurrentDraft(draft: ContentDraft): Promise<void> {
	await storage.setItem(CURRENT_DRAFT_KEY, draft);
}

export async function clearCurrentDraft(): Promise<void> {
	await storage.removeItem(CURRENT_DRAFT_KEY);
}

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

const FIRST_FLIGHT_KEY = "local:firstFlight";

export interface FirstFlightPending {
	itemId: string;
	tabId: number;
	host: string;
	contentHash: string;
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

// ---- 批量队列持久化 + 崩溃恢复 ----
// MV3 SW 随时被回收;每次状态推进都写盘。加载时跑 recoverBatch:
// 任何 publish-dispatched(无回执)→ needs-human-verification 隔离,**绝不自动重发**。

/** 读批次。读到即应用崩溃恢复(在途 dispatched → 隔离)。无批次 → null。 */
export async function getBatch(): Promise<Batch | null> {
	const stored = await storage.getItem<Batch>(BATCH_KEY);
	if (!stored || !Array.isArray(stored.items)) return null;
	return recoverBatch(stored);
}

export async function saveBatch(batch: Batch): Promise<void> {
	await storage.setItem(BATCH_KEY, batch);
}

export async function clearBatch(): Promise<void> {
	await storage.removeItem(BATCH_KEY);
}

// ---- 轨迹存档(追加式 + 运行时脱敏闸门)----

export async function getTrajectory(): Promise<TrajectoryRecord[]> {
	const stored = await storage.getItem<TrajectoryRecord[]>(TRAJECTORY_KEY);
	return Array.isArray(stored) ? stored : [];
}

/**
 * 追加一条轨迹。脱敏闸门(scrubSnapshot)在 appendRecord 内部跑:
 * rawSnapshot 清洗失败 → 不存快照(snapshotDropped=true),record 仍落。
 * 返回 snapshotDropped 供调用方报警。
 */
export async function appendTrajectory(
	input: TrajectoryInput,
): Promise<{ snapshotDropped: boolean }> {
	const current = await getTrajectory();
	const { list, snapshotDropped } = appendRecord(current, input);
	await storage.setItem(TRAJECTORY_KEY, list);
	return { snapshotDropped };
}

export async function clearTrajectory(): Promise<void> {
	await storage.removeItem(TRAJECTORY_KEY);
}

// ---- Few-shot 范例（R11 一键存为范例）----

export function deriveFewShotExamples(pairs: FewShotPair[]): string {
	return pairs.map((p) => `${p.input}\n---\n${p.output}`).join("\n\n");
}

const MAX_FEW_SHOT = 8;

/**
 * 追加一条 few-shot 范例到末尾（只写 fewShotPairs；fewShotExamples 由 getSettings() 读时派生）。
 * 返回 { ok: false, reason: 'full' } 当已达上限，不写入。
 */
export async function addFewShotPair(
	pair: FewShotPair,
): Promise<{ ok: boolean; reason?: "full" }> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length >= MAX_FEW_SHOT) return { ok: false, reason: "full" };
	const next = [...current, pair];
	await saveSettings({
		...settings,
		fewShotPairs: next,
	});
	return { ok: true };
}

/**
 * 移除末尾一条 few-shot 范例（LIFO 撤销；不影响其他条目）。
 * 空列表时幂等跳过。
 */
export async function removeLastFewShotPair(): Promise<void> {
	const settings = await getSettings();
	const current = settings.fewShotPairs ?? [];
	if (current.length === 0) return;
	const next = current.slice(0, -1);
	await saveSettings({
		...settings,
		fewShotPairs: next,
	});
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

// ---- Fill tombstone 协议(崩溃恢复) ----
// sendFill 前写盘;fill ACK 后清除。SW 重启时扫描残留 tombstone → 隔离未回执条目。

const FILL_TOMBSTONES_KEY = "local:fillTombstones";
const QUARANTINE_ALERT_KEY = "local:pendingQuarantineAlert";

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

// ---- 首飞授权标记(R7 fail-safe,PR-B Unit 4)----
// 与 `local:safetyMode` **分离**的 pending 键(纯加性,不动核心档位存储)。
// 不变量「mode=authorized ⟹ pending 在场」由 background 的 arm/revert **严格排序**维持:
//   arm:  写 pending → 再 setSafetyMode('authorized')(authorized 时标记必已在场)
//   revert: setSafetyMode('dry-run') → 再 clear pending(降档在先,绝不留 authorized+无标记)
// 故崩溃时持久态只可能是 {dry-run,无} / {dry-run,有} / {authorized,有},永不 {authorized,无}。
// pending.nonce 持久化,与 SW 内存活动 nonce 比对:内存 nonce 随 SW 回收消失 → 残留 pending
// 必不匹配 → interlock block + 启动复位(顺带封纯 storage 层伪造)。
const FIRST_FLIGHT_PENDING_KEY = "local:firstFlightPending";

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
const FIRST_FLIGHT_RESET_COUNT_KEY = "local:firstFlightResetCount";

/** 读连续复位计数;非法/缺失 → 0。 */
export async function getFirstFlightResetCount(): Promise<number> {
	const v = await storage.getItem<unknown>(FIRST_FLIGHT_RESET_COUNT_KEY);
	return typeof v === "number" && v > 0 ? v : 0;
}

export async function setFirstFlightResetCount(n: number): Promise<void> {
	await storage.setItem(FIRST_FLIGHT_RESET_COUNT_KEY, n);
}

// ---- Dry-run 填充报告 ----
// 每次 dry-run 批准后写入;下次覆盖;side panel 读出展示。fail-closed:非法值 → null。

const DRY_RUN_REPORT_KEY = "local:dryRunReport";

export async function saveDryRunReport(
	report: import("@51publisher/shared").DryRunReport,
): Promise<void> {
	await storage.setItem(DRY_RUN_REPORT_KEY, report);
}

export async function getDryRunReport(): Promise<
	import("@51publisher/shared").DryRunReport | null
> {
	const v = await storage.getItem<unknown>(DRY_RUN_REPORT_KEY);
	if (
		v &&
		typeof v === "object" &&
		"batchId" in v &&
		"items" in v &&
		Array.isArray((v as Record<string, unknown>).items)
	) {
		return v as import("@51publisher/shared").DryRunReport;
	}
	return null;
}

export async function clearDryRunReport(): Promise<void> {
	await storage.removeItem(DRY_RUN_REPORT_KEY);
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

// ---- 远程配置热刷新 ----

/**
 * 拉取后端最新字段映射并写入本地 settings。
 * 供 Background Service Worker 启动时调用(onStartup / onInstalled),
 * 实现选择器配置云端热更新——页面改版只改后端即可,无需扩展发版。
 *
 * 后端不可达时 fail-closed,保留本地已有映射(不覆盖)。
 * 返回 remote=true 表示成功拉取了远程配置。
 */
export async function refreshRemoteMappings(): Promise<{ remote: boolean }> {
	const { mappings, remote } = await fetchRemoteMappings();
	if (!remote) return { remote: false };

	const settings = await getSettings();
	settings.fieldMapping = { ...DEFAULT_FIELD_MAPPING, ...mappings };
	await saveSettings(settings);
	return { remote: true };
}
