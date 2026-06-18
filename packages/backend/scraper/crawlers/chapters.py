import re
from bs4 import BeautifulSoup

from ..config import BASE_URL


def parse_chapter_list(html: str, comic_source_id: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    results = []
    seen = set()

    for a in soup.select('a[href*="/chapter/"]'):
        href = a.get("href", "")
        if not href:
            continue

        m = re.search(r"/chapter/(\d+)", href)
        if not m:
            continue

        chapter_id = m.group(1)
        if chapter_id in seen:
            continue
        seen.add(chapter_id)

        name = a.get_text(strip=True)
        if not name:
            name = f"Chapter {chapter_id}"

        chapter_url = href if href.startswith("http") else BASE_URL + href

        results.append({
            "comic_source_id": comic_source_id,
            "chapter_id": chapter_id,
            "chapter_name": name,
            "chapter_url": chapter_url,
            "page_count": None,
        })

    return results


def parse_chapter_images(html: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    urls = []

    reader = soup.select_one(".reader-container, .comics-wrapper, .comics")
    if reader:
        for img in reader.select("img[data-src]"):
            src = img.get("data-src", "")
            if src and "pic." in src and "loading.png" not in src:
                urls.append(src)

    if not urls:
        for img in soup.select('img[data-src]'):
            src = img.get("data-src", "")
            if src and "pic." in src and "loading.png" not in src:
                urls.append(src)

    return urls
