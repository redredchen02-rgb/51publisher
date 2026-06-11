import { defineConfig } from 'wxt';

const DEFAULT_HOSTS = ['https://dx-999-adm.ympxbys.xyz/*'];

function parseHosts(): string[] {
  const raw = process.env.ALLOWED_HOSTS ?? '';
  if (!raw.trim()) return DEFAULT_HOSTS;
  return raw.split(',').map((h) => h.trim()).filter(Boolean);
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '51publisher 发帖填充助手',
    description: 'AI 生成草稿并填入后台发帖表单。授权站点可批量自动发布,非授权站点仅填充。',
    permissions: ['storage', 'sidePanel'],
    host_permissions: parseHosts(),
    action: { default_title: '51publisher 填充助手' },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
