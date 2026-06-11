import { installBodyResponder } from '../lib/body-responder';

// 主世界 content script(仅 Chromium):能访问页面 window.Quill。
// 监听逻辑抽到 lib/body-responder.ts(供 e2e 复用);此处只负责在 MAIN 世界安装它。
export default defineContentScript({
  // 注入面=闸门面:收窄到授权 admin 子域 + https。三处(此文件 / content.ts /
  // wxt.config.ts host_permissions)须同步;切正式环境时一并改。
  matches: ['https://dx-999-adm.ympxbys.xyz/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    installBodyResponder(document, window, document);
  },
});
