#!/usr/bin/env python3
"""51acgs.com scraper CLI — fetch comics and articles for 代审池."""

import argparse
import asyncio
import logging
import os
import signal
import sys
from datetime import datetime
from urllib.parse import urlparse, quote

import httpx

from .client import fetch_page, fetch_page_async, close_client
from .config import BASE_URL, EXPORTS_DIR, CONCURRENCY, DATA_DIR
from .crawlers.chapters import parse_chapter_list, parse_chapter_images
from .crawlers.comics import parse_comic_detail
from .crawlers.home import parse_home_page
from .crawlers.search import parse_search_results
from .crawlers.topics import parse_topic_list, parse_topic_detail
from .exporters import export_csv
from .models import (
    init_db, get_db, upsert_comic, upsert_article, upsert_topic_detail,
    update_comic_detail, query_comics, query_comics_needing_detail,
    query_articles, get_stats, upsert_chapter, upsert_page,
    query_comics_without_chapters, query_chapters_needing_pages,
    set_chapter_page_count, query_pages_to_download, set_page_local_path,
)

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("scraper")


def cmd_scrape_home(conn):
    logger.info("[1/5] Scraping homepage latest comics...")
    html = fetch_page(BASE_URL)
    if not html:
        logger.error("Failed to fetch homepage")
        return 0

    items = parse_home_page(html)
    count = 0
    for item in items:
        if upsert_comic(conn, item):
            count += 1
    conn.commit()
    logger.info(f"Found {len(items)} comics, {count} saved")
    return len(items)


async def cmd_scrape_topic_details_async(conn, items, sem):
    async def process_topic(client, item, sem):
        detail_url = item.get("detail_url", "")
        if not detail_url:
            return False
        detail_html = await fetch_page_async(client, detail_url, sem)
        if not detail_html:
            return False
        detail = parse_topic_detail(detail_html)
        detail["topic_id"] = item["source_id"]
        upsert_topic_detail(conn, detail)
        return True

    return await _batch_scrape(conn, items, process_topic, "Topic details", sem)


def cmd_scrape_topic_details(conn, items):
    return asyncio.run(cmd_scrape_topic_details_async(conn, items, asyncio.Semaphore(CONCURRENCY)))


def cmd_scrape_topics(conn, scrape_details=False, pages=1):
    logger.info("[2/5] Scraping topic articles...")
    total = 0
    all_items = []

    topic_urls = [
        (f"{BASE_URL}/topic", "all"),
        (f"{BASE_URL}/topic/hub", "hub"),
        (f"{BASE_URL}/topic/blog", "blog"),
        (f"{BASE_URL}/topic/anime_hub", "anime_hub"),
        (f"{BASE_URL}/topic/anime_blog", "anime_blog"),
        (f"{BASE_URL}/topic/novel_hub", "novel_hub"),
    ]

    for base_url, label in topic_urls:
        page_count = 0
        for page in range(1, pages + 1):
            url = base_url if page == 1 else f"{base_url}?page={page}"
            logger.info(f"Fetching {label} page {page}...")
            html = fetch_page(url)
            if not html:
                break

            items = parse_topic_list(html)
            if not items:
                logger.info(f"{label} page {page}: no more items, stopping")
                break

            new_count = 0
            for item in items:
                if upsert_article(conn, item):
                    new_count += 1
            conn.commit()
            page_count += len(items)
            all_items.extend(items)
            logger.info(f"{label} page {page}: {len(items)} articles ({new_count} new)")

        total += page_count

    if scrape_details and all_items:
        logger.info(f"Scraping {len(all_items)} topic details (async)...")
        cmd_scrape_topic_details(conn, all_items)

    logger.info(f"Total: {total} articles saved")
    return total


async def _batch_scrape(conn, items, process_fn, label, sem=None):
    if not items:
        return 0

    sem = sem or asyncio.Semaphore(CONCURRENCY)
    count = 0
    total = len(items)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def process_one(item):
            nonlocal count
            result = await process_fn(client, item, sem)
            if result:
                count += 1
                if count % 10 == 0:
                    logger.info(f"[{count}/{total}]...")

        await asyncio.gather(*[process_one(item) for item in items])

    conn.commit()
    logger.info(f"{label}: {count}/{total}")
    return count


async def cmd_scrape_comic_details_async(conn, limit=500, incremental=False):
    logger.info("[3/5] Scraping comic details (async)...")
    if incremental:
        comics = query_comics_needing_detail(conn, limit=limit)
        logger.info(f"Incremental mode: {len(comics)} comics need details")
    else:
        comics = query_comics(conn, limit=limit)

    if not comics:
        logger.info("No comics to scrape")
        return 0

    async def process_comic(client, comic, sem):
        url = comic.get("detail_url", "")
        if not url:
            return False
        html = await fetch_page_async(client, url, sem)
        if not html:
            return False
        detail = parse_comic_detail(html)
        update_data = {k: v for k, v in detail.items() if v is not None and v != ""}
        if update_data:
            update_comic_detail(conn, comic["source_id"], update_data)
            title = comic["title"][:35]
            author = detail.get("author", "") or ""
            logger.info(f"{title}... ({author})")
            return True
        return False

    return await _batch_scrape(conn, comics, process_comic, "Comic details")


def cmd_scrape_comic_details(conn, limit=500, incremental=False):
    return asyncio.run(cmd_scrape_comic_details_async(conn, limit, incremental))


def cmd_scrape_search(conn, keyword, pages=1):
    logger.info(f"Searching for '{keyword}' ({pages} pages)...")
    total = 0

    for page in range(1, pages + 1):
        url = f"{BASE_URL}/search/result?keyword={quote(keyword)}"
        if page > 1:
            url += f"&page={page}"
        html = fetch_page(url)
        if not html:
            break

        items = parse_search_results(html)
        if not items:
            logger.info(f"Page {page}: no results, stopping")
            break

        count = 0
        for item in items:
            if item.get("source") == "search_topic":
                if upsert_article(conn, {
                    "source_id": item["source_id"],
                    "title": item["title"],
                    "cover_url": item["cover_url"],
                    "detail_url": item["detail_url"],
                    "summary": item["description"],
                    "article_type": "search",
                    "tags": item["tags"],
                }):
                    count += 1
            else:
                if upsert_comic(conn, item):
                    count += 1
        conn.commit()
        total += len(items)
        logger.info(f"Page {page}: {len(items)} results ({count} new)")

    logger.info(f"Total: {total} results saved")
    return total


def cmd_scrape_all(conn, scrape_details=True, incremental=False, pages=1):
    logger.info("=" * 50)
    logger.info("51acgs.com Full Scrape")
    logger.info("=" * 50)

    try:
        cmd_scrape_home(conn)
    except Exception as e:
        logger.warning(f"Home scrape failed: {e}")

    try:
        cmd_scrape_topics(conn, scrape_details=scrape_details, pages=pages)
    except Exception as e:
        logger.warning(f"Topics scrape failed: {e}")

    if scrape_details:
        try:
            cmd_scrape_comic_details(conn, limit=500, incremental=incremental)
        except Exception as e:
            logger.warning(f"Comic details scrape failed: {e}")

    try:
        cmd_scrape_chapters(conn, limit=300)
    except Exception as e:
        logger.warning(f"Chapters scrape failed: {e}")

    try:
        cmd_scrape_pages(conn, limit=300)
    except Exception as e:
        logger.warning(f"Pages scrape failed: {e}")

    stats = get_stats(conn)

    logger.info("")
    logger.info("=" * 50)
    logger.info("Scrape Complete")
    logger.info(f"  Comics:     {stats['comics']} ({stats['comics_detailed']} detailed)")
    logger.info(f"  Articles:   {stats['articles']}")
    logger.info(f"  Details:    {stats['topic_details']}")
    logger.info(f"  Chapters:   {stats['chapters']}")
    logger.info(f"  Pages:      {stats['pages']}")
    logger.info("=" * 50)


def export_json_streaming(conn, query, filepath, label="records"):
    import json
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("[\n")
        rows = conn.execute(query)
        first = True
        count = 0
        for row in rows:
            if not first:
                f.write(",\n")
            json.dump(dict(row), f, ensure_ascii=False)
            first = False
            count += 1
        f.write("\n]")
    logger.info(f"[Export] JSON -> {filepath} ({count} {label})")
    return count


def cmd_export(conn, fmt, output_dir, combined=False):
    logger.info(f"Exporting data as {fmt.upper()}...")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if combined:
        comics_file = os.path.join(output_dir, f"comics_{ts}.json")
        articles_file = os.path.join(output_dir, f"articles_{ts}.json")

        comics_count = export_json_streaming(conn, "SELECT * FROM comics WHERE title IS NOT NULL", comics_file, "comics")
        articles_count = export_json_streaming(conn, "SELECT * FROM articles WHERE title IS NOT NULL", articles_file, "articles")

        import json
        stats = {
            "comics_count": comics_count,
            "articles_count": articles_count,
        }
        stats_file = os.path.join(output_dir, f"stats_{ts}.json")
        with open(stats_file, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)

        latest = os.path.join(output_dir, "latest.json")
        export_json_streaming(conn, "SELECT * FROM comics WHERE title IS NOT NULL", latest, "comics")
    else:
        if fmt == "json":
            export_json_streaming(conn, "SELECT * FROM comics WHERE title IS NOT NULL", os.path.join(output_dir, f"comics_{ts}.json"), "comics")
            export_json_streaming(conn, "SELECT * FROM articles WHERE title IS NOT NULL", os.path.join(output_dir, f"articles_{ts}.json"), "articles")
        else:
            # CSV导出需要先加载到内存
            comics = query_comics(conn, limit=5000)
            articles = query_articles(conn, limit=5000)
            valid_comics = [c for c in comics if c.get("title")]
            valid_articles = [a for a in articles if a.get("title")]
            export_csv(valid_comics, os.path.join(output_dir, f"comics_{ts}.csv"))
            export_csv(valid_articles, os.path.join(output_dir, f"articles_{ts}.csv"))

    logger.info(f"Exported to {output_dir}")


def cmd_list(conn, source, limit):
    if source == "comics":
        items = query_comics(conn, limit=limit)
        logger.info(f"Comics ({len(items)}):")
        for item in items:
            author = item.get("author", "") or ""
            status = item.get("status", "") or ""
            bm = item.get("bookmark_count") or 0
            detail = f" [{author}]" if author else ""
            detail += f" ({status})" if status else ""
            detail += f" bm={bm}" if bm else ""
            logger.info(f"  [{item['source_id']}] {item['title'][:50]}{detail}")
    elif source == "articles":
        items = query_articles(conn, limit=limit)
        logger.info(f"Articles ({len(items)}):")
        for item in items:
            logger.info(f"  [{item['source_id']}] {item['title'][:50]} ({item['article_type']})")
    else:
        stats = get_stats(conn)
        logger.info(f"Database stats: {stats}")


def cmd_stats(conn):
    stats = get_stats(conn)
    total = stats['comics'] or 1
    detailed = stats['comics_detailed']
    pct = detailed * 100 // total
    logger.info("Database Statistics:")
    logger.info(f"  Comics:       {stats['comics']}")
    logger.info(f"  Detailed:     {detailed} ({pct}%)")
    logger.info(f"  Articles:     {stats['articles']}")
    logger.info(f"  Topic Details:{stats['topic_details']}")
    logger.info(f"  Chapters:     {stats['chapters']}")
    logger.info(f"  Pages:        {stats['pages']}")
    logger.info(f"  Downloaded:   {stats['downloaded']}")


async def cmd_scrape_chapters_async(conn, limit=50):
    logger.info("[4/5] Scraping chapter lists (async)...")
    comics = query_comics_without_chapters(conn, limit=limit)
    if not comics:
        logger.info("No comics need chapter lists")
        return 0

    async def process_comic(client, comic, sem):
        html = await fetch_page_async(client, comic["detail_url"], sem)
        if not html:
            return False
        chapters = parse_chapter_list(html, comic["source_id"])
        for ch in chapters:
            upsert_chapter(conn, ch)
        logger.info(f"{comic['title'][:35]}... ({len(chapters)} chapters)")
        return True

    return await _batch_scrape(conn, comics, process_comic, "Chapter lists")


def cmd_scrape_chapters(conn, limit=50):
    return asyncio.run(cmd_scrape_chapters_async(conn, limit))


async def cmd_scrape_pages_async(conn, limit=100):
    logger.info("[5/5] Scraping chapter pages (async)...")
    chapters = query_chapters_needing_pages(conn, limit)

    if not chapters:
        logger.info("No chapters need page scraping")
        return 0

    async def process_chapter(client, ch, sem):
        html = await fetch_page_async(client, ch["chapter_url"], sem)
        if not html:
            return False
        urls = parse_chapter_images(html)
        for i, url in enumerate(urls):
            upsert_page(conn, {
                "chapter_id": ch["chapter_id"],
                "page_number": i + 1,
                "image_url": url,
                "local_path": None,
                "file_size": None,
            })
        set_chapter_page_count(conn, ch["chapter_id"], len(urls))
        title = ch.get("comic_title", "")[:25]
        logger.info(f"{title} {ch['chapter_name']}... ({len(urls)} pages)")
        return True

    return await _batch_scrape(conn, chapters, process_chapter, "Chapter pages")


def cmd_scrape_pages(conn, limit=100):
    return asyncio.run(cmd_scrape_pages_async(conn, limit))


async def cmd_download_images_async(conn, limit=100):
    logger.info("[Download] Downloading images...")
    pages = query_pages_to_download(conn, limit)

    if not pages:
        logger.info("No images to download")
        return 0

    download_dir = os.path.join(DATA_DIR, "images")
    os.makedirs(download_dir, exist_ok=True)

    sem = asyncio.Semaphore(CONCURRENCY)
    count = 0
    total = len(pages)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def process_one(page):
            nonlocal count
            source_id = page["source_id"]
            chapter_id = page["chapter_id"]
            page_num = page["page_number"]
            url = page["image_url"]

            path = urlparse(url).path.lower()
            ext = ".jpeg"
            if path.endswith(".png"):
                ext = ".png"
            elif path.endswith(".webp"):
                ext = ".webp"

            dir_path = os.path.join(download_dir, source_id, chapter_id)
            os.makedirs(dir_path, exist_ok=True)
            filename = f"{page_num:03d}{ext}"
            filepath = os.path.join(dir_path, filename)

            try:
                async with sem:
                    resp = await client.get(url, timeout=30)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            f.write(resp.content)
                        set_page_local_path(conn, chapter_id, page_num, filepath, len(resp.content))
                        count += 1
                        if count % 10 == 0:
                            logger.info(f"[{count}/{total}] downloaded...")
            except Exception as e:
                logger.error(f"[DL] Failed: {chapter_id}/{page_num} - {e}")

        await asyncio.gather(*[process_one(p) for p in pages])

    conn.commit()
    logger.info(f"Downloaded {count}/{total} images to {download_dir}")
    return count


def cmd_download_images(conn, limit=100):
    return asyncio.run(cmd_download_images_async(conn, limit))


def main():
    parser = argparse.ArgumentParser(description="51acgs.com scraper for 代审池")
    sub = parser.add_subparsers(dest="command", help="Available commands")

    p_scrape = sub.add_parser("scrape", help="Scrape data from the site")
    p_scrape.add_argument("--all", action="store_true", help="Scrape everything")
    p_scrape.add_argument("--source", choices=["home", "topics", "comics", "chapters", "pages"], help="Scrape specific source")
    p_scrape.add_argument("--details", action="store_true", help="Also scrape detail pages (default with --all)")
    p_scrape.add_argument("--search", type=str, help="Search keyword")
    p_scrape.add_argument("--incremental", action="store_true", help="Only scrape new items (details)")
    p_scrape.add_argument("--pages", type=int, default=1, help="Number of pages to scrape")

    p_export = sub.add_parser("export", help="Export scraped data")
    p_export.add_argument("--format", choices=["json", "csv"], default="json")
    p_export.add_argument("--output", default=EXPORTS_DIR)
    p_export.add_argument("--combined", action="store_true", help="Export as single combined JSON")

    p_list = sub.add_parser("list", help="List scraped data")
    p_list.add_argument("--source", choices=["comics", "articles", "stats"], default="stats")
    p_list.add_argument("--limit", type=int, default=20)

    p_download = sub.add_parser("download", help="Download chapter images")
    p_download.add_argument("--limit", type=int, default=100, help="Max images to download")

    sub.add_parser("stats", help="Show database statistics")
    sub.add_parser("init", help="Initialize database")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    init_db()
    conn = None

    def cleanup(sig=None, frame=None):
        if conn:
            conn.close()
        close_client()
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    try:
        conn = get_db()

        if args.command == "scrape":
            if args.all:
                cmd_scrape_all(conn, scrape_details=True,
                              incremental=args.incremental, pages=args.pages)
            elif args.source == "home":
                cmd_scrape_home(conn)
            elif args.source == "topics":
                cmd_scrape_topics(conn, scrape_details=args.details, pages=args.pages)
            elif args.source == "comics":
                cmd_scrape_comic_details(conn, incremental=args.incremental)
            elif args.source == "chapters":
                cmd_scrape_chapters(conn)
            elif args.source == "pages":
                cmd_scrape_pages(conn)
            elif args.search:
                cmd_scrape_search(conn, args.search, pages=args.pages)
            else:
                logger.info("Use --all, --source, or --search")
        elif args.command == "download":
            cmd_download_images(conn, limit=args.limit)
        elif args.command == "export":
            cmd_export(conn, args.format, args.output, args.combined)
        elif args.command == "list":
            cmd_list(conn, args.source, args.limit)
        elif args.command == "stats":
            cmd_stats(conn)
        elif args.command == "init":
            logger.info("Database initialized.")
    finally:
        close_client()
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
