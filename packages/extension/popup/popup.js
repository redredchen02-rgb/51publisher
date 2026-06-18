document.getElementById('btn-panel').addEventListener('click', () => {
  chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
});

document.getElementById('btn-crawl').addEventListener('click', () => {
  if (!confirm('确认开始全量爬取？')) return;
  document.getElementById('status').textContent = '爬取中...';
  chrome.runtime.sendMessage({ action: 'fullCrawl' });
});

chrome.runtime.sendMessage({ action: 'getStats' }, (s) => {
  if (s) document.getElementById('stats').textContent = `漫画 ${s.comics} | 文章 ${s.articles} | 章节 ${s.chapters} | 图片 ${s.pages}`;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'done') {
    document.getElementById('status').textContent = msg.msg;
    chrome.runtime.sendMessage({ action: 'getStats' }, (s) => {
      if (s) document.getElementById('stats').textContent = `漫画 ${s.comics} | 文章 ${s.articles} | 章节 ${s.chapters} | 图片 ${s.pages}`;
    });
  }
});
