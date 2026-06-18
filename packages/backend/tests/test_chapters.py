import pytest
from scraper.crawlers.chapters import parse_chapter_list, parse_chapter_images


class TestParseChapterList:
    def test_extracts_chapters(self):
        html = """
        <html><body>
        <a href="/chapter/1001">第1话</a>
        <a href="/chapter/1002">第2话</a>
        <a href="/chapter/1003">第3话</a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        assert len(results) == 3

    def test_extracts_chapter_ids(self):
        html = """
        <html><body>
        <a href="/chapter/1001">第1话</a>
        <a href="/chapter/1002">第2话</a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        ids = [r["chapter_id"] for r in results]
        assert "1001" in ids
        assert "1002" in ids

    def test_extracts_chapter_names(self):
        html = """
        <html><body>
        <a href="/chapter/1001">第1话 开始</a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        assert results[0]["chapter_name"] == "第1话 开始"

    def test_default_name_when_empty(self):
        html = """
        <html><body>
        <a href="/chapter/1001"></a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        assert results[0]["chapter_name"] == "Chapter 1001"

    def test_deduplicates(self):
        html = """
        <html><body>
        <a href="/chapter/1001">A</a>
        <a href="/chapter/1001">B</a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        assert len(results) == 1

    def test_builds_full_url(self):
        html = """
        <html><body>
        <a href="/chapter/1001">Ch1</a>
        </body></html>
        """
        results = parse_chapter_list(html, "12345")
        assert results[0]["chapter_url"].startswith("http")

    def test_sets_comic_source_id(self):
        html = """
        <html><body>
        <a href="/chapter/1001">Ch1</a>
        </body></html>
        """
        results = parse_chapter_list(html, "99999")
        assert results[0]["comic_source_id"] == "99999"


class TestParseChapterImages:
    def test_extracts_images(self):
        html = """
        <html><body>
        <div class="reader-container">
          <img data-src="https://pic.example.com/1.jpg">
          <img data-src="https://pic.example.com/2.jpg">
        </div>
        </body></html>
        """
        urls = parse_chapter_images(html)
        assert len(urls) == 2
        assert "pic.example.com" in urls[0]

    def test_filters_loading_images(self):
        html = """
        <html><body>
        <div class="comics-wrapper">
          <img data-src="https://pic.example.com/loading.png">
          <img data-src="https://pic.example.com/real.jpg">
        </div>
        </body></html>
        """
        urls = parse_chapter_images(html)
        assert len(urls) == 1
        assert "real.jpg" in urls[0]

    def test_filters_non_pic_images(self):
        html = """
        <html><body>
        <div class="comics">
          <img data-src="https://ads.example.com/banner.png">
          <img data-src="https://pic.example.com/page.jpg">
        </div>
        </body></html>
        """
        urls = parse_chapter_images(html)
        assert len(urls) == 1

    def test_empty_html(self):
        urls = parse_chapter_images("<html><body></body></html>")
        assert urls == []
