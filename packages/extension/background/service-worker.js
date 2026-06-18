importScripts('../lib/db.js', '../lib/llm.js');

let crawling = false;

const REQUEST_DELAY = 1500;
const MAX_RETRIES = 3;
const RETRY_BACKOFF = 2.0;
const CONCURRENCY = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getErrorMessage(e) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
  return String(e || 'Unknown error');
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'Referer': 'https://51acgs.com/' } });
      if (resp.ok) return await resp.text();
      if ([429, 403, 503].includes(resp.status)) {
        await sleep(Math.pow(RETRY_BACKOFF, attempt + 1) * 1000);
        continue;
      }
      return null;
    } catch {
      await sleep(Math.pow(RETRY_BACKOFF, attempt + 1) * 1000);
    }
  }
  return null;
}

function parseHTML(html) {
  if (!html) return null;
  try {
    return new DOMParser().parseFromString(html, 'text/html');
  } catch (e) {
    console.error('parseHTML error:', e);
    return null;
  }
}

function parseHome(doc) {
  if (!doc) return [];
  const results = [], seen = new Set();
  doc.querySelectorAll('figure').forEach(fig => {
    const link = fig.querySelector('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    const m = href.match(/\/(\d+)/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    const title = (fig.querySelector('figcaption') || {}).textContent?.trim() || '';
    const img = fig.querySelector('img[data-src]');
    const cover = img ? img.getAttribute('data-src') : '';
    results.push({
      source_id: m[1], title,
      cover_url: cover.startsWith('http') ? cover : 'https://51acgs.com' + cover,
      detail_url: href.startsWith('http') ? href : 'https://51acgs.com' + href,
      categories: '',
      tags: '',
    });
  });
  return results;
}

function parseDetail(doc) {
  if (!doc) return { author: null, status: null, tags: null, categories: null, publish_date: null, update_date: null, bookmark_count: null, view_count: null, chapter_count: null };
  const r = { author: null, status: null, tags: null, categories: null, publish_date: null, update_date: null, bookmark_count: null, view_count: null, chapter_count: null };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const d = JSON.parse(s.textContent);
      if (d['@type'] === 'Book') {
        r.author = d.author ? (typeof d.author === 'object' ? d.author.name : d.author) : null;
        if (d.datePublished) r.publish_date = d.datePublished.slice(0, 10);
        if (d.genre) r.categories = (Array.isArray(d.genre) ? d.genre : [d.genre]).join(',');
        if (d.keywords) r.tags = (Array.isArray(d.keywords) ? d.keywords : [d.keywords]).join(',');
        for (const st of (d.interactionStatistic || [])) {
          const t = typeof st.interactionType === 'object' ? st.interactionType['@type'] : '';
          if (t.includes('Bookmark')) r.bookmark_count = st.userInteractionCount;
        }
      }
      if (d['@type'] === 'ItemList' && d.name && d.name.includes('章节目录')) {
        r.chapter_count = d.numberOfItems || d.itemListElement?.length || 0;
      }
    } catch {}
  });
  if (!r.author) {
    const authorEl = doc.querySelector('.comic-author-link span, .comic-author-link');
    if (authorEl) r.author = authorEl.textContent.trim();
  }
  if (!r.author) {
    const row = doc.querySelector('.comic-author-row');
    if (row) { const m = row.textContent.match(/作者[：:](.+?)(?:订阅|$)/); if (m) r.author = m[1].trim().replace(/[「」"']/g, ''); }
  }
  const st = doc.querySelector('.comic-item-tag');
  if (st) r.status = st.textContent.trim();
  if (!r.chapter_count) {
    const chSet = new Set();
    doc.querySelectorAll('a[href*="/chapter/"]').forEach(a => chSet.add(a.getAttribute('href')));
    if (chSet.size) r.chapter_count = chSet.size;
  }
  return r;
}

function parseChapters(doc, comicId) {
  if (!doc) return [];
  const results = [], seen = new Set();
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const d = JSON.parse(s.textContent);
      if (d['@type'] === 'ItemList' && d.name && d.name.includes('章节目录')) {
        for (const item of (d.itemListElement || [])) {
          const m = item.url?.match(/\/chapter\/(\d+)/);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          results.push({
            comic_source_id: comicId,
            chapter_id: m[1],
            chapter_name: item.name || `Ch ${m[1]}`,
            chapter_url: item.url.startsWith('http') ? item.url : 'https://51acgs.com' + item.url,
          });
        }
      }
    } catch {}
  });
  if (results.length === 0) {
    doc.querySelectorAll('a[href*="/chapter/"]').forEach(a => {
      const href = a.getAttribute('href');
      const m = href.match(/\/chapter\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      results.push({
        comic_source_id: comicId,
        chapter_id: m[1],
        chapter_name: a.textContent.trim() || `Ch ${m[1]}`,
        chapter_url: href.startsWith('http') ? href : 'https://51acgs.com' + href,
      });
    });
  }
  return results;
}

function parseImages(doc) {
  if (!doc) return [];
  const urls = [];
  const c = doc.querySelector('.reader-container, .comics-wrapper, .comics') || doc;
  c.querySelectorAll('img[data-src]').forEach(img => {
    const src = img.getAttribute('data-src');
    if (src && src.includes('pic.') && !src.includes('loading.png')) urls.push(src);
  });
  return urls;
}

function parseTopics(doc) {
  if (!doc) return [];
  const results = [];
  doc.querySelectorAll('figure').forEach(fig => {
    const link = fig.querySelector('a[href*="/topic/"]');
    if (!link) return;
    const href = link.getAttribute('href');
    const m = href.match(/\/(\w+)\/(\d+)$/);
    if (!m) return;
    const title = (fig.querySelector('figcaption') || {}).textContent?.trim() || '';
    const img = fig.querySelector('img[data-src]');
    const cover = img ? img.getAttribute('data-src') : '';
    const desc = (fig.querySelector('p') || {}).textContent?.trim() || '';
    const tags = [...fig.querySelectorAll('a.xs-w-tag')].map(t => t.textContent.trim()).filter(Boolean);
    let t = 'unknown';
    if (href.includes('/anime_hub/')) t = 'anime_hub';
    else if (href.includes('/anime_blog/')) t = 'anime_blog';
    else if (href.includes('/novel_hub/')) t = 'novel_hub';
    else if (href.includes('/hub/')) t = 'hub';
    else if (href.includes('/blog/')) t = 'blog';
    results.push({ source_id: `${m[1]}_${m[2]}`, title, cover_url: cover.startsWith('http') ? cover : 'https://51acgs.com' + cover, detail_url: href.startsWith('http') ? href : 'https://51acgs.com' + href, summary: desc, article_type: t, tags: tags.join(',') });
  });
  return results;
}

function notify(msg) { 
  try {
    chrome.runtime.sendMessage(msg).catch(() => {}); 
  } catch {}
}

function logError(context, error) {
  DB.append('errors', [{ source_id: `${context}_${Date.now()}`, context, error: String(error), timestamp: new Date().toISOString() }]);
}

async function crawlHome() {
  const t0 = Date.now();
  try {
    notify({ type: 'progress', stage: '首页', current: 0, total: 1 });
    const html = await fetchPage('https://51acgs.com/');
    if (!html) { 
      logError('crawlHome', 'fetch failed');
      notify({ type: 'error', msg: '首页爬取失败: 无法获取页面' });
      return 0; 
    }
    const doc = parseHTML(html);
    if (!doc) {
      logError('crawlHome', 'parseHTML failed');
      notify({ type: 'error', msg: '首页解析失败' });
      return 0;
    }
    const items = parseHome(doc);
    await DB.append('comics', items);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    notify({ type: 'progress', stage: '首页', current: 1, total: 1, elapsed, msg: `${items.length} 条漫画` });
    return items.length;
  } catch (e) {
    logError('crawlHome', getErrorMessage(e));
    notify({ type: 'error', msg: `首页爬取异常: ${getErrorMessage(e)}` });
    return 0;
  }
}

async function crawlTopics() {
  const t0 = Date.now();
  let total = 0;
  const types = ['hub', 'blog', 'anime_hub', 'anime_blog', 'novel_hub'];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    notify({ type: 'progress', stage: '专题', current: i, total: types.length });
    await sleep(REQUEST_DELAY);
    const html = await fetchPage(`https://51acgs.com/topic/${type}`);
    if (!html) { logError('crawlTopics', `fetch ${type} failed`); continue; }
    const doc = parseHTML(html);
    if (!doc) { logError('crawlTopics', `parseHTML ${type} failed`); continue; }
    const items = parseTopics(doc);
    await DB.append('articles', items);
    total += items.length;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  notify({ type: 'progress', stage: '专题', current: types.length, total: types.length, elapsed, msg: `${total} 条文章` });
  return total;
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function crawlDetails(limit = 100) {
  const t0 = Date.now();
  const comics = await DB.getAll('comics');
  const need = comics.filter(c => !c.author && c.detail_url).slice(0, limit);
  let count = 0;
  for (const batch of chunk(need, CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        await sleep(REQUEST_DELAY);
        const html = await fetchPage(c.detail_url);
        if (!html) { logError('crawlDetail', c.source_id); return; }
        const doc = parseHTML(html);
        if (!doc) { logError('crawlDetail', `parseHTML ${c.source_id} failed`); return; }
        Object.assign(c, parseDetail(doc));
        await DB.upsert('comics', c, 'source_id');
        count++;
        if (count % 10 === 0) notify({ type: 'progress', stage: '详情', current: count, total: need.length });
      } catch (e) { logError('crawlDetail', `${c.source_id}: ${getErrorMessage(e)}`); }
    }));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  notify({ type: 'progress', stage: '详情', current: count, total: need.length, elapsed, msg: `${count} 条` });
  return count;
}

async function crawlChapters(limit = 100) {
  const t0 = Date.now();
  const comics = await DB.getAll('comics');
  const existing = await DB.getAll('chapters');
  const existIds = new Set(existing.map(c => c.comic_source_id));
  const need = comics.filter(c => c.detail_url).slice(0, limit);
  let count = 0;
  let skipped = 0;
  
  for (const batch of chunk(need, CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        await sleep(REQUEST_DELAY);
        const html = await fetchPage(c.detail_url);
        if (!html) { logError('crawlChapters', c.source_id); skipped++; return; }
        const doc = parseHTML(html);
        if (!doc) { logError('crawlChapters', `parseHTML ${c.source_id} failed`); skipped++; return; }
        const chs = parseChapters(doc, c.source_id);
        if (chs.length > 0) {
          await DB.append('chapters', chs);
          count++;
        } else {
          skipped++;
        }
      } catch (e) { 
        logError('crawlChapters', `${c.source_id}: ${getErrorMessage(e)}`); 
        skipped++;
      }
    }));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  notify({ type: 'done', msg: `章节: ${count} 条 (跳过 ${skipped})` });
  return count;
}

async function crawlPages(limit = 100) {
  const chapters = await DB.getAll('chapters');
  const existing = await DB.getAll('pages');
  const existIds = new Set(existing.map(p => p.chapter_id));
  const need = chapters.filter(c => !existIds.has(c.chapter_id)).slice(0, limit);
  let count = 0;
  for (const batch of chunk(need, CONCURRENCY)) {
    await Promise.all(batch.map(async (ch) => {
      try {
        await sleep(REQUEST_DELAY);
        const html = await fetchPage(ch.chapter_url);
        if (!html) { logError('crawlPages', ch.chapter_id); return; }
        const doc = parseHTML(html);
        if (!doc) { logError('crawlPages', `parseHTML ${ch.chapter_id} failed`); return; }
        const urls = parseImages(doc);
        const pages = urls.map((url, i) => ({ chapter_id: ch.chapter_id, page_number: i + 1, image_url: url }));
        await DB.append('pages', pages);
        count++;
      } catch (e) { logError('crawlPages', `${ch.chapter_id}: ${getErrorMessage(e)}`); }
    }));
  }
  notify({ type: 'done', msg: `图片 URL: ${count} 章节` });
  return count;
}

async function fullCrawl() {
  if (crawling) return;
  crawling = true;
  notify({ type: 'status', msg: '爬取中...' });
  try {
    await crawlHome();
    await crawlTopics();
    await crawlDetails(300);
    await crawlChapters(300);
    await crawlPages(300);
    const stats = await DB.getStats();
    notify({ type: 'done', msg: `完成! 漫画${stats.comics} 文章${stats.articles} 章节${stats.chapters} 图片${stats.pages}` });
  } catch (e) { notify({ type: 'error', msg: getErrorMessage(e) }); }
  crawling = false;
}

async function generateArticleForComic(comic) {
  try {
    const result = await LLM.generateArticle(comic);
    await DB.upsert('comics', { ...comic, ai_title: result.title, ai_summary: result.summary, ai_body: result.body }, 'source_id');
    return { success: true, result };
  } catch (e) {
    return { success: false, error: getErrorMessage(e) };
  }
}

async function batchGenerate(limit = 10) {
  const comics = await DB.getAll('comics');
  const need = comics.filter(c => c.source_id && !c.ai_title).slice(0, limit);
  let count = 0;
  for (const batch of chunk(need, CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        const r = await generateArticleForComic(c);
        if (r.success) count++;
        notify({ type: 'generate_progress', current: count, total: need.length, title: c.title?.slice(0, 30) });
      } catch (e) { logError('batchGenerate', `${c.source_id}: ${getErrorMessage(e)}`); }
    }));
  }
  notify({ type: 'done', msg: `AI 生成完成: ${count}/${need.length}` });
  return count;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fullCrawl') { fullCrawl().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'crawlHome') { crawlHome().then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'crawlTopics') { crawlTopics().then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'crawlDetails') { crawlDetails(msg.limit || 100).then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'crawlChapters') { crawlChapters(msg.limit || 100).then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'crawlPages') { crawlPages(msg.limit || 100).then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'getStats') { DB.getStats().then(s => sendResponse(s)).catch(e => sendResponse({ error: getErrorMessage(e) })); return true; }
  if (msg.action === 'getData') { DB.getAll(msg.store).then(d => sendResponse(d)).catch(e => sendResponse({ error: getErrorMessage(e) })); return true; }
  if (msg.action === 'generateArticle') { generateArticleForComic(msg.comic).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'batchGenerate') { batchGenerate(msg.limit || 10).then(c => sendResponse({ ok: true, count: c })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
  if (msg.action === 'testLLM') { LLM.testConnection().then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: getErrorMessage(e) })); return true; }
});
