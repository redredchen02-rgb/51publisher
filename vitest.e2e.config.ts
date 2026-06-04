import { defineConfig } from 'vitest/config';

// e2e 配置:加载真实 Quill,跑核心填充路径。
// 与单测分离(主 vitest.config.ts 排除 tests/e2e),保持快循环单测轻快。
// 刻意不挂 WxtVitest:e2e 只 import lib/ 纯模块 + 真 Quill,不碰 entrypoint;
// 避免 #imports / MAIN entrypoint 扫描带来的额外不确定性(见 plan 的 Deferred)。
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'jsdom',
  },
});
