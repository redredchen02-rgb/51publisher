// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { validateMapping, parseTagsText } from './Settings';

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
    expect(validateMapping(JSON.stringify({ title: { selector: '#x', fieldType: 'bogus' } }))).toMatch(
      /fieldType 非法/,
    );
  });
});

describe('parseTagsText', () => {
  it('换行分隔 → 标签数组', () => {
    expect(parseTagsText('漢化\n無修正')).toEqual(['漢化', '無修正']);
  });

  it('逗号分隔并自动 trim → 标签数组', () => {
    expect(parseTagsText('漢化, 無修正')).toEqual(['漢化', '無修正']);
  });

  it('空文本 → 空数组（不含空字符串）', () => {
    expect(parseTagsText('')).toEqual([]);
  });

  it('多空行 → 过滤空项', () => {
    expect(parseTagsText('漢化\n\n無修正\n')).toEqual(['漢化', '無修正']);
  });

  it('settings.recommendedTags join 后能完整还原', () => {
    const tags = ['漢化', '無修正', '校園'];
    expect(parseTagsText(tags.join('\n'))).toEqual(tags);
  });
});
