import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { DEFAULT_SETTINGS, getSettings, saveSettings, getApiKey, saveApiKey } from './storage';

describe('storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('storage 为空时 getSettings 返回完整默认对象', async () => {
    const s = await getSettings();
    expect(s.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
    expect(s.fieldMapping.title?.selector).toBe('input[name="title"]');
    expect(s.fieldMapping.body?.fieldType).toBe('quill');
  });

  it('saveSettings 后 getSettings 取回同值', async () => {
    const next = { ...DEFAULT_SETTINGS, endpoint: 'https://api.example.com/v1/chat/completions', model: 'gpt-4o' };
    await saveSettings(next);
    const got = await getSettings();
    expect(got.endpoint).toBe('https://api.example.com/v1/chat/completions');
    expect(got.model).toBe('gpt-4o');
  });

  it('部分设置与默认 fieldMapping 合并(缺省项回落)', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, fieldMapping: { title: { selector: '#custom-title', fieldType: 'text' } } });
    const got = await getSettings();
    expect(got.fieldMapping.title?.selector).toBe('#custom-title');
    // 未覆盖的字段仍回落默认
    expect(got.fieldMapping.body?.selector).toBe('#editor');
  });

  it('getApiKey 未设置时返回空字符串而非崩溃', async () => {
    expect(await getApiKey()).toBe('');
  });

  it('saveApiKey 后能取回', async () => {
    await saveApiKey('sk-test-123');
    expect(await getApiKey()).toBe('sk-test-123');
  });
});
