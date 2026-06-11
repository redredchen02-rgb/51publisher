import { browser } from '#imports';
import type {
  ContentDraft,
  FillPageResponse,
  GenerateDraftResponse,
  PublishPageResponse,
  RuntimeMessage,
} from '@51publisher/shared';
import type { Batch } from './batch';
import type { DriftReport } from './selectors';
import { applyPromptTemplate, type FactsBlock } from '@51publisher/shared';
import { DEFAULT_RECIPE } from './recipe';

// MV3 Service Worker 随时可能被回收。sendMessage 若 SW 死亡可能永久 pending。
// sendMsg 包一层 race，超时则 reject → withBusy catch 显示"请重试"而非卡死。
const SW_TIMEOUT: Partial<Record<RuntimeMessage['type'], number>> = {
  RUN_BATCH: 300_000, // 多条 × LLM，最多 5 分钟
  APPROVE_BATCH: 300_000,
  GENERATE_DRAFT: 30_000,
  PUBLISH_PAGE: 30_000,
  GET_BATCH: 10_000,
  KILL_BATCH: 10_000,
  RELEASE_QUARANTINE: 10_000,
  RETRY_BATCH_ITEM: 10_000,
  DISCARD_BATCH_ITEM: 10_000,
};

function sendMsg<T>(msg: RuntimeMessage): Promise<T> {
  const ms = SW_TIMEOUT[msg.type] ?? 30_000;
  return Promise.race([
    browser.runtime.sendMessage(msg) as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`[sw/${msg.type}] 未在 ${ms / 1000}s 内响应，SW 可能已回收，请重试`)), ms),
    ),
  ]);
}

/** side panel → background:生成草稿。 */
export async function requestGenerate(prompt: string): Promise<GenerateDraftResponse> {
  return sendMsg<GenerateDraftResponse>({ type: 'GENERATE_DRAFT', prompt });
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
export async function resolveAdminTabId(): Promise<number | null> {
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
  return sendMsg<PublishPageResponse>({ type: 'PUBLISH_PAGE', tabId });
}

// ---- 批量编排(side panel → background)----

export type BatchResponse = Batch | null;

/** 启动批量:逐条生成+填充到钉住的 tab,完成后进入 awaiting-approval。 */
export async function runBatch(
  topics: string[],
  tabId: number,
  facts?: FactsBlock[],
  coverImageUrls?: string[],
  iterate?: boolean,
  topicIds?: string[],
): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'RUN_BATCH', topics, tabId, facts, iterate, coverImageUrls, topicIds });
}

/** 批准整批:逐条门控发布(钉住的 tab)。draftOverrides 为人工编辑的草稿覆盖(按 itemId)。 */
export async function approveBatch(
  tabId: number,
  draftOverrides?: Record<string, import('@51publisher/shared').ContentDraft>,
): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'APPROVE_BATCH', tabId, ...(draftOverrides ? { draftOverrides } : {}) });
}

/** 急停:未发布项打到 aborted。 */
export async function killBatch(): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'KILL_BATCH' });
}

/** 人工退出某隔离项(needs-human-verification → aborted)。 */
export async function releaseQuarantine(itemId: string): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'RELEASE_QUARANTINE', itemId });
}

/** 标记该条草稿已被操作者手动修改(直发率度量置位)。 */
export async function markItemEdited(itemId: string): Promise<void> {
  return browser.runtime.sendMessage({ type: 'MARK_ITEM_EDITED', itemId });
}

/** 运营商显式重试单条 error/aborted 条目。 */
export async function retryBatchItemMsg(itemId: string): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'RETRY_BATCH_ITEM', itemId });
}

/** 操作者否决/丢弃单条 awaiting-approval 条目(→ aborted)。 */
export async function discardBatchItem(itemId: string): Promise<void> {
  await sendMsg<BatchResponse>({ type: 'DISCARD_BATCH_ITEM', itemId });
}

/** 读当前批次(加载即崩溃恢复)。 */
export async function getBatchState(): Promise<BatchResponse> {
  return sendMsg<BatchResponse>({ type: 'GET_BATCH' });
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
