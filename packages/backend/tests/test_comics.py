import json
import pytest
from scraper.crawlers.comics import parse_comic_detail


def _make_jsonld(author="测试作者", date="2024-01-15", genres=None, keywords=None,
                 bookmark=100, like=50, rating=4.5):
    ld = {
        "@type": "Book",
        "author": author,
        "datePublished": date,
    }
    if genres:
        ld["genre"] = genres
    if keywords:
        ld["keywords"] = keywords
    if bookmark or like:
        ld["interactionStatistic"] = []
        if bookmark:
            ld["interactionStatistic"].append({
                "interactionType": {"@type": "BookmarkAction"},
                "userInteractionCount": bookmark,
            })
        if like:
            ld["interactionStatistic"].append({
                "interactionType": {"@type": "LikeAction"},
                "userInteractionCount": like,
            })
    if rating:
        ld["aggregateRating"] = {"ratingValue": rating}
    return ld


class TestParseComicDetail:
    def test_extracts_author_from_jsonld(self):
        ld = _make_jsonld(author="测试作者")
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert result["author"] == "测试作者"

    def test_extracts_author_dict(self):
        ld = _make_jsonld(author={"@type": "Person", "name": "字典作者"})
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert result["author"] == "字典作者"

    def test_extracts_date(self):
        ld = _make_jsonld(date="2024-01-15T00:00:00Z")
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert result["publish_date"] == "2024-01-15"

    def test_extracts_genres_as_list(self):
        ld = _make_jsonld(genres=["恋爱", "校园"])
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert "恋爱" in result["categories"]
        assert "校园" in result["categories"]

    def test_extracts_keywords(self):
        ld = _make_jsonld(keywords=["tag1", "tag2"])
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert "tag1" in result["tags"]
        assert "tag2" in result["tags"]

    def test_extracts_bookmark_count(self):
        ld = _make_jsonld(bookmark=200)
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert result["bookmark_count"] == 200

    def test_extracts_rating(self):
        ld = _make_jsonld(rating=4.8)
        html = f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"
        result = parse_comic_detail(html)
        assert result["rating"] == 4.8

    def test_fallback_to_html_author(self):
        html = """
        <html><body>
        <div class="comic-author-link"><span>HTML作者</span></div>
        </body></html>
        """
        result = parse_comic_detail(html)
        assert result["author"] == "HTML作者"

    def test_fallback_to_author_row(self):
        html = """
        <html><body>
        <div class="comic-author-row">作者：行内作者 订阅</div>
        </body></html>
        """
        result = parse_comic_detail(html)
        assert result["author"] == "行内作者"

    def test_extracts_chapter_count(self):
        html = """
        <html><body>
        <a href="/chapter/1">Ch1</a>
        <a href="/chapter/2">Ch2</a>
        <a href="/chapter/2">Ch2 dup</a>
        </body></html>
        """
        result = parse_comic_detail(html)
        assert result["chapter_count"] == 2

    def test_extracts_update_date(self):
        html = """
        <html><body>
        <span class="text-gray-light">更新时间：2024-06-15</span>
        </body></html>
        """
        result = parse_comic_detail(html)
        assert result["update_date"] == "2024-06-15"

    def test_empty_html(self):
        result = parse_comic_detail("<html><body></body></html>")
        assert result["author"] is None
        assert result["chapter_count"] is None

    # --- malformed JSON-LD must degrade, not crash (untrusted external input) ---

    def _html_with_ld(self, ld):
        return f"<html><body><script type='application/ld+json'>{json.dumps(ld)}</script></body></html>"

    def test_non_string_date_published_is_ignored(self):
        # datePublished as a number must not crash the [:10] slice.
        result = parse_comic_detail(self._html_with_ld({"@type": "Book", "datePublished": 2024}))
        assert result["publish_date"] is None

    def test_aggregate_rating_not_a_dict_is_ignored(self):
        # ratingValue arriving as a bare string/number must not raise AttributeError.
        result = parse_comic_detail(self._html_with_ld({"@type": "Book", "aggregateRating": "4.5"}))
        assert result["rating"] is None

    def test_interaction_statistic_as_single_object(self):
        # schema.org allows a single object (not just an array).
        ld = {"@type": "Book", "interactionStatistic": {
            "interactionType": {"@type": "BookmarkAction"}, "userInteractionCount": 42}}
        result = parse_comic_detail(self._html_with_ld(ld))
        assert result["bookmark_count"] == 42

    def test_interaction_statistic_wrong_type_is_ignored(self):
        # A stray string where a list is expected must not crash iteration.
        result = parse_comic_detail(self._html_with_ld(
            {"@type": "Book", "interactionStatistic": "oops"}))
        assert result["bookmark_count"] is None
        assert result["like_count"] is None
