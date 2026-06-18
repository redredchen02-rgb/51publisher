import asyncio
import time
import httpx

from .config import HEADERS, MAX_RETRIES, RETRY_BACKOFF

_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.Client(headers=HEADERS, timeout=30, follow_redirects=True)
    return _client


def fetch_page(url: str) -> str | None:
    client = _get_client()
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(url)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code in (429, 403, 503):
                wait = RETRY_BACKOFF ** (attempt + 1)
                print(f"  [HTTP] {resp.status_code}, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            print(f"  [HTTP] {resp.status_code} for {url}")
            return None
        except Exception as e:
            wait = RETRY_BACKOFF ** (attempt + 1)
            print(f"  [HTTP] Error: {e}, retrying in {wait:.1f}s...")
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
                print(f"  [HTTP] Error: {e}, retrying in {wait:.1f}s...")
                await asyncio.sleep(wait)
    return None


def close_client():
    global _client
    if _client and not _client.is_closed:
        _client.close()
        _client = None
