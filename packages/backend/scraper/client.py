import asyncio
import logging
import time
import httpx

from .config import HEADERS, MAX_RETRIES, RETRY_BACKOFF, REQUEST_DELAY

logger = logging.getLogger("scraper")

_client: httpx.Client | None = None
_last_request_ts = 0.0


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True)
    return _client


def _throttle() -> None:
    """Space consecutive sync requests at least REQUEST_DELAY seconds apart.

    Only sleeps when the gap since the previous request is too small, so it
    never stacks on top of the retry backoff (which already waits longer).
    """
    global _last_request_ts
    wait = REQUEST_DELAY - (time.monotonic() - _last_request_ts)
    if wait > 0:
        time.sleep(wait)
    _last_request_ts = time.monotonic()


def fetch_page(url: str) -> str | None:
    client = _get_client()
    for attempt in range(MAX_RETRIES):
        try:
            _throttle()
            resp = client.get(url)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code in (429, 403, 503):
                wait = RETRY_BACKOFF ** (attempt + 1)
                logger.info(f"[HTTP] {resp.status_code}, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            logger.info(f"[HTTP] {resp.status_code} for {url}")
            return None
        except Exception as e:
            wait = RETRY_BACKOFF ** (attempt + 1)
            logger.info(f"[HTTP] Error: {e}, retrying in {wait:.1f}s...")
            time.sleep(wait)
    return None


async def fetch_page_async(client: httpx.AsyncClient, url: str, sem: asyncio.Semaphore) -> str | None:
    async with sem:
        for attempt in range(MAX_RETRIES):
            try:
                resp = await client.get(url, headers=HEADERS, timeout=30, follow_redirects=True)
                if resp.status_code == 200:
                    return resp.text
                if resp.status_code in (429, 403, 503):
                    wait = RETRY_BACKOFF ** (attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                return None
            except Exception as e:
                wait = RETRY_BACKOFF ** (attempt + 1)
                logger.info(f"[HTTP] Error: {e}, retrying in {wait:.1f}s...")
                await asyncio.sleep(wait)
    return None


def close_client():
    global _client
    if _client and not _client.is_closed:
        _client.close()
        _client = None
