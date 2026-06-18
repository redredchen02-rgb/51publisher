import re
from bs4 import BeautifulSoup

from .base import parse_figure


def parse_topic_list(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    results = []

    for figure in soup.select("figure"):
        parsed = parse_figure(figure)
        if not parsed:
            continue

        href = parsed["detail_url"]
        if "/topic/" not in href:
            continue

        source_id = _extract_topic_id(href)
        if not source_id:
            continue
        if not parsed.get("title"):
            continue

        desc_el = figure.select_one("p")
        summary = desc_el.get_text(strip=True) if desc_el else ""

        tag_els = figure.select("a.xs-w-tag")
        tags = [t.get_text(strip=True) for t in tag_els if t.get_text(strip=True)]

        results.append({
            "source_id": source_id,
            "title": parsed["title"],
            "cover_url": parsed["cover_url"],
            "detail_url": parsed["detail_url"],
            "summary": summary,
            "article_type": _detect_type(href),
            "tags": ",".join(tags),
        })

    return results


def parse_topic_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    content_el = soup.select_one(".post-content, .topic-content, article, .content-area, main .dx-container")
    content_html = str(content_el) if content_el else ""
    content_text = content_el.get_text(separator="\n", strip=True) if content_el else ""

    comic_refs = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if "/comic/" in href or re.search(r"/\d{5,}", href):
            ref_id = re.search(r"/(\d{5,})", href)
            if ref_id:
                comic_refs.append(ref_id.group(1))

    return {
        "content_html": content_html,
        "content_text": content_text,
        "comic_refs": ",".join(set(comic_refs)),
    }


def _detect_type(href: str) -> str:
    for t in ("anime_hub", "anime_blog", "novel_hub", "hub", "blog"):
        if f"/{t}/" in href:
            return t
    return "unknown"


def _extract_topic_id(href: str) -> str | None:
    m = re.search(r"/(\w+)/(\d+)$", href)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    m = re.search(r"/(\d+)$", href)
    if m:
        return m.group(1)
    return None
