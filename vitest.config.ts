import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest 提供 WXT 的自动导入(storage/browser 等)与 fakeBrowser。
export default defineConfig({
  plugins: [WxtVitest()],
});
