// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  requestBodyFill,
  bodyResultFromOutcome,
  EVT_FILL_BODY,
  EVT_BODY_FILLED,
  type FillBodyDetail,
  type BodyFilledDetail,
} from './body-bridge';

// 模拟主世界:收到 fill-body 后回 body-filled。
function mockMainWorld(ok: boolean, error?: string, degraded?: boolean) {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<FillBodyDetail>).detail;
    document.dispatchEvent(
      new CustomEvent<BodyFilledDetail>(EVT_BODY_FILLED, { detail: { reqId: detail.reqId, ok, error, degraded } }),
    );
  };
  document.addEventListener(EVT_FILL_BODY, handler);
  return () => document.removeEventListener(EVT_FILL_BODY, handler);
}

describe('requestBodyFill', () => {
  it('主世界回 ok → resolve {ok:true}', async () => {
    const cleanup = mockMainWorld(true);
    const out = await requestBodyFill('<p>hi</p>', '#editor', 1000);
    expect(out.ok).toBe(true);
    cleanup();
  });

  it('主世界回错误 → degraded 带 note', async () => {
    const cleanup = mockMainWorld(false, 'Quill 不可用');
    const out = await requestBodyFill('<p>hi</p>', '#editor', 1000);
    expect(out.ok).toBe(false);
    expect(out.note).toBe('Quill 不可用');
    cleanup();
  });

  it('主世界回 ok 但 degraded → outcome.degraded:true(透传旗标)', async () => {
    const cleanup = mockMainWorld(true, undefined, true);
    const out = await requestBodyFill('<p>hi</p>', '#editor', 1000);
    expect(out.ok).toBe(true);
    expect(out.degraded).toBe(true);
    cleanup();
  });

  it('主世界回 ok 非 degraded → outcome.degraded 不为 true', async () => {
    const cleanup = mockMainWorld(true);
    const out = await requestBodyFill('<p>hi</p>', '#editor', 1000);
    expect(out.ok).toBe(true);
    expect(out.degraded).not.toBe(true);
    cleanup();
  });

  it('无主世界响应 → 超时降级,不卡住', async () => {
    const out = await requestBodyFill('<p>hi</p>', '#editor', 30);
    expect(out.ok).toBe(false);
    expect(out.note).toMatch(/手动粘贴/);
  });

  it('reqId 不匹配的回应被忽略(等到超时)', async () => {
    const handler = () => {
      document.dispatchEvent(
        new CustomEvent<BodyFilledDetail>(EVT_BODY_FILLED, { detail: { reqId: 'wrong', ok: true } }),
      );
    };
    document.addEventListener(EVT_FILL_BODY, handler);
    const out = await requestBodyFill('<p>hi</p>', '#editor', 40);
    expect(out.ok).toBe(false); // 错误 reqId 不应误判成功
    document.removeEventListener(EVT_FILL_BODY, handler);
  });
});

describe('bodyResultFromOutcome(三态映射)', () => {
  it('ok 且非 degraded → filled,无 note', () => {
    expect(bodyResultFromOutcome({ ok: true })).toEqual({ field: 'body', status: 'filled' });
  });

  it('ok 且 degraded → degraded,提示质量较差', () => {
    const r = bodyResultFromOutcome({ ok: true, degraded: true });
    expect(r.status).toBe('degraded');
    expect(r.note).toMatch(/质量较差/);
  });

  it('ok 且 degraded 带自定义 note → 用透传的 note', () => {
    const r = bodyResultFromOutcome({ ok: true, degraded: true, note: '自定义降级说明' });
    expect(r.status).toBe('degraded');
    expect(r.note).toBe('自定义降级说明');
  });

  it('写入失败(!ok)→ degraded,提示手动粘贴', () => {
    const r = bodyResultFromOutcome({ ok: false, note: '正文桥未响应,请手动粘贴正文。' });
    expect(r.status).toBe('degraded');
    expect(r.note).toMatch(/手动粘贴/);
  });
});
