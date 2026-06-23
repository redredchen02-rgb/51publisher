from bs4 import BeautifulSoup

from scraper.crawlers.base import extract_id, parse_figure


def _fig(html: str):
    soup = BeautifulSoup(f"<html><body>{html}</body></html>", "lxml")
    return soup.select_one("figure")


# --- parse_figure edge cases --------------------------------------------------

def test_parse_figure_returns_none_when_no_link():
    assert parse_figure(_fig("<figure><img data-src='x'><figcaption>T</figcaption></figure>")) is None


def test_parse_figure_returns_none_for_root_href():
    # href="/" is treated as a navigation anchor, not a content link.
    assert parse_figure(_fig('<figure><a href="/"><figcaption>T</figcaption></a></figure>')) is None


def test_parse_figure_returns_none_for_empty_href():
    assert parse_figure(_fig('<figure><a href=""><figcaption>T</figcaption></a></figure>')) is None


def test_parse_figure_builds_absolute_cover_url():
    result = parse_figure(_fig('<figure><a href="/comic/1"><img data-src="/img/c.jpg"><figcaption>T</figcaption></a></figure>'))
    assert result is not None
    assert result["cover_url"].startswith("https://")


# --- extract_id paths ---------------------------------------------------------

def test_extract_id_primary_path_at_end():
    assert extract_id("https://example.com/comic/12345") == "12345"


def test_extract_id_primary_path_before_query():
    assert extract_id("https://example.com/comic/12345?page=2") == "12345"


def test_extract_id_secondary_word_digit_path():
    # Trailing slash prevents primary match; secondary catches /(word/digits).
    assert extract_id("https://example.com/series-hub/12345/") == "series-hub/12345"


def test_extract_id_tertiary_bare_digits():
    # No match for primary (digits not at end or before ?/#) and secondary
    # (digits appear before a non-digit word, not after one).
    # /12345/extra: primary fails (not at $, ?, #); secondary fails (no /<word>/<digits>
    # because the segment is /<digits>/<word>); tertiary finds /12345.
    assert extract_id("https://example.com/12345/summary") == "12345"


def test_extract_id_returns_none_for_no_digits():
    assert extract_id("https://example.com/no/digits/here") is None
