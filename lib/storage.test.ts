import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { storage } from '#imports';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  getApiKey,
  saveApiKey,
  getSafetyMode,
  setSafetyMode,
  getAuthorizedHosts,
  setAuthorizedHosts,
  getBatch,
  saveBatch,
  clearBatch,
} from './storage';
import { createBatch, markDispatched, markFilled, markGenerating, presentForApproval } from './batch';
import type { Batch } from './batch';
import type { ContentDraft } from './types';

const D: ContentDraft = {
  id: 'd', title: 't', subtitle: '', category: '2', coverImageUrl: '', body: '<p>x</p>',
  tags: [], description: '', postStatus: '0', publishedAt: '', mediaId: '1', status: 'draft',
  createdAt: '2026-06-04T00:00:00.000Z',
};

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

  describe('安全档位 + 授权名单', () => {
    it('档位缺省 → off(fail-closed)', async () => {
      expect(await getSafetyMode()).toBe('off');
    });

    it('set/get 档位往返', async () => {
      await setSafetyMode('authorized');
      expect(await getSafetyMode()).toBe('authorized');
    });

    it('坏档位值回落 off', async () => {
      await storage.setItem('local:safetyMode', 'YOLO');
      expect(await getSafetyMode()).toBe('off');
    });

    it('名单从未设置 → 种子(含 admin 站)', async () => {
      expect(await getAuthorizedHosts()).toEqual(['dx-999-adm.ympxbys.xyz']);
    });

    it('set/get 名单往返 + 过滤空串', async () => {
      await setAuthorizedHosts(['dx-999-adm.ympxbys.xyz', '', '  ']);
      expect(await getAuthorizedHosts()).toEqual(['dx-999-adm.ympxbys.xyz']);
    });

    it('坏名单值(非数组)→ 空(fail-closed)', async () => {
      await storage.setItem('local:authorizedHosts', 'dx-999-adm.ympxbys.xyz');
      expect(await getAuthorizedHosts()).toEqual([]);
    });
  });

  describe('批量持久化 + 加载即恢复', () => {
    function fillAll(b: Batch): Batch {
      let x = b;
      for (const it of b.items) x = markFilled(markGenerating(x, it.id), it.id, D);
      return presentForApproval(x);
    }

    it('无批次 → null', async () => {
      expect(await getBatch()).toBeNull();
    });

    it('save/get 往返', async () => {
      const b = createBatch('b1', 7, 'dx-999-adm.ympxbys.xyz', ['x'], '2026-06-04T00:00:00.000Z', (i) => `i${i}`);
      await saveBatch(b);
      const got = await getBatch();
      expect(got?.id).toBe('b1');
      expect(got?.tabId).toBe(7);
    });

    it('加载即恢复:在途 dispatched → needs-human-verification(防自动重发)', async () => {
      let b = createBatch('b1', 7, 'dx-999-adm.ympxbys.xyz', ['a'], '2026-06-04T00:00:00.000Z', (i) => `i${i}`);
      b = markDispatched(fillAll(b), 'i0');
      await saveBatch(b);
      const got = await getBatch();
      expect(got?.items[0]!.status).toBe('needs-human-verification');
    });

    it('坏批次值(items 非数组)→ null', async () => {
      await storage.setItem('local:batch', { id: 'x' });
      expect(await getBatch()).toBeNull();
    });

    it('clearBatch 后 → null', async () => {
      const b = createBatch('b1', 7, 'h', ['x'], 't', (i) => `i${i}`);
      await saveBatch(b);
      await clearBatch();
      expect(await getBatch()).toBeNull();
    });
  });
});
