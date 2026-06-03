import type { GenerateDraftResponse, RuntimeMessage } from '../lib/types';
import { getApiKey, getSettings } from '../lib/storage';
import { generateDraft } from '../lib/llm';

// Background service worker:调度中心。
// - 点扩展图标打开 side panel
// - 路由 GENERATE_DRAFT → 调大模型(鉴权 + CORS 集中在此)
export default defineBackground(() => {
  browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[bg] setPanelBehavior 失败', err));

  // webextension-polyfill 语义:监听器返回 Promise 即把其结果作为响应回传,
  // 天然避免 MV3 原生 chrome API "async 直接 return 丢响应" 的坑。
  browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message?.type === 'GENERATE_DRAFT') {
      return handleGenerate(message.prompt);
    }
    // 其余消息(如 FILL_PAGE)由 content script 处理,这里不认领。
    return undefined;
  });
});

async function handleGenerate(prompt: string): Promise<GenerateDraftResponse> {
  // storage 读取或生成异常都要降级成结构化错误,否则 side panel 会一直等不到响应而卡死。
  try {
    const [settings, apiKey] = await Promise.all([getSettings(), getApiKey()]);
    return await generateDraft(prompt, { settings, apiKey });
  } catch (err) {
    console.error('[bg] 生成草稿失败', err);
    return { ok: false, kind: 'network', error: '生成草稿时发生内部错误,请重试。' };
  }
}
