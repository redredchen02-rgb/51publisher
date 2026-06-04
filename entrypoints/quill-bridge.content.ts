import { installBodyResponder } from '../lib/body-responder';

// 主世界 content script(仅 Chromium):能访问页面 window.Quill。
// 监听逻辑抽到 lib/body-responder.ts(供 e2e 复用);此处只负责在 MAIN 世界安装它。
export default defineContentScript({
  matches: ['*://*.ympxbys.xyz/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    installBodyResponder(document, window, document);
  },
});
