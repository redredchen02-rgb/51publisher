import type { ContentDraft, FillPageResponse, PublishResult, RuntimeMessage } from '../lib/types';
import { getSettings } from '../lib/storage';
import { fillDraft } from '../lib/fillers';
import { sanitizeBody } from '../lib/sanitize';
import { requestBodyFill, bodyResultFromOutcome } from '../lib/body-bridge';
import { executePublish } from '../lib/publish';

// 隔离世界 content script:接收 side panel 的 FILL_PAGE 填充;接收 background 的
// PUBLISH_GRANT 一次性"准许"才触发提交。**content 绝不自我授权**——无 grant 即从不提交。
export default defineContentScript({
  // 注入面=闸门面:收窄到授权 admin 子域 + https(与 quill-bridge / host_permissions 同步)。
  matches: ['https://dx-999-adm.ympxbys.xyz/*'],
  main() {
    browser.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message?.type === 'FILL_PAGE') {
        return handleFill(message.draft);
      }
      if (message?.type === 'PUBLISH_GRANT') {
        return handlePublishGrant();
      }
      return undefined;
    });
  },
});

// 仅在收到 background 准许后调用;闸门判定全在 background,content 不读配置、不判 host。
async function handlePublishGrant(): Promise<PublishResult> {
  try {
    return await executePublish();
  } catch (err) {
    console.error('[content] 发布触发失败', err);
    return { ok: false, dryRun: false, error: 'internal' };
  }
}

async function handleFill(draft: ContentDraft): Promise<FillPageResponse> {
  try {
    const { fieldMapping } = await getSettings();
    // 普通字段(标题/副标题/分类/标签/描述/状态/时间/作品id)。
    const results = fillDraft(draft, fieldMapping, document);

    // 正文:消毒后交主世界桥写入 Quill;三态映射抽到 bodyResultFromOutcome(可单测)。
    const bodyDef = fieldMapping.body;
    if (bodyDef && bodyDef.fieldType === 'quill' && draft.body) {
      const outcome = await requestBodyFill(sanitizeBody(draft.body), bodyDef.selector);
      results.push(bodyResultFromOutcome(outcome));
    }

    return { ok: true, results };
  } catch (err) {
    console.error('[content] 填充失败', err);
    return { ok: false, error: '填充时发生错误,请重试。' };
  }
}
