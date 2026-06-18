import pytest
from scraper.crawlers.home import parse_home_page


SAMPLE_HOME_HTML = """
<html><body>
<figure>
  <a href="/comic/12345">
    <img data-src="https://pic.example.com/cover1.jpg">
    <figcaption>测试漫画标题</figcaption>
  </a>
  <a href="/tags/恋爱">恋爱</a>
  <a href="/tags/校园">校园</a>
  <a href="/category/少年">少年</a>
  <span class="comic-item-tag">连载中</span>
  <span class="comic-item-Ptag">全彩</span>
</figure>
<figure>
  <a href="/comic/67890">
    <img data-src="https://pic.example.com/cover2.jpg">
    <figcaption>第二部漫画</figcaption>
  </a>
  <a href="/tags/奇幻">奇幻</a>
  <a href="/category/少女">少女</a>
</figure>
<figure>
  <a href="/topic/hub/123">
    <figcaption>专题文章</figcaption>
  </a>
</figure>
</body></html>
"""


class TestParseHomePage:
    def test_extracts_comics(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert len(results) >= 2
        source_ids = [r["source_id"] for r in results]
        assert "12345" in source_ids
        assert "67890" in source_ids

    def test_extracts_source_id(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert results[0]["source_id"] == "12345"
        assert results[1]["source_id"] == "67890"

    def test_extracts_title(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert results[0]["title"] == "测试漫画标题"
        assert results[1]["title"] == "第二部漫画"

    def test_extracts_cover_url(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert results[0]["cover_url"] == "https://pic.example.com/cover1.jpg"

    def test_extracts_tags(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert "恋爱" in results[0]["tags"]
        assert "校园" in results[0]["tags"]

    def test_extracts_categories(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert "少年" in results[0]["categories"]
        assert "全彩" in results[0]["categories"]

    def test_extracts_status(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        assert results[0]["status"] == "连载中"

    def test_skips_non_comic_figures(self):
        results = parse_home_page(SAMPLE_HOME_HTML)
        for r in results:
            assert r["source_id"] not in ["hub", "blog"]

    def test_deduplicates(self):
        html = """
        <html><body>
        <figure>
          <a href="/comic/111"><img data-src="x"><figcaption>A</figcaption></a>
        </figure>
        <figure>
          <a href="/comic/111"><img data-src="x"><figcaption>B</figcaption></a>
        </figure>
        </body></html>
        """
        results = parse_home_page(html)
        assert len(results) == 1

    def test_empty_html(self):
        results = parse_home_page("<html><body></body></html>")
        assert results == []
