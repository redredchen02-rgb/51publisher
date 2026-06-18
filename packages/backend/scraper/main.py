#!/usr/bin/env python3
"""51acgs.com scraper CLI — fetch comics and articles for 代审池."""

import argparse
import asyncio
import os

import httpx

from .config import BASE_URL, EXPORTS_DIR, CONCURRENCY, DATA_DIR
from .models import (
    init_db, get_db, upsert_comic, upsert_article, upsert_topic_detail,
    update_comic_detail, query_comics, query_comics_needing_detail,
    query_articles, get_stats, upsert_chapter, upsert_page,
    query_comics_with_chapters, query_chapters_for_download,
)
from .client import fetch_page, fetch_page_async, close_client
from .crawlers.home import parse_home_page
from .crawlers.topics import parse_topic_list, parse_topic_detail
from .crawlers.comics import parse_comic_detail
from .crawlers.search import parse_search_results
from .crawlers.chapters import parse_chapter_list, parse_chapter_images
from .exporters import export_json, export_csv


def cmd_scrape_home(conn):
    print("[1/5] Scraping homepage latest comics...")
    html = fetch_page(BASE_URL)
    if not html:
        print("  Failed to fetch homepage")
        return 0

    items = parse_home_page(html)
    count = 0
    for item in items:
        if upsert_comic(conn, item):
            count += 1
    conn.commit()
    print(f"  Found {len(items)} comics, {count} saved")
    return len(items)


def cmd_scrape_topics(conn, scrape_details=False, pages=1):
    print("[2/5] Scraping topic articles...")
    total = 0

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
            print(f"  Fetching {label} page {page}...")
            html = fetch_page(url)
            if not html:
                break

            items = parse_topic_list(html)
            if not items:
                print(f"    {label} page {page}: no more items, stopping")
                break

            new_count = 0
            for item in items:
                if upsert_article(conn, item):
                    new_count += 1
            conn.commit()
            page_count += len(items)
            print(f"    {label} page {page}: {len(items)} articles ({new_count} new)")

            if scrape_details:
                for item in items:
                    detail_url = item.get("detail_url", "")
                    if not detail_url:
                        continue
                    detail_html = fetch_page(detail_url)
                    if not detail_html:
                        continue
                    detail = parse_topic_detail(detail_html)
                    detail["topic_id"] = item["source_id"]
                    upsert_topic_detail(conn, detail)
                conn.commit()

        total += page_count

    print(f"  Total: {total} articles saved")
    return total


async def cmd_scrape_comic_details_async(conn, limit=500, incremental=False):
    print("[3/5] Scraping comic details (async)...")
    if incremental:
        comics = query_comics_needing_detail(conn, limit=limit)
        print(f"  Incremental mode: {len(comics)} comics need details")
    else:
        comics = query_comics(conn, limit=limit)

    if not comics:
        print("  No comics to scrape")
        return 0

    sem = asyncio.Semaphore(CONCURRENCY)
    count = 0
    total = len(comics)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def process_one(comic):
            nonlocal count
            url = comic.get("detail_url", "")
            if not url:
                return
            html = await fetch_page_async(client, url, sem)
            if not html:
                return
            detail = parse_comic_detail(html)
            update_data = {k: v for k, v in detail.items() if v is not None and v != ""}
            if update_data:
                update_comic_detail(conn, comic["source_id"], update_data)
                count += 1
                title = comic["title"][:35]
                author = detail.get("author", "") or ""
                print(f"  [{count}/{total}] {title}... ({author})")

        await asyncio.gather(*[process_one(c) for c in comics])

    conn.commit()
    print(f"  Updated {count} comic details")
    return count


def cmd_scrape_comic_details(conn, limit=500, incremental=False):
    return asyncio.run(cmd_scrape_comic_details_async(conn, limit, incremental))


def cmd_scrape_search(conn, keyword, pages=1):
    print(f"[4/5] Searching for '{keyword}' ({pages} pages)...")
    total = 0

    for page in range(1, pages + 1):
        url = f"{BASE_URL}/search/result?keyword={keyword}"
        if page > 1:
            url += f"&page={page}"
        html = fetch_page(url)
        if not html:
            break

        items = parse_search_results(html, keyword)
        if not items:
            print(f"  Page {page}: no results, stopping")
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
        print(f"  Page {page}: {len(items)} results ({count} new)")

    print(f"  Total: {total} results saved")
    return total


def cmd_scrape_all(conn, scrape_details=True, incremental=False, pages=1):
    print("=" * 50)
    print("51acgs.com Full Scrape")
    print("=" * 50)

    cmd_scrape_home(conn)
    cmd_scrape_topics(conn, scrape_details=scrape_details, pages=pages)

    if scrape_details:
        cmd_scrape_comic_details(conn, limit=500, incremental=incremental)

    stats = get_stats(conn)

    print()
    print("=" * 50)
    print("Scrape Complete")
    print(f"  Comics:     {stats['comics']} ({stats['comics_detailed']} detailed)")
    print(f"  Articles:   {stats['articles']}")
    print(f"  Details:    {stats['topic_details']}")
    print("=" * 50)


def cmd_export(conn, fmt, output_dir, combined=False):
    print(f"Exporting data as {fmt.upper()}...")
    comics = query_comics(conn, limit=5000)
    articles = query_articles(conn, limit=5000)

    valid_comics = [c for c in comics if c.get("title")]
    valid_articles = [a for a in articles if a.get("title")]
    skipped = len(comics) - len(valid_comics) + len(articles) - len(valid_articles)
    if skipped:
        print(f"  Skipped {skipped} records with empty title")

    ts = __import__("datetime").datetime.now().strftime("%Y%m%d_%H%M%S")

    if combined:
        data = {
            "comics": valid_comics,
            "articles": valid_articles,
            "stats": {
                "comics_count": len(valid_comics),
                "articles_count": len(valid_articles),
                "comics_with_author": sum(1 for c in valid_comics if c.get("author")),
            }
        }
        filepath = os.path.join(output_dir, f"51acgs_all_{ts}.json")
        export_json(data, filepath)
        latest = os.path.join(output_dir, "latest.json")
        export_json(data, latest)
    else:
        if fmt == "json":
            export_json(valid_comics, os.path.join(output_dir, f"comics_{ts}.json"))
            export_json(valid_articles, os.path.join(output_dir, f"articles_{ts}.json"))
        else:
            export_csv(valid_comics, os.path.join(output_dir, f"comics_{ts}.csv"))
            export_csv(valid_articles, os.path.join(output_dir, f"articles_{ts}.csv"))

    print(f"  Exported to {output_dir}")


def cmd_list(conn, source, limit):
    if source == "comics":
        items = query_comics(conn, limit=limit)
        print(f"Comics ({len(items)}):")
        for item in items:
            author = item.get("author", "") or ""
            status = item.get("status", "") or ""
            bm = item.get("bookmark_count") or 0
            detail = f" [{author}]" if author else ""
            detail += f" ({status})" if status else ""
            detail += f" bm={bm}" if bm else ""
            print(f"  [{item['source_id']}] {item['title'][:50]}{detail}")
    elif source == "articles":
        items = query_articles(conn, limit=limit)
        print(f"Articles ({len(items)}):")
        for item in items:
            print(f"  [{item['source_id']}] {item['title'][:50]} ({item['article_type']})")
    else:
        stats = get_stats(conn)
        print(f"Database stats: {stats}")


def cmd_stats(conn):
    stats = get_stats(conn)
    total = stats['comics'] or 1
    detailed = stats['comics_detailed']
    pct = detailed * 100 // total
    print("Database Statistics:")
    print(f"  Comics:       {stats['comics']}")
    print(f"  Detailed:     {detailed} ({pct}%)")
    print(f"  Articles:     {stats['articles']}")
    print(f"  Topic Details:{stats['topic_details']}")
    print(f"  Chapters:     {stats['chapters']}")
    print(f"  Pages:        {stats['pages']}")
    print(f"  Downloaded:   {stats['downloaded']}")


async def cmd_scrape_chapters_async(conn, limit=50):
    print("[6/7] Scraping chapter lists (async)...")
    comics = query_comics_with_chapters(conn, limit=limit)
    if not comics:
        print("  No comics need chapter lists")
        return 0

    sem = asyncio.Semaphore(CONCURRENCY)
    count = 0
    total = len(comics)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def process_one(comic):
            nonlocal count
            html = await fetch_page_async(client, comic["detail_url"], sem)
            if not html:
                return
            chapters = parse_chapter_list(html, comic["source_id"])
            for ch in chapters:
                upsert_chapter(conn, ch)
            count += 1
            print(f"  [{count}/{total}] {comic['title'][:35]}... ({len(chapters)} chapters)")

        await asyncio.gather(*[process_one(c) for c in comics])

    conn.commit()
    print(f"  Scraped {count} comic chapter lists")
    return count


def cmd_scrape_chapters(conn, limit=50):
    return asyncio.run(cmd_scrape_chapters_async(conn, limit))


async def cmd_scrape_pages_async(conn, limit=100):
    print("[7/7] Scraping chapter pages (async)...")
    chapters = conn.execute("""
        SELECT ch.*, c.title as comic_title
        FROM chapters ch
        JOIN comics c ON c.source_id = ch.comic_source_id
        WHERE ch.chapter_id NOT IN (SELECT DISTINCT chapter_id FROM pages)
        ORDER BY ch.scraped_at DESC LIMIT ?
    """, (limit,)).fetchall()
    chapters = [dict(r) for r in chapters]

    if not chapters:
        print("  No chapters need page scraping")
        return 0

    sem = asyncio.Semaphore(CONCURRENCY)
    count = 0
    total = len(chapters)

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def process_one(ch):
            nonlocal count
            html = await fetch_page_async(client, ch["chapter_url"], sem)
            if not html:
                return
            urls = parse_chapter_images(html)
            for i, url in enumerate(urls):
                upsert_page(conn, {
                    "chapter_id": ch["chapter_id"],
                    "page_number": i + 1,
                    "image_url": url,
                    "local_path": None,
                    "file_size": None,
                })
            conn.execute("UPDATE chapters SET page_count=? WHERE chapter_id=?", (len(urls), ch["chapter_id"]))
            count += 1
            title = ch.get("comic_title", "")[:25]
            print(f"  [{count}/{total}] {title} {ch['chapter_name']}... ({len(urls)} pages)")

        await asyncio.gather(*[process_one(ch) for ch in chapters])

    conn.commit()
    print(f"  Scraped {count} chapter pages")
    return count


def cmd_scrape_pages(conn, limit=100):
    return asyncio.run(cmd_scrape_pages_async(conn, limit))


async def cmd_download_images_async(conn, limit=100):
    print("[Download] Downloading images...")
    pages = conn.execute("""
        SELECT p.*, ch.chapter_name, c.title as comic_title, c.source_id
        FROM pages p
        JOIN chapters ch ON ch.chapter_id = p.chapter_id
        JOIN comics c ON c.source_id = ch.comic_source_id
        WHERE p.local_path IS NULL
        ORDER BY p.scraped_at DESC LIMIT ?
    """, (limit,)).fetchall()
    pages = [dict(r) for r in pages]

    if not pages:
        print("  No images to download")
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

            ext = ".jpeg"
            if ".png" in url:
                ext = ".png"
            elif ".webp" in url:
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
                        conn.execute(
                            "UPDATE pages SET local_path=?, file_size=? WHERE chapter_id=? AND page_number=?",
                            (filepath, len(resp.content), chapter_id, page_num)
                        )
                        count += 1
                        if count % 10 == 0:
                            print(f"  [{count}/{total}] downloaded...")
            except Exception as e:
                print(f"  [DL] Failed: {chapter_id}/{page_num} - {e}")

        await asyncio.gather(*[process_one(p) for p in pages])

    conn.commit()
    print(f"  Downloaded {count}/{total} images to {download_dir}")
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
    conn = get_db()

    try:
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
                print("Use --all, --source, or --search")
        elif args.command == "download":
            cmd_download_images(conn, limit=args.limit)
        elif args.command == "export":
            cmd_export(conn, args.format, args.output, args.combined)
        elif args.command == "list":
            cmd_list(conn, args.source, args.limit)
        elif args.command == "stats":
            cmd_stats(conn)
        elif args.command == "init":
            print("Database initialized.")
    finally:
        close_client()
        conn.close()


if __name__ == "__main__":
    main()
