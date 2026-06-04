// @vitest-environment jsdom
// U1 基建自测:fixture 加载、真 Quill 挂载、零提交 spy 三件套可用。
import { describe, it, expect, afterEach } from 'vitest';
import { loadFixture } from './helpers/quill-fixture';
import { installSubmitSpy } from './helpers/zero-submit';

describe('U1 harness', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('loadFixture: 挂载真 Quill,#editor 内生成 .ql-editor', () => {
    const { document: doc, quill, window: win } = loadFixture();
    expect(quill).toBeTruthy();
    expect(doc.querySelector('#editor .ql-editor')).toBeTruthy();
    expect(typeof (win as unknown as { Quill?: { find?: unknown } }).Quill?.find).toBe('function');
  });

  it('loadFixture(withQuill=false): .ql-editor 仍在但 window.Quill 被移除', () => {
    const { document: doc, window: win } = loadFixture({ withQuill: false });
    expect(doc.querySelector('#editor .ql-editor')).toBeTruthy();
    expect((win as unknown as { Quill?: unknown }).Quill).toBeUndefined();
  });

  it('fixture: select[name=type] 仅 2/4,status 仅 0/1(与勘查一致)', () => {
    const { document: doc } = loadFixture();
    const typeOpts = Array.from(doc.querySelectorAll<HTMLOptionElement>('select[name="type"] option')).map((o) => o.value);
    const statusOpts = Array.from(doc.querySelectorAll<HTMLOptionElement>('select[name="status"] option')).map((o) => o.value);
    expect(typeOpts).toEqual(['2', '4']);
    expect(statusOpts).toEqual(['0', '1']);
  });

  it('installSubmitSpy: 未提交时计数为 0', () => {
    const { form, publishButton } = loadFixture();
    const spy = installSubmitSpy(form, publishButton);
    expect(spy.submitCount()).toBe(0);
    expect(spy.publishClickCount()).toBe(0);
    spy.restore();
  });

  it('installSubmitSpy: 真计数(requestSubmit + 发布按钮 click 都被捕获)', () => {
    const { form, publishButton } = loadFixture();
    const spy = installSubmitSpy(form, publishButton);
    form.requestSubmit();
    publishButton.dispatchEvent(new Event('click', { bubbles: true }));
    expect(spy.submitCount()).toBe(1); // requestSubmit 被 spy 拦截计数
    expect(spy.publishClickCount()).toBe(1);
    spy.restore();
  });
});
