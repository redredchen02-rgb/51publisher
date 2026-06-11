import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { markItemRead, isItemRead, getReadItems, clearReadItems } from './read-tracker';

describe('read-tracker', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('markItemRead 后 isItemRead 返回 true', async () => {
    await markItemRead('item-1');
    expect(await isItemRead('item-1')).toBe(true);
  });

  it('未标记的条目 isItemRead 返回 false', async () => {
    expect(await isItemRead('item-2')).toBe(false);
  });

  it('markItemRead 调用两次不产生重复(Set 语义)', async () => {
    await markItemRead('item-1');
    await markItemRead('item-1');
    const items = await getReadItems();
    expect([...items]).toEqual(['item-1']);
  });

  it('clearReadItems 后 isItemRead 返回 false', async () => {
    await markItemRead('item-1');
    await clearReadItems();
    expect(await isItemRead('item-1')).toBe(false);
  });

  it('getReadItems 返回包含所有已标记条目的 Set', async () => {
    await markItemRead('item-1');
    await markItemRead('item-2');
    await markItemRead('item-3');
    const items = await getReadItems();
    expect(items).toBeInstanceOf(Set);
    expect(items.has('item-1')).toBe(true);
    expect(items.has('item-2')).toBe(true);
    expect(items.has('item-3')).toBe(true);
    expect(items.size).toBe(3);
  });
});
