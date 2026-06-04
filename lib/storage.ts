import { storage } from '#imports';
import type { ContentDraft, SafetyMode, Settings } from './types';
import type { Batch } from './batch';
import { recoverBatch } from './batch';
import type { TrajectoryRecord, TrajectoryInput } from './trajectory';
import { appendRecord } from './trajectory';
import { DEFAULT_FIELD_MAPPING } from './field-mapping';

const SETTINGS_KEY = 'local:settings';
const API_KEY = 'local:apiKey';
const CURRENT_DRAFT_KEY = 'local:currentDraft';
const SAFETY_MODE_KEY = 'local:safetyMode';
const AUTHORIZED_HOSTS_KEY = 'local:authorizedHosts';
const BATCH_KEY = 'local:batch';
const TRAJECTORY_KEY = 'local:trajectory';
const PUBLISHED_TOPICS_KEY = 'local:publishedTopics';
const PUBLISHED_TOPICS_MAX = 1000;

/** 默认档位:off == 今天的行为(永不发布)。fail-closed 的安全默认。 */
const DEFAULT_SAFETY_MODE: SafetyMode = 'off';
/** 初始授权名单种子(admin 站);用户经 side panel 可改。 */
const SEED_AUTHORIZED_HOSTS = ['dx-999-adm.ympxbys.xyz'];

/** 默认设置。字段映射拆到 lib/field-mapping.ts(不依赖 #imports,供 e2e/contract 复用)。 */
export const DEFAULT_SETTINGS: Settings = {
  endpoint: '',
  model: 'gpt-4o-mini',
  promptTemplate:
    '你是内容编辑助手。根据主题生成一篇帖子草稿,以 JSON 返回,字段:title, subtitle, category, body(HTML), tags(数组), description。\n主题:{{topic}}',
  fieldMapping: DEFAULT_FIELD_MAPPING,
};

/** 读取设置,缺失项回落默认值(storage 为空时返回完整默认对象)。 */
export async function getSettings(): Promise<Settings> {
  const stored = await storage.getItem<Partial<Settings>>(SETTINGS_KEY);
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    fieldMapping: { ...DEFAULT_SETTINGS.fieldMapping, ...(stored.fieldMapping ?? {}) },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await storage.setItem(SETTINGS_KEY, settings);
}

/** API key 单独存取(明文存于 chrome.storage.local,设置页须提示风险)。 */
export async function getApiKey(): Promise<string> {
  return (await storage.getItem<string>(API_KEY)) ?? '';
}

export async function saveApiKey(key: string): Promise<void> {
  await storage.setItem(API_KEY, key);
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
  return v === 'authorized' || v === 'dry-run' || v === 'off' ? v : DEFAULT_SAFETY_MODE;
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
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

export async function setAuthorizedHosts(hosts: string[]): Promise<void> {
  await storage.setItem(AUTHORIZED_HOSTS_KEY, hosts);
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
export async function appendTrajectory(input: TrajectoryInput): Promise<{ snapshotDropped: boolean }> {
  const current = await getTrajectory();
  const { list, snapshotDropped } = appendRecord(current, input);
  await storage.setItem(TRAJECTORY_KEY, list);
  return { snapshotDropped };
}

export async function clearTrajectory(): Promise<void> {
  await storage.removeItem(TRAJECTORY_KEY);
}

// ---- 跨 session 选题去重 ----
// SW 重启后 in-memory quarantinedTopics 会清零;此 store 持久化已发布选题,防跨批次重发。
// 写入为 best-effort(fire-and-forget);fail-closed 读取:非法值 → 空数组,绝不抛出。
// 上限 PUBLISHED_TOPICS_MAX 条,每次写入时修剪最旧条目。

/** 读取已发布选题集合;非法/缺失 → []。 */
export async function getPublishedTopics(): Promise<string[]> {
  const v = await storage.getItem<unknown>(PUBLISHED_TOPICS_KEY);
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
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
  const pruned = merged.length > PUBLISHED_TOPICS_MAX ? merged.slice(merged.length - PUBLISHED_TOPICS_MAX) : merged;
  await storage.setItem(PUBLISHED_TOPICS_KEY, pruned);
}
