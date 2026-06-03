import { browser } from '#imports';
import type { ContentDraft, FillPageResponse, GenerateDraftResponse } from './types';

/** side panel → background:生成草稿。 */
export async function requestGenerate(prompt: string): Promise<GenerateDraftResponse> {
  return browser.runtime.sendMessage({ type: 'GENERATE_DRAFT', prompt });
}

/** side panel → 当前标签页 content script:填充。 */
export async function requestFill(draft: ContentDraft): Promise<FillPageResponse> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: '未找到当前标签页。' };
  try {
    return await browser.tabs.sendMessage(tab.id, { type: 'FILL_PAGE', draft });
  } catch {
    return { ok: false, error: '无法连接页面填充脚本——请确认当前停在 51publisher 发帖页并已打开「添加」表单。' };
  }
}

/** 用 prompt 模板 + 主题组装最终 prompt。 */
export function buildPrompt(template: string, topic: string): string {
  return template.includes('{{topic}}') ? template.replaceAll('{{topic}}', topic) : `${template}\n主题:${topic}`;
}
