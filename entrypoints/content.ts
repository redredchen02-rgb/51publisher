import type { ContentDraft, FillPageResponse, RuntimeMessage } from '../lib/types';
import { getSettings } from '../lib/storage';
import { fillDraft } from '../lib/fillers';
import { sanitizeBody } from '../lib/sanitize';
import { requestBodyFill } from '../lib/body-bridge';

// 隔离世界 content script:接收 side panel 的 FILL_PAGE,填充表单字段。
// 绝不提交:只 set value + input/change + checkbox 勾选;正文交主世界桥写入 Quill。
export default defineContentScript({
  matches: ['*://*.ympxbys.xyz/*'],
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message?.type === 'FILL_PAGE') {
        return handleFill(message.draft);
      }
      return undefined;
    });
  },
});

async function handleFill(draft: ContentDraft): Promise<FillPageResponse> {
  try {
    const { fieldMapping } = await getSettings();
    // 普通字段(标题/副标题/分类/标签/描述/状态/时间/作品id)。
    const results = fillDraft(draft, fieldMapping, document);

    // 正文:消毒后交主世界桥写入 Quill;桥不可用则降级"手动粘贴"。
    const bodyDef = fieldMapping.body;
    if (bodyDef && bodyDef.fieldType === 'quill' && draft.body) {
      const outcome = await requestBodyFill(sanitizeBody(draft.body), bodyDef.selector);
      results.push({ field: 'body', status: outcome.ok ? 'filled' : 'degraded', note: outcome.note });
    }

    return { ok: true, results };
  } catch (err) {
    console.error('[content] 填充失败', err);
    return { ok: false, error: '填充时发生错误,请重试。' };
  }
}
