from scraper.crawlers.topics import parse_topic_detail, parse_topic_list, _detect_type, _extract_topic_id


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

    def test_bare_numeric_id(self):
        # Single numeric segment with no word prefix — hits the r"/(\d+)$" fallback.
        assert _extract_topic_id("/12345") == "12345"

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

    def test_skips_figure_without_link(self):
        # parse_figure returns None when there is no <a href> → hits the `if not parsed` guard.
        html = "<html><body><figure><img data-src='x'><figcaption>No link</figcaption></figure></body></html>"
        assert parse_topic_list(html) == []

    def test_skips_figure_with_unresolvable_topic_id(self):
        # URL contains /topic/ but _extract_topic_id returns None (no numeric segment).
        html = """
        <html><body>
        <figure>
          <a href="/topic/words-only/"><figcaption>Title</figcaption></a>
        </figure>
        </body></html>
        """
        assert parse_topic_list(html) == []

    def test_skips_figure_with_empty_title(self):
        # Valid topic URL but no figcaption → title="" → `if not parsed.get("title")` guard.
        html = """
        <html><body>
        <figure>
          <a href="/topic/hub/200"><img data-src="x"></a>
        </figure>
        </body></html>
        """
        assert parse_topic_list(html) == []


class TestParseTopicDetail:
    def test_extracts_content_and_comic_refs(self):
        html = """
        <html><body>
        <div class="post-content">
          <p>文章正文内容</p>
          <a href="/comic/100001">漫画链接</a>
          <a href="https://51acgs.com/123456">另一个链接</a>
        </div>
        </body></html>
        """
        result = parse_topic_detail(html)
        assert "文章正文内容" in result["content_text"]
        assert "post-content" in result["content_html"]
        assert "100001" in result["comic_refs"]
        assert "123456" in result["comic_refs"]

    def test_returns_empty_strings_when_no_content_element(self):
        result = parse_topic_detail("<html><body><p>No container</p></body></html>")
        assert result["content_html"] == ""
        assert result["content_text"] == ""
        assert result["comic_refs"] == ""

    def test_deduplicates_comic_refs(self):
        html = """
        <html><body>
        <div class="post-content">
          <a href="/comic/100001">Link A</a>
          <a href="/comic/100001">Link B duplicate</a>
        </div>
        </body></html>
        """
        result = parse_topic_detail(html)
        refs = [r for r in result["comic_refs"].split(",") if r]
        assert refs.count("100001") == 1
