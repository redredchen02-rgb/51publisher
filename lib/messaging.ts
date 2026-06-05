import { browser } from '#imports';
import type { ContentDraft, FillPageResponse, GenerateDraftResponse, PublishPageResponse } from './types';
import type { Batch } from './batch';
import type { DriftReport } from './selectors';
import { applyPromptTemplate, type FactsBlock } from './facts';
import { DEFAULT_RECIPE } from './recipe';

/** side panel → background:生成草稿。 */
export async function requestGenerate(prompt: string): Promise<GenerateDraftResponse> {
  return browser.runtime.sendMessage({ type: 'GENERATE_DRAFT', prompt });
}

/**
 * 纯函数:从 tab 列表挑出后台发帖页 tab id。
 * 优先当前活动 tab(若它就是后台页);否则取任一 host 匹配的后台页 tab。
 * 解决「填充到当前页」对活动 tab 的脆依赖——发帖页不在最前面(切了别的分页)时也能填。
 */
export function pickAdminTabId(
  activeTab: { id?: number; url?: string } | undefined,
  hostMatchedTabs: ReadonlyArray<{ id?: number }>,
  host: string,
): number | null {
  if (activeTab?.id != null && activeTab.url?.includes(host)) return activeTab.id;
  const withId = hostMatchedTabs.find((t) => typeof t.id === 'number');
  return withId?.id ?? null;
}

/** 解析后台发帖页所在 tab id(优先活动 tab,否则按 host 在所有窗口里找)。 */
async function resolveAdminTabId(): Promise<number | null> {
  const host = DEFAULT_RECIPE.host;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  // host 权限已覆盖该域 → 无需 'tabs' 权限即可按 url 查询。
  const matched = await browser.tabs.query({ url: `https://${host}/*` });
  return pickAdminTabId(active, matched, host);
}

/** side panel → 后台发帖页 content script:填充。自动定位发帖页 tab,不依赖它是否在最前面。 */
export async function requestFill(draft: ContentDraft): Promise<FillPageResponse> {
  const tabId = await resolveAdminTabId();
  if (tabId == null) {
    return { ok: false, error: '未找到 51publisher 发帖页标签——请先在浏览器打开后台发帖页。' };
  }
  try {
    return await browser.tabs.sendMessage(tabId, { type: 'FILL_PAGE', draft });
  } catch {
    return { ok: false, error: '无法连接页面填充脚本——请在发帖页打开「添加」表单;若刚重载过扩展,请按 F5 刷新该页。' };
  }
}

/**
 * side panel → background:请求发布指定 tab。
 * 发布**改道经 background**(不再 side panel 直连 content):闸门求值 + host 取自浏览器
 * 都在 background;此处只传**显式 tabId**(绝不让 background 查 active tab)。
 */
export async function requestPublish(tabId: number): Promise<PublishPageResponse> {
  return browser.runtime.sendMessage({ type: 'PUBLISH_PAGE', tabId });
}

// ---- 批量编排(side panel → background)----

export type BatchResponse = Batch | null;

/** 启动批量:逐条生成+填充到钉住的 tab,完成后进入 awaiting-approval。 */
export async function runBatch(
  topics: string[],
  tabId: number,
  facts?: FactsBlock[],
  iterate?: boolean,
): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'RUN_BATCH', topics, tabId, facts, iterate });
}

/** 批准整批:逐条门控发布(钉住的 tab)。draftOverrides 为人工编辑的草稿覆盖(按 itemId)。 */
export async function approveBatch(tabId: number, draftOverrides?: Record<string, import('./types').ContentDraft>): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'APPROVE_BATCH', tabId, ...(draftOverrides ? { draftOverrides } : {}) });
}

/** 急停:未发布项打到 aborted。 */
export async function killBatch(): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'KILL_BATCH' });
}

/** 人工退出某隔离项(needs-human-verification → aborted)。 */
export async function releaseQuarantine(itemId: string): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'RELEASE_QUARANTINE', itemId });
}

/** 运营商显式重试单条 error/aborted 条目。 */
export async function retryBatchItemMsg(itemId: string): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'RETRY_BATCH_ITEM', itemId });
}

/** 读当前批次(加载即崩溃恢复)。 */
export async function getBatchState(): Promise<BatchResponse> {
  return browser.runtime.sendMessage({ type: 'GET_BATCH' });
}

/** 轻量漂移自检:让钉住 tab 的 content 查关键选择器是否缺失。 */
export async function checkSelectors(tabId: number): Promise<DriftReport> {
  try {
    return await browser.tabs.sendMessage(tabId, { type: 'CHECK_SELECTORS' });
  } catch {
    return { ok: false, missing: ['(无法连接页面——请确认停在 admin 发帖页)'] };
  }
}

/**
 * 用 prompt 模板 + 主题 + (可选)事实 + (可选)few-shot 组装最终 prompt。
 * 委托 lib/facts 的纯函数;facts/fewShot 省略时行为等同旧两参版(向后兼容)。
 */
export function buildPrompt(template: string, topic: string, facts?: FactsBlock, fewShot?: string): string {
  return applyPromptTemplate(template, topic, facts, fewShot);
}
