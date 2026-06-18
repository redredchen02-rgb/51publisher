from bs4 import BeautifulSoup

from .base import parse_figure, extract_id


def parse_home_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    results = []
    seen_ids = set()

    for figure in soup.select("figure"):
        parsed = parse_figure(figure)
        if not parsed:
            continue

        source_id = extract_id(parsed["detail_url"])
        if not source_id or source_id in seen_ids:
            continue
        if not parsed.get("title"):
            continue
        seen_ids.add(source_id)

        status_el = figure.select_one(".comic-item-tag")
        status = status_el.get_text(strip=True) if status_el else ""

        extra_cats = []
        for cat_el in figure.select(".comic-item-Ptag"):
            c = cat_el.get_text(strip=True)
            if c and c not in parsed["categories"]:
                extra_cats.append(c)

        results.append({
            "source_id": source_id,
            "title": parsed["title"],
            "cover_url": parsed["cover_url"],
            "detail_url": parsed["detail_url"],
            "status": status,
            "categories": ",".join(parsed["categories"] + extra_cats),
            "tags": ",".join(parsed["tags"]),
            "chapter_count": None,
            "source": "home",
        })

    return results
