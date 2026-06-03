// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeBody } from './sanitize';

describe('sanitizeBody', () => {
  it('保留正常格式标签', () => {
    const out = sanitizeBody('<p>段落 <strong>粗</strong> <em>斜</em></p><ul><li>项</li></ul>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<li>');
  });

  it('剥除 <script>', () => {
    const out = sanitizeBody('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('ok');
  });

  it('剥除事件处理器属性 on*', () => {
    const out = sanitizeBody('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('剥除 javascript: 链接', () => {
    const out = sanitizeBody('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('保留 http(s) 链接', () => {
    const out = sanitizeBody('<a href="https://example.com">x</a>');
    expect(out).toContain('https://example.com');
  });

  it('剥除 <iframe>', () => {
    const out = sanitizeBody('<iframe src="https://evil.com"></iframe><p>ok</p>');
    expect(out).not.toMatch(/<iframe/i);
  });
});
