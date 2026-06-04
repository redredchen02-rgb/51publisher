import { defineConfig } from 'wxt';

// 仅支持 Chromium(主世界 content script + side panel)。
// 注入面=闸门面:host_permissions 收窄到授权 admin 子域 + https。
// 切正式环境 = 改这三处(此处 + content.ts + quill-bridge.content.ts 的 matches)。
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '51publisher 发帖填充助手',
    description: 'AI 生成草稿并填入后台发帖表单。授权站点可批量自动发布,非授权站点仅填充。',
    permissions: ['storage', 'sidePanel'],
    host_permissions: ['https://dx-999-adm.ympxbys.xyz/*'],
    action: { default_title: '51publisher 填充助手' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
