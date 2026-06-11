// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { checkSelectorDrift } from './selectors';
import { DEFAULT_FIELD_MAPPING } from '@51publisher/shared';

describe('checkSelectorDrift', () => {
  it('全部选择器在场 → ok,无缺失', () => {
    document.body.innerHTML = `
      <input name="title" /><input name="subtitle" />
      <select name="type"></select><div id="editor"></div>
      <input name="tags[]" type="checkbox" />
      <textarea name="description"></textarea>
      <select name="status"></select>
      <input name="published_at" /><input name="media_id" />
      <input name="cover_url" />`;
    const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('缺正文编辑器 + 标题 → 报缺失 label', () => {
    document.body.innerHTML = `
      <input name="subtitle" /><select name="type"></select>
      <input name="tags[]" type="checkbox" /><textarea name="description"></textarea>
      <select name="status"></select><input name="published_at" /><input name="media_id" />`;
    const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('標題');
    expect(r.missing).toContain('文章内容');
  });

  it('空 document → 全缺失', () => {
    document.body.innerHTML = '';
    const r = checkSelectorDrift(document, DEFAULT_FIELD_MAPPING);
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBeGreaterThanOrEqual(8);
  });
});
