import { storage } from '#imports';
import type { Settings } from './types';

const SETTINGS_KEY = 'local:settings';
const API_KEY = 'local:apiKey';

/** 默认字段映射:来自 U0 现场勘查(docs/field-mapping-guide.md)。 */
export const DEFAULT_SETTINGS: Settings = {
  endpoint: '',
  model: 'gpt-4o-mini',
  promptTemplate:
    '你是内容编辑助手。根据主题生成一篇帖子草稿,以 JSON 返回,字段:title, subtitle, category, body(HTML), tags(数组), description。\n主题:{{topic}}',
  fieldMapping: {
    title: { selector: 'input[name="title"]', fieldType: 'text', label: '標題' },
    subtitle: { selector: 'input[name="subtitle"]', fieldType: 'text', label: '副標題' },
    category: { selector: 'select[name="type"]', fieldType: 'native-select', label: '類型' },
    body: { selector: '#editor', fieldType: 'quill', label: '文章内容' },
    tags: { selector: 'input[name="tags[]"]', fieldType: 'checkbox-multi', label: '標籤' },
    description: { selector: 'textarea[name="description"]', fieldType: 'textarea', label: '描述' },
    postStatus: { selector: 'select[name="status"]', fieldType: 'native-select', label: '狀態' },
    publishedAt: { selector: 'input[name="published_at"]', fieldType: 'date', label: '發佈時間' },
    mediaId: { selector: 'input[name="media_id"]', fieldType: 'text', label: '作品 id' },
  },
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
