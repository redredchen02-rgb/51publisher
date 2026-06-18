const DB_NAME = 'acgs_scraper';
const DB_VERSION = 2;
const STORES = ['comics', 'articles', 'chapters', 'pages', 'errors', 'crawl_state'];

let _dbCache = null;

function openDB() {
  if (_dbCache && !_dbCache.closed) {
    return Promise.resolve(_dbCache);
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const stores = [
        { name: 'comics', keyPath: 'source_id' },
        { name: 'articles', keyPath: 'source_id' },
        { name: 'chapters', keyPath: 'chapter_id' },
        { name: 'pages', keyPath: ['chapter_id', 'page_number'] },
        { name: 'errors', keyPath: 'source_id' },
        { name: 'crawl_state', keyPath: 'id' },
      ];
      for (const s of stores) {
        if (!db.objectStoreNames.contains(s.name)) {
          const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
          if (s.name === 'chapters') {
            store.createIndex('by_comic', 'comic_source_id', { unique: false });
          }
          if (s.name === 'pages') {
            store.createIndex('by_chapter', 'chapter_id', { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => {
      _dbCache = req.result;
      _dbCache.onclose = () => { _dbCache = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbTx(storeName, mode = 'readonly') {
  return openDB().then(db => {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

function idbRequest(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const req = store[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return idbTx(storeName).then(store => idbRequest(store, 'getAll'));
}

async function idbGet(storeName, key) {
  const store = await idbTx(storeName);
  return idbRequest(store, 'get', key);
}

async function idbPut(storeName, item) {
  const store = await idbTx(storeName, 'readwrite');
  return idbRequest(store, 'put', item);
}

async function idbAppend(storeName, items) {
  if (!items.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    items.forEach(item => store.put(item));
    tx.oncomplete = () => resolve(items.length);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbUpsert(storeName, item, key = 'source_id') {
  const existing = await idbGet(storeName, item[key]);
  const merged = existing ? { ...existing, ...item } : item;
  return idbPut(storeName, merged);
}

async function idbCount(storeName) {
  const store = await idbTx(storeName);
  return idbRequest(store, 'count');
}

async function idbGetStats() {
  const [comics, articles, chapters, pages] = await Promise.all([
    idbCount('comics'),
    idbCount('articles'),
    idbCount('chapters'),
    idbCount('pages'),
  ]);
  return { comics, articles, chapters, pages };
}

const DB = {
  get: idbGet,
  getAll: idbGetAll,
  append: idbAppend,
  upsert: idbUpsert,
  getStats: idbGetStats,
  getCrawlState: () => idbGet('crawl_state', 'current'),
  saveCrawlState: (state) => idbPut('crawl_state', { id: 'current', ...state, updatedAt: new Date().toISOString() }),
  clearCrawlState: () => idbTx('crawl_state', 'readwrite').then(store => idbRequest(store, 'clear')),
  clearErrors: () => idbTx('errors', 'readwrite').then(store => idbRequest(store, 'clear')),
};

// Service Worker 使用 self，普通页面使用 window
if (typeof window !== 'undefined') {
  window.DB = DB;
} else if (typeof self !== 'undefined') {
  self.DB = DB;
}
