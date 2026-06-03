// Background service worker:调度中心。
// U1:仅开启"点扩展图标打开 side panel";LLM 路由在 U3 加。
export default defineBackground(() => {
  // 点工具栏图标即打开 side panel(Chromium)。
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[bg] setPanelBehavior 失败', err));
});
