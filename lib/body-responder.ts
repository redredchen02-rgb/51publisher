import { pasteIntoQuill } from './quill-paste';
import {
  EVT_FILL_BODY,
  EVT_BODY_FILLED,
  EVT_BRIDGE_READY,
  type FillBodyDetail,
  type BodyFilledDetail,
} from './body-bridge';

// 主世界端 responder(从 entrypoints/quill-bridge.content.ts 抽出)。
// 抽成纯安装函数的两个理由:
//   1. e2e 能在单个 jsdom realm 里复用它,与隔离端 requestBodyFill 走完整 CustomEvent 往返;
//   2. entrypoint 与测试共用同一份逻辑,避免「测试里复刻一份、和生产漂移」。
// 不依赖任何 WXT 全局(只收 target/win/doc/paste 参数),故可独立 import。
// 入站事件按不可信处理:只做正文写入,绝不收发任何机密。

type PasteFn = typeof pasteIntoQuill;
type WinWithQuill = Parameters<PasteFn>[2];

/**
 * 在 target 上监听 fill-body,用 paste(默认 pasteIntoQuill)写入正文,回 body-filled(含 degraded 旗标)。
 * 安装后立刻 dispatch bridge-ready 作就绪握手。返回卸载函数。
 * win 用宽松类型 `{ Quill?: unknown }`,以兼容直接传入 `window`(Window 不声明 Quill)。
 */
export function installBodyResponder(
  target: EventTarget,
  win: Window | { Quill?: unknown },
  doc: Document,
  paste: PasteFn = pasteIntoQuill,
): () => void {
  const onFill = (e: Event) => {
    const detail = (e as CustomEvent<FillBodyDetail>).detail;
    if (!detail || typeof detail.html !== 'string' || typeof detail.selector !== 'string') return;
    let result: BodyFilledDetail;
    try {
      const res = paste(detail.html, detail.selector, win as WinWithQuill, doc);
      result = { reqId: detail.reqId, ok: res.ok, error: res.error, degraded: res.degraded };
    } catch {
      result = { reqId: detail.reqId, ok: false, error: '正文写入异常,请手动粘贴。' };
    }
    target.dispatchEvent(new CustomEvent<BodyFilledDetail>(EVT_BODY_FILLED, { detail: result }));
  };

  target.addEventListener(EVT_FILL_BODY, onFill);
  // 就绪握手:隔离端可据此确认桥已加载。
  target.dispatchEvent(new CustomEvent(EVT_BRIDGE_READY));

  return () => target.removeEventListener(EVT_FILL_BODY, onFill);
}
