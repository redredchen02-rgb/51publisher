importScripts('../lib/db.js', '../lib/llm.js', '../lib/http.js', '../lib/parsers.js');

let crawling = false;

function notify(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {}
}

async function crawlHome() {
  const t0 = Date.now();
  try {
    notify({ type: 'progress', stage: '首页', current: 0, total: 1 });
    const html = await Http.fetchPage('https://51acgs.com/');
    if (!html) {
      Http.logError('crawlHome', 'fetch failed');
      notify({ type: 'error', msg: '首页爬取失败: 无法获取页面' });
      return 0;
    }
    const doc = Parsers.parseHTML(html);
    if (!doc) {
      Http.logError('crawlHome', 'parseHTML failed');
      notify({ type: 'error', msg: '首页解析失败' });
      return 0;
    }
    const items = Parsers.parseHome(doc);
    await DB.append('comics', items);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    notify({ type: 'progress', stage: '首页', current: 1, total: 1, elapsed, msg: `${items.length} 条漫画` });
    return items.length;
  } catch (e) {
    Http.logError('crawlHome', Http.getErrorMessage(e));
    notify({ type: 'error', msg: `首页爬取异常: ${Http.getErrorMessage(e)}` });
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
    await Http.sleep(Http.REQUEST_DELAY);
    const html = await Http.fetchPage(`https://51acgs.com/topic/${type}`);
    if (!html) { Http.logError('crawlTopics', `fetch ${type} failed`); continue; }
    const doc = Parsers.parseHTML(html);
    if (!doc) { Http.logError('crawlTopics', `parseHTML ${type} failed`); continue; }
    const items = Parsers.parseTopics(doc);
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

async function crawlDetailsAndChapters(limit = 300) {
  const t0 = Date.now();
  const comics = await DB.getAll('comics');
  const need = comics.filter(c => !c.author && c.detail_url).slice(0, limit);
  let detailCount = 0;
  let chapterCount = 0;

  for (const batch of chunk(need, Http.CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        await Http.sleep(Http.REQUEST_DELAY);
        const html = await Http.fetchPage(c.detail_url);
        if (!html) { Http.logError('crawlDetailAndChapters', c.source_id); return; }
        const doc = Parsers.parseHTML(html);
        if (!doc) { Http.logError('crawlDetailAndChapters', `parseHTML ${c.source_id} failed`); return; }

        // 合并详情和章节解析，一次fetch提取所有数据
        Object.assign(c, Parsers.parseDetail(doc));
        await DB.upsert('comics', c, 'source_id');
        detailCount++;

        const chs = Parsers.parseChapters(doc, c.source_id);
        if (chs.length > 0) {
          await DB.append('chapters', chs);
          chapterCount++;
        }

        if (detailCount % 10 === 0) notify({ type: 'progress', stage: '详情+章节', current: detailCount, total: need.length });
      } catch (e) { Http.logError('crawlDetailAndChapters', `${c.source_id}: ${Http.getErrorMessage(e)}`); }
    }));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  notify({ type: 'done', msg: `详情: ${detailCount} 条, 章节: ${chapterCount} 条 (${elapsed}s)` });
  return { details: detailCount, chapters: chapterCount };
}

// 保留单独函数以兼容直接调用
async function crawlDetails(limit = 100) {
  const result = await crawlDetailsAndChapters(limit);
  return result.details;
}

async function crawlChapters(limit = 100) {
  // 单独爬取章节时，需要重新解析详情页
  const comics = await DB.getAll('comics');
  const need = comics.filter(c => c.detail_url).slice(0, limit);
  let count = 0;
  let skipped = 0;

  for (const batch of chunk(need, Http.CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        await Http.sleep(Http.REQUEST_DELAY);
        const html = await Http.fetchPage(c.detail_url);
        if (!html) { Http.logError('crawlChapters', c.source_id); skipped++; return; }
        const doc = Parsers.parseHTML(html);
        if (!doc) { Http.logError('crawlChapters', `parseHTML ${c.source_id} failed`); skipped++; return; }
        const chs = Parsers.parseChapters(doc, c.source_id);
        if (chs.length > 0) {
          await DB.append('chapters', chs);
          count++;
        } else {
          skipped++;
        }
      } catch (e) {
        Http.logError('crawlChapters', `${c.source_id}: ${Http.getErrorMessage(e)}`);
        skipped++;
      }
    }));
  }
  notify({ type: 'done', msg: `章节: ${count} 条 (跳过 ${skipped})` });
  return count;
}

async function crawlPages(limit = 100) {
  const chapters = await DB.getAll('chapters');
  const existing = await DB.getAll('pages');
  const existIds = new Set(existing.map(p => p.chapter_id));
  const need = chapters.filter(c => !existIds.has(c.chapter_id)).slice(0, limit);
  let count = 0;
  for (const batch of chunk(need, Http.CONCURRENCY)) {
    await Promise.all(batch.map(async (ch) => {
      try {
        await Http.sleep(Http.REQUEST_DELAY);
        const html = await Http.fetchPage(ch.chapter_url);
        if (!html) { Http.logError('crawlPages', ch.chapter_id); return; }
        const doc = Parsers.parseHTML(html);
        if (!doc) { Http.logError('crawlPages', `parseHTML ${ch.chapter_id} failed`); return; }
        const urls = Parsers.parseImages(doc);
        const pages = urls.map((url, i) => ({ chapter_id: ch.chapter_id, page_number: i + 1, image_url: url }));
        await DB.append('pages', pages);
        count++;
      } catch (e) { Http.logError('crawlPages', `${ch.chapter_id}: ${Http.getErrorMessage(e)}`); }
    }));
  }
  notify({ type: 'done', msg: `图片 URL: ${count} 章节` });
  return count;
}

const CRAWL_STAGES = ['home', 'topics', 'details_chapters', 'pages'];

async function fullCrawl(resumeFrom = null) {
  if (crawling) return;
  crawling = true;
  notify({ type: 'status', msg: '爬取中...' });

  const startIdx = resumeFrom ? CRAWL_STAGES.indexOf(resumeFrom) : 0;
  const stages = CRAWL_STAGES.slice(startIdx);

  try {
    for (const stage of stages) {
      await DB.saveCrawlState({ stage, status: 'running' });
      switch (stage) {
        case 'home': await crawlHome(); break;
        case 'topics': await crawlTopics(); break;
        case 'details_chapters': await crawlDetailsAndChapters(300); break;
        case 'pages': await crawlPages(300); break;
      }
    }
    await DB.clearCrawlState();
    const stats = await DB.getStats();
    notify({ type: 'done', msg: `完成! 漫画${stats.comics} 文章${stats.articles} 章节${stats.chapters} 图片${stats.pages}` });
  } catch (e) {
    Http.logError('fullCrawl', Http.getErrorMessage(e));
    notify({ type: 'error', msg: Http.getErrorMessage(e) });
    await DB.clearCrawlState().catch(() => {});
  }
  crawling = false;
}

async function generateArticleForComic(comic) {
  try {
    const result = await LLM.generateArticle(comic);
    await DB.upsert('comics', { ...comic, ai_title: result.title, ai_summary: result.summary, ai_body: result.body }, 'source_id');
    return { success: true, result };
  } catch (e) {
    return { success: false, error: Http.getErrorMessage(e) };
  }
}

async function batchGenerate(limit = 10) {
  const comics = await DB.getAll('comics');
  const need = comics.filter(c => c.source_id && !c.ai_title).slice(0, limit);
  let count = 0;
  for (const batch of chunk(need, Http.CONCURRENCY)) {
    await Promise.all(batch.map(async (c) => {
      try {
        const r = await generateArticleForComic(c);
        if (r.success) count++;
        notify({ type: 'generate_progress', current: count, total: need.length, title: c.title?.slice(0, 30) });
      } catch (e) { Http.logError('batchGenerate', `${c.source_id}: ${Http.getErrorMessage(e)}`); }
    }));
  }
  notify({ type: 'done', msg: `AI 生成完成: ${count}/${need.length}` });
  return count;
}

const handlers = {
  fullCrawl: (msg) => fullCrawl(msg.resumeFrom || null).then(() => ({ ok: true })),
  crawlHome: () => crawlHome().then(c => ({ ok: true, count: c })),
  crawlTopics: () => crawlTopics().then(c => ({ ok: true, count: c })),
  crawlDetails: (msg) => crawlDetails(msg.limit || 100).then(c => ({ ok: true, count: c })),
  crawlChapters: (msg) => crawlChapters(msg.limit || 100).then(c => ({ ok: true, count: c })),
  crawlDetailsAndChapters: (msg) => crawlDetailsAndChapters(msg.limit || 300).then(r => ({ ok: true, ...r })),
  crawlPages: (msg) => crawlPages(msg.limit || 100).then(c => ({ ok: true, count: c })),
  getStats: () => DB.getStats(),
  getCrawlState: () => DB.getCrawlState().then(s => s || null),
  clearCrawlState: () => DB.clearCrawlState().then(() => ({ ok: true })),
  getData: (msg) => DB.getAll(msg.store),
  generateArticle: (msg) => generateArticleForComic(msg.comic),
  batchGenerate: (msg) => batchGenerate(msg.limit || 10).then(c => ({ ok: true, count: c })),
  testLLM: () => LLM.testConnection().then(() => ({ ok: true })),
  clearErrors: () => DB.clearErrors().then(() => ({ ok: true })),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg.action];
  if (handler) {
    handler(msg).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: Http.getErrorMessage(e) }));
    return true;
  }
});
