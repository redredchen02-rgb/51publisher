from bs4 import BeautifulSoup

from .base import parse_figure, extract_id


def parse_search_results(html: str, keyword: str = "") -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    results = []

    for figure in soup.select("figure"):
        parsed = parse_figure(figure)
        if not parsed:
            continue

        source_id = extract_id(parsed["detail_url"])
        if not source_id:
            continue

        desc_el = figure.select_one("p")
        description = desc_el.get_text(strip=True) if desc_el else ""

        is_topic = "/topic/" in parsed["detail_url"]

        results.append({
            "source_id": source_id,
            "title": parsed["title"],
            "cover_url": parsed["cover_url"],
            "detail_url": parsed["detail_url"],
            "description": description,
            "categories": ",".join(parsed["categories"]),
            "tags": ",".join(parsed["tags"]),
            "chapter_count": None,
            "source": "search_topic" if is_topic else "search",
        })

    return results
