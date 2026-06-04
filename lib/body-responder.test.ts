// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { installBodyResponder } from './body-responder';
import { requestBodyFill, EVT_FILL_BODY, EVT_BODY_FILLED, type BodyFilledDetail } from './body-bridge';
import type { PasteResult } from './quill-paste';

describe('installBodyResponder', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  function fakePaste(result: PasteResult) {
    return () => result;
  }

  it('paste 成功 → 回 EVT_BODY_FILLED {ok:true},degraded 不为 true', async () => {
    cleanup = installBodyResponder(document, window, document, fakePaste({ ok: true }));
    const out = await requestBodyFill('<p>x</p>', '#editor', 1000);
    expect(out.ok).toBe(true);
    expect(out.degraded).not.toBe(true);
  });

  it('paste 降级(tier②)→ degraded 旗标端到端保真', async () => {
    cleanup = installBodyResponder(document, window, document, fakePaste({ ok: true, degraded: true }));
    const out = await requestBodyFill('<p>x</p>', '#editor', 1000);
    expect(out.ok).toBe(true);
    expect(out.degraded).toBe(true);
  });

  it('paste 失败 → 回 {ok:false},note 提示手动粘贴', async () => {
    cleanup = installBodyResponder(document, window, document, fakePaste({ ok: false, error: 'Quill 不可用' }));
    const out = await requestBodyFill('<p>x</p>', '#editor', 1000);
    expect(out.ok).toBe(false);
    expect(out.note).toBe('Quill 不可用');
  });

  it('paste 抛异常 → 回 {ok:false},不让桥卡死', async () => {
    cleanup = installBodyResponder(document, window, document, () => {
      throw new Error('boom');
    });
    const out = await requestBodyFill('<p>x</p>', '#editor', 1000);
    expect(out.ok).toBe(false);
    expect(out.note).toMatch(/手动粘贴/);
  });

  it('安装时 dispatch EVT_BRIDGE_READY(就绪握手)', () => {
    let ready = false;
    const onReady = () => {
      ready = true;
    };
    document.addEventListener('pfa:quill-bridge-ready', onReady);
    cleanup = installBodyResponder(document, window, document, fakePaste({ ok: true }));
    expect(ready).toBe(true);
    document.removeEventListener('pfa:quill-bridge-ready', onReady);
  });
});
