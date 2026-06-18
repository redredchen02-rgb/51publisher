import re
from bs4 import BeautifulSoup, Tag

from ..config import BASE_URL


def parse_figure(figure: Tag) -> dict | None:
    link = figure.select_one("a[href]")
    if not link:
        return None

    href = link.get("href", "")
    if not href or href == "/":
        return None

    title_el = figure.select_one("figcaption")
    title = title_el.get_text(strip=True) if title_el else ""

    img = figure.select_one("img[data-src]")
    cover_url = img["data-src"] if img else ""
    if cover_url and not cover_url.startswith("http"):
        cover_url = BASE_URL + cover_url

    detail_url = href
    if not detail_url.startswith("http"):
        detail_url = BASE_URL + detail_url

    tags = []
    for tag_el in figure.select("a[href*='/tags/']"):
        t = tag_el.get_text(strip=True)
        if t:
            tags.append(t)

    categories = []
    for cat_el in figure.select("a[href*='/category/']"):
        c = cat_el.get_text(strip=True)
        if c and c not in categories:
            categories.append(c)

    return {
        "title": title,
        "cover_url": cover_url,
        "detail_url": detail_url,
        "tags": tags,
        "categories": categories,
    }


def extract_id(url: str) -> str | None:
    m = re.search(r"/(\d+)(?:\?|$|#)", url)
    if m:
        return m.group(1)
    m = re.search(r"/([a-z_]+/\d+)", url)
    if m:
        return m.group(1)
    return None


def full_url(path: str) -> str:
    if path.startswith("http"):
        return path
    return BASE_URL + path
