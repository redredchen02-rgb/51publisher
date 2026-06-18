import pytest
from scraper.crawlers.search import parse_search_results


class TestParseSearchResults:
    def test_extracts_comics(self):
        html = """
        <html><body>
        <figure>
          <a href="/comic/12345">
            <img data-src="https://pic.example.com/cover.jpg">
            <figcaption>搜索结果漫画</figcaption>
          </a>
          <p>这是描述</p>
        </figure>
        </body></html>
        """
        results = parse_search_results(html)
        assert len(results) == 1
        assert results[0]["source_id"] == "12345"
        assert results[0]["title"] == "搜索结果漫画"
        assert results[0]["source"] == "search"

    def test_extracts_topic_results(self):
        html = """
        <html><body>
        <figure>
          <a href="/topic/hub/100">
            <img data-src="https://pic.example.com/cover.jpg">
            <figcaption>搜索结果文章</figcaption>
          </a>
          <p>文章描述</p>
        </figure>
        </body></html>
        """
        results = parse_search_results(html)
        assert len(results) == 1
        assert results[0]["source"] == "search_topic"

    def test_extracts_description(self):
        html = """
        <html><body>
        <figure>
          <a href="/comic/12345">
            <img data-src="x">
            <figcaption>标题</figcaption>
          </a>
          <p>这是详细描述内容</p>
        </figure>
        </body></html>
        """
        results = parse_search_results(html)
        assert results[0]["description"] == "这是详细描述内容"

    def test_empty_html(self):
        results = parse_search_results("<html><body></body></html>")
        assert results == []
