import { defineConfig } from 'wxt';

// 仅支持 Chromium(主世界 content script + side panel)。
// host_permissions 用通配子域:U0 勘查发现后台子域含 dx-999 模式,疑似可轮换。
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '51publisher 发帖填充助手',
    description: 'AI 生成草稿并填入后台发帖表单。只填充,绝不自动提交,发布由人工完成。',
    permissions: ['storage', 'sidePanel'],
    host_permissions: ['*://*.ympxbys.xyz/*'],
    action: { default_title: '51publisher 填充助手' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
