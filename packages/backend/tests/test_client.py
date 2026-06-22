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
