import importlib
import os

import scraper.config as config


def _reload(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("SCRAPER_BASE_URL", raising=False)
    else:
        monkeypatch.setenv("SCRAPER_BASE_URL", value)
    return importlib.reload(config)


def test_base_url_defaults_when_env_unset(monkeypatch):
    cfg = _reload(monkeypatch, None)
    assert cfg.BASE_URL == "https://51acgs.com"
    assert cfg.HEADERS["Referer"] == "https://51acgs.com"


def test_base_url_overridden_by_env(monkeypatch):
    cfg = _reload(monkeypatch, "https://staging.example.com")
    assert cfg.BASE_URL == "https://staging.example.com"
    assert cfg.HEADERS["Referer"] == "https://staging.example.com"


def test_empty_env_falls_back_to_default(monkeypatch):
    cfg = _reload(monkeypatch, "")
    assert cfg.BASE_URL == "https://51acgs.com"


def teardown_module(module):
    # Restore default config so reloads here don't leak into other test modules.
    os.environ.pop("SCRAPER_BASE_URL", None)
    importlib.reload(config)
