import asyncio
import httpx
import scraper.client as client


class _Resp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class _FakeClient:
    """Returns queued responses; repeats the last one once exhausted."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def get(self, url):
        self.calls += 1
        item = self._responses[min(self.calls - 1, len(self._responses) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


def _install(monkeypatch, responses):
    fake = _FakeClient(responses)
    monkeypatch.setattr(client, "_get_client", lambda: fake)
    monkeypatch.setattr(client.time, "sleep", lambda s: None)  # no real waits
    return fake


# --- fetch_page behavior ----------------------------------------------------

def test_fetch_page_returns_text_on_200(monkeypatch):
    fake = _install(monkeypatch, [_Resp(200, "<html>OK</html>")])
    assert client.fetch_page("https://x/") == "<html>OK</html>"
    assert fake.calls == 1


def test_fetch_page_hard_status_returns_none_without_retry(monkeypatch):
    fake = _install(monkeypatch, [_Resp(404)])
    assert client.fetch_page("https://x/") is None
    assert fake.calls == 1  # 404 is not retried


def test_fetch_page_retries_throttled_status_then_gives_up(monkeypatch):
    fake = _install(monkeypatch, [_Resp(503), _Resp(503), _Resp(503), _Resp(503)])
    assert client.fetch_page("https://x/") is None
    assert fake.calls == client.MAX_RETRIES


def test_fetch_page_recovers_after_transient_429(monkeypatch):
    fake = _install(monkeypatch, [_Resp(429), _Resp(200, "DONE")])
    assert client.fetch_page("https://x/") == "DONE"
    assert fake.calls == 2


def test_fetch_page_retries_on_exception(monkeypatch):
    fake = _install(monkeypatch, [RuntimeError("boom"), _Resp(200, "OK")])
    assert client.fetch_page("https://x/") == "OK"
    assert fake.calls == 2


# --- A2 throttle: REQUEST_DELAY spacing -------------------------------------

def test_throttle_sleeps_when_called_back_to_back(monkeypatch):
    slept = []
    monkeypatch.setattr(client.time, "sleep", lambda s: slept.append(s))
    client._last_request_ts = client.time.monotonic()  # a request "just" happened
    client._throttle()
    assert slept, "throttle should sleep when called immediately after a request"
    assert 0 < slept[0] <= client.REQUEST_DELAY


def test_throttle_does_not_sleep_when_idle(monkeypatch):
    slept = []
    monkeypatch.setattr(client.time, "sleep", lambda s: slept.append(s))
    client._last_request_ts = client.time.monotonic() - (client.REQUEST_DELAY + 1)
    client._throttle()
    assert not slept, "throttle must not sleep when enough time has already passed"


# --- fetch_page_async behavior -----------------------------------------------

async def _noop_sleep(s: float) -> None:
    pass


class _FakeAsyncClient:
    """Async version of _FakeClient: queues responses, raises Exceptions as-is."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    async def get(self, url, **kwargs):
        self.calls += 1
        item = self._responses[min(self.calls - 1, len(self._responses) - 1)]
        if isinstance(item, Exception):
            raise item
        return item


def test_fetch_page_async_returns_text_on_200():
    async def run():
        fake = _FakeAsyncClient([_Resp(200, "async OK")])
        return await client.fetch_page_async(fake, "https://x/", asyncio.Semaphore(1))

    assert asyncio.run(run()) == "async OK"


def test_fetch_page_async_returns_none_on_hard_status():
    async def run():
        fake = _FakeAsyncClient([_Resp(404)])
        return await client.fetch_page_async(fake, "https://x/", asyncio.Semaphore(1))

    assert asyncio.run(run()) is None


def test_fetch_page_async_exhausts_retries_on_throttle(monkeypatch):
    monkeypatch.setattr(client.asyncio, "sleep", _noop_sleep)

    async def run():
        fake = _FakeAsyncClient([_Resp(503)] * (client.MAX_RETRIES + 1))
        await client.fetch_page_async(fake, "https://x/", asyncio.Semaphore(1))
        return fake

    fake = asyncio.run(run())
    assert fake.calls == client.MAX_RETRIES


def test_fetch_page_async_recovers_after_exception(monkeypatch):
    monkeypatch.setattr(client.asyncio, "sleep", _noop_sleep)

    async def run():
        fake = _FakeAsyncClient([RuntimeError("net fail"), _Resp(200, "retry OK")])
        result = await client.fetch_page_async(fake, "https://x/", asyncio.Semaphore(1))
        return result, fake

    result, fake = asyncio.run(run())
    assert result == "retry OK"
    assert fake.calls == 2


# --- _get_client / close_client -----------------------------------------------

def test_get_client_creates_instance_when_none(monkeypatch):
    monkeypatch.setattr(client, "_client", None)
    c = client._get_client()
    assert isinstance(c, httpx.Client)
    c.close()


def test_close_client_resets_to_none(monkeypatch):
    monkeypatch.setattr(client, "_client", httpx.Client(headers={}))
    client.close_client()
    assert client._client is None
