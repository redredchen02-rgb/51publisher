import { pasteIntoQuill } from '../lib/quill-paste';
import {
  EVT_FILL_BODY,
  EVT_BODY_FILLED,
  EVT_BRIDGE_READY,
  type FillBodyDetail,
  type BodyFilledDetail,
} from '../lib/body-bridge';

// 主世界 content script(仅 Chromium):能访问页面 window.Quill。
// 监听隔离世界的 fill-body,用 Quill API 写入正文,回 body-filled。
// 入站事件按不可信处理:只做正文写入,绝不收发任何机密。
export default defineContentScript({
  matches: ['*://*.ympxbys.xyz/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    document.addEventListener(EVT_FILL_BODY, (e: Event) => {
      const detail = (e as CustomEvent<FillBodyDetail>).detail;
      if (!detail || typeof detail.html !== 'string' || typeof detail.selector !== 'string') return;
      let result: BodyFilledDetail;
      try {
        const res = pasteIntoQuill(detail.html, detail.selector, window as unknown as { Quill?: never }, document);
        result = { reqId: detail.reqId, ok: res.ok, error: res.error };
      } catch (err) {
        result = { reqId: detail.reqId, ok: false, error: '正文写入异常,请手动粘贴。' };
      }
      document.dispatchEvent(new CustomEvent<BodyFilledDetail>(EVT_BODY_FILLED, { detail: result }));
    });

    // 就绪握手:隔离端可据此确认桥已加载。
    document.dispatchEvent(new CustomEvent(EVT_BRIDGE_READY));
  },
});
