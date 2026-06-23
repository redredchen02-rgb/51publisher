const DataStore = {
  _comics: {},
  _articles: {},
  _chapters: {},
  _errors: {},
  
  setComics(data) {
    this._comics = Object.fromEntries(data.map(c => [c.source_id, c]));
  },
  getComic(id) { return this._comics[id]; },
  
  setArticles(data) {
    this._articles = Object.fromEntries(data.map(a => [a.source_id, a]));
  },
  getArticle(id) { return this._articles[id]; },
  
  setChapters(data) {
    this._chapters = Object.fromEntries(data.map(ch => [ch.chapter_id, ch]));
  },
  getChapter(id) { return this._chapters[id]; },
  
  setErrors(data) {
    this._errors = Object.fromEntries(data.map(e => [e.source_id, e]));
  },
  getError(id) { return this._errors[id]; },
};

let currentTab = 'comics';
let activeFilter = null;
let allComicsData = [];

function sendMsg(msg) { return new Promise(r => chrome.runtime.sendMessage(msg, r)); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function setStatus(msg, cls = '') { const el = document.getElementById('status'); if (el) { el.textContent = msg; el.className = 'status ' + cls; } }
async function refreshStats() { const s = await sendMsg({ action: 'getStats' }); const el = document.getElementById('stats'); if (s && el) el.textContent = `漫画 ${s.comics} | 文章 ${s.articles} | 章节 ${s.chapters} | 图片 ${s.pages}`; }
async function copyToClipboard(text, btn) { await navigator.clipboard.writeText(text); if (btn) { const o = btn.textContent; btn.textContent = '已复制'; btn.classList.add('copied'); setTimeout(() => { btn.textContent = o; btn.classList.remove('copied'); }, 1500); } }

function getTagsFromData(data) {
  const tc = {};
  data.forEach(item => { (item.tags || '').split(',').forEach(t => { t = t.trim(); if (t) tc[t] = (tc[t] || 0) + 1; }); });
  return Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 30);
}

function renderFilterTags(data) {
  const bar = document.getElementById('filter-bar');
  const tagsEl = document.getElementById('filter-tags-inner');
  if (!bar || !tagsEl) return;
  if (currentTab !== 'comics' || !data || !data.length) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const tags = getTagsFromData(data);
  tagsEl.innerHTML = tags.map(([tag, count]) => {
    const safeTag = tag.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<span class="filter-tag${activeFilter === tag ? ' active' : ''}" data-filter="${safeTag}">${esc(tag)} ${count}</span>`;
  }).join('') + `<span class="filter-tag clear" data-filter="">清除</span>`;
  tagsEl.querySelectorAll('.filter-tag').forEach(el => {
    el.onclick = () => {
      const tag = el.dataset.filter || null;
      activeFilter = tag;
      const inp = document.getElementById('filter-input');
      if (inp) inp.value = activeFilter || '';
      tagsEl.querySelectorAll('.filter-tag').forEach(e => e.classList.remove('active'));
      if (tag) el.classList.add('active');
      renderComics(filterComics(allComicsData));
    };
  });
}

function filterComics(data) {
  if (!activeFilter) return data;
  return data.filter(c => (c.tags || '').split(',').some(t => t.trim() === activeFilter));
}

function filterComicsAdvanced(data, q, onlyAI) {
  if (!q && !onlyAI) return data;
  return data.filter(c => {
    if (onlyAI && !c.ai_title) return false;
    if (!q) return true;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const text = `${c.title||''} ${c.author||''} ${c.tags||''} ${c.categories||''}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });
}

function fmt(c) {
  return JSON.stringify({
    title: c.title, author: c.author||'', status: c.status||'',
    tags: c.tags||'', categories: c.categories||'', publish_date: c.publish_date||'',
    bookmark_count: c.bookmark_count||0, view_count: c.view_count||0,
    cover_url: c.cover_url||'', detail_url: c.detail_url||''
  }, null, 2);
}

function fmtFields(c) {
  return [`标题: ${c.title||''}`, `作者: ${c.author||''}`, `状态: ${c.status||''}`,
    `标签: ${c.tags||''}`, `分类: ${c.categories||''}`, `发布: ${c.publish_date||''}`,
    `收藏: ${c.bookmark_count||0}`, `观看: ${c.view_count||0}`,
    `封面: ${c.cover_url||''}`, `链接: ${c.detail_url||''}`].join('\n');
}

// Shared empty-state guard for the four render* functions: resolves #content,
// renders the empty placeholder when there is no data, and returns null in
// both the missing-element and empty cases so callers just `if (!el) return`.
function contentEl(data, emptyMsg = '暂无数据') {
  const el = document.getElementById('content');
  if (!el) return null;
  if (!data.length) { el.innerHTML = `<div class="empty">${emptyMsg}</div>`; return null; }
  return el;
}

// Plain-text builders for the "复制全部" button, one per tab.
function comicsToText(data) {
  return data.map((c, i) => {
    let s = `【${i + 1}】${c.title || ''}\n`;
    if (c.author) s += `作者: ${c.author}\n`;
    if (c.status) s += `状态: ${c.status}\n`;
    if (c.tags) s += `标签: ${c.tags}\n`;
    if (c.categories) s += `分类: ${c.categories}\n`;
    if (c.ai_title) s += `AI标题: ${c.ai_title}\n`;
    if (c.ai_summary) s += `AI摘要: ${c.ai_summary}\n`;
    if (c.ai_body) s += `AI正文:\n${c.ai_body}\n`;
    return s;
  }).join('\n---\n\n');
}

function articlesToText(data) {
  return data.map((a, i) => `【${i + 1}】${a.title || ''}\n类型: ${a.article_type || ''}\n标签: ${a.tags || ''}\n摘要: ${a.summary || ''}`).join('\n---\n\n');
}

function chaptersToText(data) {
  return data.map((ch, i) => `【${i + 1}】${ch.chapter_name || ''} (${ch.page_count || '?'}页)\n${ch.chapter_url || ''}`).join('\n');
}

function buildCopyAllText(tab, data) {
  if (tab === 'comics') return comicsToText(data);
  if (tab === 'articles') return articlesToText(data);
  return chaptersToText(data);
}

function renderComics(data) {
  const el = contentEl(data);
  if (!el) return;
  DataStore.setComics(data);
  el.innerHTML = data.map(c => {
    const ai = c.ai_title, id = c.source_id;
    return `<div class="card${ai?' card-ai':''}">
      <div class="card-header"><div class="card-title">${esc(c.title)}</div>
        <div class="btn-group"><button class="btn-copy" data-copy-fields="${id}">复制文本</button><button class="btn-copy" data-copy-json="${id}">复制JSON</button></div>
      </div>
      <div class="card-meta">${c.author?'作者: '+esc(c.author):''} ${c.status?'| 状态: '+esc(c.status):''} ${c.publish_date?'| '+esc(c.publish_date):''}</div>
      <div class="card-meta">${c.tags?'标签: '+esc(c.tags):''} ${c.categories?'| 分类: '+esc(c.categories):''}</div>
      ${c.bookmark_count?`<div class="card-meta">收藏: ${c.bookmark_count} | 观看: ${c.view_count||0}</div>`:''}
      ${ai?`<div class="ai-section"><div class="ai-label">AI 生成</div>
        <div class="ai-field"><div class="ai-field-header"><span>标题</span><button class="btn-copy" data-copy-ai="title_${id}">复制</button></div><div class="ai-field-value">${esc(c.ai_title)}</div></div>
        <div class="ai-field"><div class="ai-field-header"><span>摘要</span><button class="btn-copy" data-copy-ai="summary_${id}">复制</button></div><div class="ai-field-value">${esc(c.ai_summary||'')}</div></div>
        <div class="ai-field"><div class="ai-field-header"><span>正文</span><button class="btn-copy" data-copy-ai="body_${id}">复制</button></div><div class="ai-field-value ai-body">${esc(c.ai_body||'')}</div></div>
      </div>`:`<div style="margin-top:8px"><button class="btn-generate" data-gen="${id}">生成文章</button></div>`}
    </div>`;
  }).join('');
  initDelegation();
}

function renderArticles(data) {
  const el = contentEl(data);
  if (!el) return;
  DataStore.setArticles(data);
  el.innerHTML = data.map(a => `<div class="card">
    <div class="card-header"><div class="card-title">${esc(a.title)}</div>
      <div class="btn-group"><button class="btn-copy" data-copy-afields="${a.source_id}">复制文本</button><button class="btn-copy" data-copy-ajson="${a.source_id}">复制JSON</button></div>
    </div>
    <div class="card-meta">类型: ${esc(a.article_type)} | 标签: ${esc(a.tags||'-')}</div>
    ${a.summary?`<div class="card-meta">${esc(a.summary)}</div>`:''}
  </div>`).join('');
  initDelegation();
}

function renderChapters(data) {
  const el = contentEl(data);
  if (!el) return;
  DataStore.setChapters(data);
  el.innerHTML = data.map(ch => `<div class="card">
    <div class="card-header"><div class="card-title">${esc(ch.chapter_name)} (${ch.page_count||'?'}页)</div>
      <button class="btn-copy" data-copy-chjson="${ch.chapter_id}">复制JSON</button>
    </div>
    <div class="card-url">${esc(ch.chapter_url||'')}</div>
  </div>`).join('');
  initDelegation();
}

function renderErrors(data) {
  const el = contentEl(data, '没有错误记录');
  if (!el) return;
  const sorted = [...data].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  el.innerHTML = sorted.map(e => `<div class="card card-error">
    <div class="card-header"><div class="card-title">${esc(e.context || '未知')}</div>
      <span class="error-time">${esc((e.timestamp || '').replace('T', ' ').slice(0, 19))}</span>
    </div>
    <div class="card-meta error-msg">${esc(e.error || '')}</div>
  </div>`).join('');
}

function loadData() {
  const clearBtn = document.getElementById('btn-clear-errors');
  if (clearBtn) clearBtn.style.display = currentTab === 'errors' ? '' : 'none';

  sendMsg({ action: 'getData', store: currentTab }).then(data => {
    if (currentTab === 'comics') { allComicsData = data || []; renderFilterTags(allComicsData); renderComics(filterComics(allComicsData)); }
    else if (currentTab === 'articles') renderArticles(data || []);
    else if (currentTab === 'chapters') renderChapters(data || []);
    else if (currentTab === 'errors') renderErrors(data || []);
  });
}

function initDelegation() {
  document.querySelectorAll('[data-copy-fields]').forEach(b => { b.onclick = () => { const c = DataStore.getComic(b.dataset.copyFields); if (c) copyToClipboard(fmtFields(c), b); }; });
  document.querySelectorAll('[data-copy-json]').forEach(b => { b.onclick = () => { const c = DataStore.getComic(b.dataset.copyJson); if (c) copyToClipboard(fmt(c), b); }; });
  document.querySelectorAll('[data-copy-ai]').forEach(b => { b.onclick = () => { const s = b.dataset.copyAi; const idx = s.lastIndexOf('_'); const field = s.slice(0, idx); const id = s.slice(idx + 1); const c = DataStore.getComic(id); if (c) copyToClipboard(c['ai_'+field]||'', b); }; });
  document.querySelectorAll('[data-copy-afields]').forEach(b => { b.onclick = () => { const a = DataStore.getArticle(b.dataset.copyAfields); if (a) copyToClipboard(`标题: ${a.title||''}\n摘要: ${a.summary||''}\n类型: ${a.article_type||''}\n标签: ${a.tags||''}`, b); }; });
  document.querySelectorAll('[data-copy-ajson]').forEach(b => { b.onclick = () => { const a = DataStore.getArticle(b.dataset.copyAjson); if (a) copyToClipboard(JSON.stringify({title:a.title,summary:a.summary,article_type:a.article_type,tags:a.tags},null,2), b); }; });
  document.querySelectorAll('[data-copy-chjson]').forEach(b => { b.onclick = () => { const ch = DataStore.getChapter(b.dataset.copyChjson); if (ch) copyToClipboard(JSON.stringify({chapter_name:ch.chapter_name,page_count:ch.page_count,chapter_url:ch.chapter_url},null,2), b); }; });
  document.querySelectorAll('[data-gen]').forEach(b => { b.onclick = () => { const c = DataStore.getComic(b.dataset.gen); if (c) { b.disabled=true; b.textContent='生成中...'; sendMsg({action:'generateArticle',comic:c}).then(r=>{ if(r.success){sendMsg({action:'getData',store:'comics'}).then(d=>{renderComics(d||[]); initDelegation();});} else{b.textContent='失败';setTimeout(()=>{b.disabled=false;b.textContent='生成文章';},2000);} }); } }; });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      activeFilter = null;
      const inp = document.getElementById('filter-input');
      if (inp) inp.value = '';
      loadData();
    });
  });

  const fi = document.getElementById('filter-input');
  if (fi) fi.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    const onlyAI = document.getElementById('filter-ai')?.checked;
    if (!q && !onlyAI) { activeFilter = null; renderFilterTags(allComicsData); renderComics(allComicsData); return; }
    renderComics(filterComicsAdvanced(allComicsData, q, onlyAI));
  });

  const bc = document.getElementById('btn-crawl');
  if (bc) bc.onclick = () => {
    const s = document.getElementById('status');
    const current = s ? s.textContent : '';
    if (current.includes('爬取中')) { setStatus('已有爬取任务在运行', ''); return; }
    if (!confirm('确认开始全量爬取？\n将爬取：首页 → 专题 → 详情 → 章节 → 图片URL\n预计耗时较长，中途关闭侧边栏不会中断。')) return;
    setStatus('全量爬取中...', 'running');
    sendMsg({ action: 'fullCrawl' });
  };
  const bs = document.getElementById('btn-settings'); if (bs) bs.onclick = () => window.open(chrome.runtime.getURL('settings/settings.html'),'_blank','width=500,height=400');
  const bai = document.getElementById('btn-batch-ai'); if (bai) bai.onclick = () => { setStatus('AI 批量生成中...','running'); sendMsg({action:'batchGenerate',limit:10}); };
  const be = document.getElementById('btn-export');
  if (be) be.onclick = async () => { const comics=await sendMsg({action:'getData',store:'comics'}); const articles=await sendMsg({action:'getData',store:'articles'}); const b=new Blob([JSON.stringify({comics,articles},null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=`51acgs_${Date.now()}.json`; a.click(); URL.revokeObjectURL(u); };
  const bce = document.getElementById('btn-clear-errors');
  if (bce) bce.onclick = async () => { await sendMsg({action:'clearErrors'}); setStatus('错误已清空','done'); loadData(); };
  const ba = document.getElementById('btn-copy-all');
  if (ba) ba.onclick = async () => {
    const data = await sendMsg({ action: 'getData', store: currentTab });
    if (!data || !data.length) { setStatus('没有数据'); return; }
    await copyToClipboard(buildCopyAllText(currentTab, data), ba);
    setStatus(`已复制 ${data.length} 条`, 'done');
  };

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => { setStatus(`${btn.textContent}...`,'running'); sendMsg({action:btn.dataset.action},(r)=>{ setStatus(r?.ok?`完成: ${r.count} 条`:'失败',r?.ok?'done':''); refreshStats(); loadData(); }); });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'progress') {
      const pct = msg.total > 0 ? Math.round(msg.current / msg.total * 100) : 0;
      const time = msg.elapsed ? ` (${msg.elapsed}s)` : '';
      setStatus(`${msg.stage}: ${pct}%${time}${msg.msg ? ' - ' + msg.msg : ''}`, 'running');
    }
    if (msg.type==='done') { setStatus(msg.msg,'done'); refreshStats(); loadData(); }
    if (msg.type==='error') setStatus(`错误: ${msg.msg}`);
    if (msg.type==='generate_progress') setStatus(`AI: ${msg.current}/${msg.total} - ${msg.title}`);
  });

  refreshStats();
  loadData();
  checkPendingCrawl();
});

const STAGE_LABELS = { home: '首页', topics: '专题', details_chapters: '详情+章节', pages: '图片URL' };

async function checkPendingCrawl() {
  const state = await sendMsg({ action: 'getCrawlState' });
  if (!state || !state.stage) return;
  if (state.updatedAt && (Date.now() - new Date(state.updatedAt).getTime()) > 3600000) {
    await sendMsg({ action: 'clearCrawlState' });
    return;
  }
  const bar = document.getElementById('resume-bar');
  const msg = document.getElementById('resume-msg');
  if (!bar || !msg) return;
  msg.textContent = `上次爬取在「${STAGE_LABELS[state.stage] || state.stage}」阶段中断`;
  bar.style.display = '';
  document.getElementById('btn-resume').onclick = () => {
    bar.style.display = 'none';
    setStatus('继续爬取中...', 'running');
    sendMsg({ action: 'fullCrawl', resumeFrom: state.stage });
  };
  document.getElementById('btn-dismiss').onclick = () => { bar.style.display = 'none'; };
}
