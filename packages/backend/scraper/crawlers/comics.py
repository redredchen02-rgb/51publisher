import json
import re
from bs4 import BeautifulSoup

from ..config import BASE_URL


def parse_comic_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    result = {
        "author": None, "publish_date": None, "update_date": None,
        "status": None, "rating": None, "bookmark_count": None,
        "view_count": None, "like_count": None, "chapter_count": None,
        "tags": None, "categories": None, "description": None,
    }

    ld_data = _extract_jsonld(soup)
    if ld_data:
        if "author" in ld_data:
            author = ld_data["author"]
            if isinstance(author, dict):
                result["author"] = author.get("name")
            elif isinstance(author, str):
                result["author"] = author

        if "datePublished" in ld_data:
            result["publish_date"] = ld_data["datePublished"][:10]

        if "genre" in ld_data:
            genres = ld_data["genre"]
            if isinstance(genres, list):
                result["categories"] = ",".join(genres)
            elif isinstance(genres, str):
                result["categories"] = genres

        if "keywords" in ld_data:
            kw = ld_data["keywords"]
            if isinstance(kw, list):
                result["tags"] = ",".join(kw)
            elif isinstance(kw, str):
                result["tags"] = kw

        if "aggregateRating" in ld_data:
            rating = ld_data["aggregateRating"]
            try:
                result["rating"] = float(rating.get("ratingValue", 0))
            except (ValueError, TypeError):
                pass

        for stat in ld_data.get("interactionStatistic", []):
            itype = stat.get("interactionType", {})
            if isinstance(itype, dict):
                itype = itype.get("@type", "")
            count = stat.get("userInteractionCount", 0)
            if "Bookmark" in itype:
                result["bookmark_count"] = count
            elif "Like" in itype:
                result["like_count"] = count

    html_data = _extract_html_meta(soup)
    result.update({k: v for k, v in html_data.items() if v is not None})

    return result


def _extract_jsonld(soup: BeautifulSoup) -> dict | None:
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string)
            if isinstance(data, dict) and data.get("@type") == "Book":
                return data
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def _extract_html_meta(soup: BeautifulSoup) -> dict:
    result = {}

    author_el = soup.select_one(".comic-author-link span, .comic-author-link")
    if author_el:
        author_text = author_el.get_text(strip=True)
        if author_text:
            result["author"] = author_text

    if not result.get("author"):
        row = soup.select_one(".comic-author-row")
        if row:
            text = row.get_text(strip=True)
            m = re.search(r"作者[：:](.+?)(?:订阅|$)", text)
            if m:
                author = m.group(1).strip().strip("「」\"'")
                if author:
                    result["author"] = author

    status_el = soup.select_one("main .comic-item-tag, .index-content .comic-item-tag")
    if status_el:
        text = status_el.get_text(strip=True)
        if text:
            result["status"] = text

    if not result.get("status"):
        for el in soup.select(".text-gray-light"):
            text = el.get_text(strip=True)
            m = re.search(r"状态[：:](.+)", text)
            if m:
                result["status"] = m.group(1).strip()
                break

    for el in soup.select(".text-gray-light, [class*=gray]"):
        text = el.get_text(strip=True)
        if "更新时间" in text:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", text)
            if m:
                result["update_date"] = m.group(1)
        elif "类型" in text:
            m = re.search(r"类型[：:](.+)", text)
            if m:
                cat = m.group(1).strip()
                if not result.get("categories"):
                    result["categories"] = cat

    view_el = soup.select_one('[data-type="view"] .synopsisBtn_text')
    if view_el:
        text = view_el.get_text(strip=True).replace("观看量", "").strip()
        result["view_count"] = _parse_count(text)

    chapter_links = soup.select('a[href*="/chapter/"]')
    if chapter_links:
        result["chapter_count"] = len(set(
            a.get("href", "") for a in chapter_links if "/chapter/" in a.get("href", "")
        ))

    return result


def _parse_count(text: str) -> int | None:
    text = text.strip().lower()
    if not text:
        return None
    m = re.match(r"([\d.]+)\s*k", text)
    if m:
        return int(float(m.group(1)) * 1000)
    m = re.match(r"([\d.]+)\s*m", text)
    if m:
        return int(float(m.group(1)) * 1000000)
    try:
        return int(re.sub(r"[^\d]", "", text) or 0)
    except ValueError:
        return None
