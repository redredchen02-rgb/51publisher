// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import DOMPurify from 'dompurify';
import { sanitizeBody, PINNED_DOMPURIFY_VERSION } from './sanitize';

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

  describe('v1 基线硬化(远程资源外泄 / 危险 URI / 版本钉定)', () => {
    it('剥协议相对远程 src(自动加载外泄)', () => {
      const out = sanitizeBody('<img src="//attacker/?leak">');
      expect(out).not.toMatch(/attacker/);
    });

    it('剥绝对远程 https src(自动加载外泄)', () => {
      const out = sanitizeBody('<img src="https://attacker.example/track.gif?c=1">');
      expect(out).not.toMatch(/attacker/);
    });

    it('保留真·相对/根相对 src(站内资源不误伤)', () => {
      const out = sanitizeBody('<img src="/uploads/cover.jpg" alt="x">');
      expect(out).toContain('/uploads/cover.jpg');
    });

    it('拒 data:text/html 与 data:image/svg+xml(mXSS 向量)', () => {
      expect(sanitizeBody('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toMatch(/data:/i);
      expect(sanitizeBody('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).not.toMatch(/data:/i);
    });

    it('保留远程 https href(漢化/無修 链接是站点核心,点击才触发)', () => {
      const out = sanitizeBody('<a href="https://example.com/work">x</a>');
      expect(out).toContain('https://example.com/work');
    });

    it('<a target=_blank> 自动补 rel=noopener', () => {
      const out = sanitizeBody('<a href="https://example.com" target="_blank">x</a>');
      expect(out).toMatch(/rel="[^"]*noopener/);
      expect(out).toMatch(/rel="[^"]*noreferrer/);
    });

    it('DOMPurify 版本钉定(版本/配置变更须触发本测试复核)', () => {
      expect(DOMPurify.version).toBe(PINNED_DOMPURIFY_VERSION);
    });
  });
});
