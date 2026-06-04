import { storage } from '#imports';
import type { ContentDraft, Settings } from './types';
import { DEFAULT_FIELD_MAPPING } from './field-mapping';

const SETTINGS_KEY = 'local:settings';
const API_KEY = 'local:apiKey';
const CURRENT_DRAFT_KEY = 'local:currentDraft';

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
