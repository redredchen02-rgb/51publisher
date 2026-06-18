import pytest
from scraper.crawlers.topics import parse_topic_list, _detect_type, _extract_topic_id


class TestDetectType:
    def test_anime_hub(self):
        assert _detect_type("/topic/anime_hub/123") == "anime_hub"

    def test_anime_blog(self):
        assert _detect_type("/topic/anime_blog/456") == "anime_blog"

    def test_novel_hub(self):
        assert _detect_type("/topic/novel_hub/789") == "novel_hub"

    def test_hub(self):
        assert _detect_type("/topic/hub/111") == "hub"

    def test_blog(self):
        assert _detect_type("/topic/blog/222") == "blog"

    def test_unknown(self):
        assert _detect_type("/topic/other/333") == "unknown"


class TestExtractTopicId:
    def test_standard_format(self):
        assert _extract_topic_id("/topic/hub/12345") == "hub_12345"

    def test_numeric_only(self):
        result = _extract_topic_id("/topic/67890")
        assert result is not None
        assert "67890" in result

    def test_no_match(self):
        assert _extract_topic_id("/topic/") is None


class TestParseTopicList:
    def test_extracts_topics(self):
        html = """
        <html><body>
        <figure>
          <a href="/topic/hub/100">
            <img data-src="https://pic.example.com/cover.jpg">
            <figcaption>Hub文章标题</figcaption>
          </a>
          <p>这是摘要</p>
          <a class="xs-w-tag">标签1</a>
        </figure>
        </body></html>
        """
        results = parse_topic_list(html)
        assert len(results) == 1
        assert results[0]["source_id"] == "hub_100"
        assert results[0]["title"] == "Hub文章标题"
        assert results[0]["article_type"] == "hub"
        assert results[0]["summary"] == "这是摘要"
        assert "标签1" in results[0]["tags"]

    def test_skips_non_topic_figures(self):
        html = """
        <html><body>
        <figure>
          <a href="/comic/123">
            <img data-src="x">
            <figcaption>漫画</figcaption>
          </a>
        </figure>
        </body></html>
        """
        results = parse_topic_list(html)
        assert len(results) == 0
