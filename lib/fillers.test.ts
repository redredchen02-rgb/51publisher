// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fillDraft, fillField, HIGHLIGHT_CLASS } from './fillers';
import { DEFAULT_SETTINGS } from './storage';
import type { ContentDraft } from './types';

const mapping = DEFAULT_SETTINGS.fieldMapping;

const draft: ContentDraft = {
  id: 'd1', title: '我的标题', subtitle: '副标题', category: '2',
  coverImageUrl: '', body: '<p>正文</p>', tags: ['奇幻', '冒險'],
  description: '摘要文本', postStatus: '1', publishedAt: '2026-06-03',
  mediaId: '12345', status: 'draft', createdAt: '2026-06-03T00:00:00.000Z',
};

// 仿 U0 勘查的真实表单结构(layui 弹层里的 <form>)。
function buildForm(): { form: HTMLFormElement; submitSpy: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = `
    <form>
      <input name="title" />
      <input name="subtitle" />
      <select name="type"><option value="">请选择</option><option value="2">漫畫文章</option><option value="4">動漫文章</option></select>
      <select name="status"><option value="0">隐藏</option><option value="1">显示</option></select>
      <textarea name="description"></textarea>
      <input name="published_at" />
      <input name="media_id" />
      <div class="tags-container">
        <input type="checkbox" name="tags[]" id="tag_901" value="901" /><label for="tag_901">奇幻</label>
        <input type="checkbox" name="tags[]" id="tag_902" value="902" /><label for="tag_902">冒險</label>
        <input type="checkbox" name="tags[]" id="tag_903" value="903" /><label for="tag_903">校園</label>
      </div>
      <div id="editor" class="ql-container"><div class="ql-editor" contenteditable="true"></div></div>
      <button type="submit">发布</button>
    </form>`;
  const form = document.querySelector('form')!;
  const submitSpy = vi.fn((e: Event) => e.preventDefault());
  form.addEventListener('submit', submitSpy);
  return { form, submitSpy };
}

describe('fillers', () => {
  beforeEach(() => buildForm());

  it('text:填标题并触发 input 事件', () => {
    const inputSpy = vi.fn();
    document.querySelector('input[name="title"]')!.addEventListener('input', inputSpy);
    const res = fillField('title', mapping.title!, draft, document);
    expect(res?.status).toBe('filled');
    expect((document.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('我的标题');
    expect(inputSpy).toHaveBeenCalled();
  });

  it('native-select:按 value 选中分类并触发 change', () => {
    const res = fillField('category', mapping.category!, draft, document);
    expect(res?.status).toBe('filled');
    expect((document.querySelector('select[name="type"]') as HTMLSelectElement).value).toBe('2');
  });

  it('checkbox-multi:按标签文本勾选,回车不参与', () => {
    const res = fillField('tags', mapping.tags!, draft, document);
    expect(res?.status).toBe('filled');
    expect((document.querySelector('#tag_901') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#tag_902') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('#tag_903') as HTMLInputElement).checked).toBe(false);
  });

  it('部分标签未匹配 → degraded', () => {
    const res = fillField('tags', mapping.tags!, { ...draft, tags: ['奇幻', '不存在的标签'] }, document);
    expect(res?.status).toBe('degraded');
    expect(res?.note).toMatch(/不存在的标签/);
  });

  it('选择器找不到元素 → skipped,不中断', () => {
    document.querySelector('input[name="title"]')!.remove();
    const res = fillField('title', mapping.title!, draft, document);
    expect(res?.status).toBe('skipped');
  });

  it('body(quill)由 fillField 返回 null(交主世界处理)', () => {
    expect(fillField('body', mapping.body!, draft, document)).toBeNull();
  });

  it('native-select 无匹配选项 → degraded', () => {
    const res = fillField('category', mapping.category!, { ...draft, category: '999' }, document);
    expect(res?.status).toBe('degraded');
  });

  it('已填字段加高亮 class', () => {
    fillField('title', mapping.title!, draft, document);
    expect(document.querySelector('input[name="title"]')!.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
  });

  // —— P0 硬约束:零提交 ——
  it('完整 fillDraft 后 form submit 事件计数为 0', () => {
    const { submitSpy } = buildForm();
    const results = fillDraft(draft, mapping, document);
    expect(results.length).toBeGreaterThan(0);
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it('零提交:填充不点击 submit 按钮、不调用 form.submit', () => {
    const { form } = buildForm();
    const btn = form.querySelector('button[type="submit"]')!;
    const clickSpy = vi.fn();
    btn.addEventListener('click', clickSpy);
    const submitFn = vi.spyOn(form, 'submit');
    fillDraft(draft, mapping, document);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(submitFn).not.toHaveBeenCalled();
  });

  it('fillDraft 跳过 body,返回其余字段结果', () => {
    const results = fillDraft(draft, mapping, document);
    const fields = results.map((r) => r.field);
    expect(fields).not.toContain('body');
    expect(fields).toContain('title');
    expect(fields).toContain('tags');
  });
});
