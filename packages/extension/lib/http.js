// HTTP fetch with retry/backoff + shared low-level utilities for the service
// worker and parsers. Constants mirror the backend scraper/config.py; they live
// in different runtimes (DOMParser vs BeautifulSoup) and are kept in sync by hand.

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

function logError(context, error) {
  DB.append('errors', [{ source_id: `${context}_${Date.now()}`, context, error: String(error), timestamp: new Date().toISOString() }]);
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, { headers: { 'Referer': 'https://51acgs.com/' } });
      if (resp.ok) return await resp.text();
      if ([429, 403, 503].includes(resp.status)) {
        const wait = Math.pow(RETRY_BACKOFF, attempt + 1) * 1000;
        logError('fetchPage', `${resp.status} ${url}, retry in ${(wait / 1000).toFixed(1)}s`);
        await sleep(wait);
        continue;
      }
      return null;
    } catch {
      await sleep(Math.pow(RETRY_BACKOFF, attempt + 1) * 1000);
    }
  }
  return null;
}

const Http = {
  REQUEST_DELAY, MAX_RETRIES, RETRY_BACKOFF, CONCURRENCY,
  sleep, getErrorMessage, logError, fetchPage,
};

// Service Worker 使用 self，普通页面使用 window
if (typeof window !== 'undefined') {
  window.Http = Http;
} else if (typeof self !== 'undefined') {
  self.Http = Http;
}
