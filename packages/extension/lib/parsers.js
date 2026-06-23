// Pure DOM parsers for 51acgs.com pages. No network or storage side effects:
// each takes a parsed Document (or HTML string) and returns plain data, so they
// can be unit-tested in isolation. Parse errors are reported via Http when the
// service worker is present, and degrade silently under test runners.

function reportParseError(context, e) {
  if (typeof Http !== 'undefined') Http.logError(context, Http.getErrorMessage(e));
}

function parseHTML(html) {
  if (!html) return null;
  try {
    return new DOMParser().parseFromString(html, 'text/html');
  } catch (e) {
    reportParseError('parseHTML', e);
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

function parseLDJson(doc) {
  const book = {}, itemLists = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const d = JSON.parse(s.textContent);
      if (d['@type'] === 'Book') Object.assign(book, d);
      if (d['@type'] === 'ItemList') itemLists.push(d);
    } catch (e) { reportParseError('parseLDJson', e); }
  });
  return { book, itemLists };
}

function parseDetail(doc) {
  if (!doc) return { author: null, status: null, tags: null, categories: null, publish_date: null, update_date: null, bookmark_count: null, view_count: null, chapter_count: null };
  const r = { author: null, status: null, tags: null, categories: null, publish_date: null, update_date: null, bookmark_count: null, view_count: null, chapter_count: null };

  const { book, itemLists } = parseLDJson(doc);

  if (book.author) {
    r.author = typeof book.author === 'object' ? book.author.name : book.author;
  }
  if (book.datePublished) r.publish_date = book.datePublished.slice(0, 10);
  if (book.genre) r.categories = (Array.isArray(book.genre) ? book.genre : [book.genre]).join(',');
  if (book.keywords) r.tags = (Array.isArray(book.keywords) ? book.keywords : [book.keywords]).join(',');

  for (const stat of (book.interactionStatistic || [])) {
    const itype = typeof stat.interactionType === 'object' ? stat.interactionType['@type'] : '';
    if (itype.includes('Bookmark')) r.bookmark_count = stat.userInteractionCount;
  }

  for (const il of itemLists) {
    if (il.name && il.name.includes('章节目录')) {
      r.chapter_count = il.numberOfItems || il.itemListElement?.length || 0;
      break;
    }
  }

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

  const { itemLists } = parseLDJson(doc);

  for (const d of itemLists) {
    if (d.name && d.name.includes('章节目录')) {
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
      break;
    }
  }

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

const Parsers = {
  parseHTML, parseHome, parseLDJson, parseDetail, parseChapters, parseImages, parseTopics,
};

// Service Worker 使用 self，普通页面使用 window
if (typeof window !== 'undefined') {
  window.Parsers = Parsers;
} else if (typeof self !== 'undefined') {
  self.Parsers = Parsers;
}
