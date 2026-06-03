// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { validateMapping } from './Settings';

describe('validateMapping', () => {
  it('合法映射通过', () => {
    const text = JSON.stringify({ title: { selector: 'input[name="title"]', fieldType: 'text' } });
    expect(validateMapping(text)).toBeNull();
  });

  it('非法 JSON → 报错', () => {
    expect(validateMapping('{ not json')).toMatch(/JSON 格式错误/);
  });

  it('顶层是数组 → 报错', () => {
    expect(validateMapping('[]')).toMatch(/必须是一个对象/);
  });

  it('缺 selector → 报错', () => {
    expect(validateMapping(JSON.stringify({ title: { fieldType: 'text' } }))).toMatch(/缺少有效的 selector/);
  });

  it('非法 fieldType → 报错', () => {
    expect(validateMapping(JSON.stringify({ title: { selector: '#x', fieldType: 'bogus' } }))).toMatch(/fieldType 非法/);
  });
});
