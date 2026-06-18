chrome.storage.local.get(['apiUrl', 'apiKey', 'model'], (r) => {
  if (r.apiUrl) document.getElementById('apiUrl').value = r.apiUrl;
  if (r.apiKey) document.getElementById('apiKey').value = r.apiKey;
  if (r.model) document.getElementById('model').value = r.model;
});

document.getElementById('btn-save').addEventListener('click', () => {
  chrome.storage.local.set({
    apiUrl: document.getElementById('apiUrl').value,
    apiKey: document.getElementById('apiKey').value,
    model: document.getElementById('model').value,
  }, () => {
    showStatus('已保存', 'ok');
  });
});

document.getElementById('btn-test').addEventListener('click', async () => {
  showStatus('测试中...', '');
  try {
    const apiUrl = document.getElementById('apiUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const model = document.getElementById('model').value || 'gpt-4o-mini';
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: '说 OK' }], max_tokens: 10 })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    showStatus('连接成功!', 'ok');
  } catch (e) {
    showStatus('失败: ' + e.message, 'err');
  }
});

function showStatus(msg, cls) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls || 'ok';
}
