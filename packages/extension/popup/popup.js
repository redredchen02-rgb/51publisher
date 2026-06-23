function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderStats(s) {
  if (s) setText('stats', `漫画 ${s.comics} | 文章 ${s.articles} | 章节 ${s.chapters} | 图片 ${s.pages}`);
}

function refreshStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, renderStats);
}

document.getElementById('btn-panel')?.addEventListener('click', () => {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});

document.getElementById('btn-crawl')?.addEventListener('click', () => {
  if (!confirm('确认开始全量爬取？')) return;
  setText('status', '爬取中...');
  chrome.runtime.sendMessage({ action: 'fullCrawl' });
});

refreshStats();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'done') {
    setText('status', msg.msg);
    refreshStats();
  }
});
