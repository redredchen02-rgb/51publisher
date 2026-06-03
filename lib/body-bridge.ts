// 隔离世界 ↔ 主世界 正文桥(协议层)。
// 隔离世界拿不到页面 window.Quill,故正文写入必须在主世界执行;
// 两侧用 document 上的 CustomEvent 通信,并带 reqId + 超时降级。

export const EVT_FILL_BODY = 'pfa:fill-body';
export const EVT_BODY_FILLED = 'pfa:body-filled';
export const EVT_BRIDGE_READY = 'pfa:quill-bridge-ready';

export interface FillBodyDetail {
  reqId: string;
  html: string;
  selector: string;
}
export interface BodyFilledDetail {
  reqId: string;
  ok: boolean;
  error?: string;
}
export interface BodyFillOutcome {
  ok: boolean;
  note?: string;
}

let counter = 0;
function nextReqId(): string {
  counter += 1;
  return `pfa_${counter}`;
}

/**
 * 隔离端:请求主世界写入正文。dispatch fill-body 后等 body-filled;
 * 超时(默认 3s)未收到即降级为"正文需手动粘贴",绝不卡住调用方。
 */
export function requestBodyFill(
  html: string,
  selector: string,
  timeoutMs = 3000,
  target: EventTarget = document,
): Promise<BodyFillOutcome> {
  return new Promise((resolve) => {
    const reqId = nextReqId();
    let done = false;

    const onFilled = (e: Event) => {
      const detail = (e as CustomEvent<BodyFilledDetail>).detail;
      if (!detail || detail.reqId !== reqId) return;
      finish(detail.ok ? { ok: true } : { ok: false, note: detail.error ?? '正文写入失败,请手动粘贴。' });
    };

    function finish(outcome: BodyFillOutcome) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      target.removeEventListener(EVT_BODY_FILLED, onFilled);
      resolve(outcome);
    }

    const timer = setTimeout(
      () => finish({ ok: false, note: '正文桥未响应(编辑器不可用),请手动粘贴正文。' }),
      timeoutMs,
    );

    target.addEventListener(EVT_BODY_FILLED, onFilled);
    target.dispatchEvent(new CustomEvent<FillBodyDetail>(EVT_FILL_BODY, { detail: { reqId, html, selector } }));
  });
}
