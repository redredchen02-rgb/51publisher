import sqlite3
import os
from datetime import datetime, timezone

from .config import DB_PATH, DATA_DIR

SCHEMA_VERSION = 3


def get_db() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchall()
    return len(rows) > 0


def init_db():
    conn = get_db()
    if not _table_exists(conn, 'schema_version'):
        conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        conn.execute("INSERT INTO schema_version (version) VALUES (0)")
        conn.commit()

    current = conn.execute("SELECT version FROM schema_version").fetchone()[0]
    if current >= SCHEMA_VERSION:
        conn.close()
        return

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS comics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            cover_url TEXT,
            detail_url TEXT,
            description TEXT,
            categories TEXT,
            tags TEXT,
            chapter_count INTEGER,
            source TEXT,
            author TEXT,
            publish_date TEXT,
            update_date TEXT,
            status TEXT,
            rating REAL,
            bookmark_count INTEGER,
            view_count INTEGER,
            like_count INTEGER,
            scraped_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            cover_url TEXT,
            detail_url TEXT,
            summary TEXT,
            article_type TEXT,
            tags TEXT,
            scraped_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS topic_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id TEXT UNIQUE NOT NULL,
            content_html TEXT,
            content_text TEXT,
            comic_refs TEXT,
            scraped_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_comics_source ON comics(source);
        CREATE INDEX IF NOT EXISTS idx_comics_source_id ON comics(source_id);
        CREATE INDEX IF NOT EXISTS idx_articles_type ON articles(article_type);
        CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id);

        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comic_source_id TEXT NOT NULL,
            chapter_id TEXT UNIQUE NOT NULL,
            chapter_name TEXT,
            chapter_url TEXT,
            page_count INTEGER,
            scraped_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            image_url TEXT NOT NULL,
            local_path TEXT,
            file_size INTEGER,
            scraped_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chapter_id, page_number)
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_comic ON chapters(comic_source_id);
        CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
    """)

    new_comic_cols = [
        ("author", "TEXT"), ("publish_date", "TEXT"), ("update_date", "TEXT"),
        ("status", "TEXT"), ("rating", "REAL"), ("bookmark_count", "INTEGER"),
        ("view_count", "INTEGER"), ("like_count", "INTEGER"),
    ]
    for col, typ in new_comic_cols:
        if not _column_exists(conn, "comics", col):
            conn.execute(f"ALTER TABLE comics ADD COLUMN {col} {typ}")

    conn.execute("UPDATE schema_version SET version=?", (SCHEMA_VERSION,))
    conn.commit()
    conn.close()


def upsert_comic(conn: sqlite3.Connection, data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    defaults = {
        "author": None, "publish_date": None, "update_date": None,
        "status": None, "rating": None, "bookmark_count": None,
        "view_count": None, "like_count": None,
    }
    full = {**defaults, **data, "scraped_at": now}
    try:
        conn.execute("""
            INSERT INTO comics (source_id, title, cover_url, detail_url, description,
                              categories, tags, chapter_count, source, author,
                              publish_date, update_date, status, rating,
                              bookmark_count, view_count, like_count, scraped_at)
            VALUES (:source_id, :title, :cover_url, :detail_url, :description,
                    :categories, :tags, :chapter_count, :source, :author,
                    :publish_date, :update_date, :status, :rating,
                    :bookmark_count, :view_count, :like_count, :scraped_at)
            ON CONFLICT(source_id) DO UPDATE SET
                title=excluded.title, cover_url=excluded.cover_url,
                detail_url=excluded.detail_url, description=excluded.description,
                categories=excluded.categories, tags=excluded.tags,
                chapter_count=COALESCE(excluded.chapter_count, comics.chapter_count),
                source=excluded.source,
                author=COALESCE(excluded.author, comics.author),
                publish_date=COALESCE(excluded.publish_date, comics.publish_date),
                update_date=COALESCE(excluded.update_date, comics.update_date),
                status=COALESCE(excluded.status, comics.status),
                rating=COALESCE(excluded.rating, comics.rating),
                bookmark_count=COALESCE(excluded.bookmark_count, comics.bookmark_count),
                view_count=COALESCE(excluded.view_count, comics.view_count),
                like_count=COALESCE(excluded.like_count, comics.like_count),
                scraped_at=excluded.scraped_at
        """, full)
        return True
    except Exception as e:
        print(f"  [DB] upsert_comic failed: {e}")
        return False


def upsert_article(conn: sqlite3.Connection, data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute("""
            INSERT INTO articles (source_id, title, cover_url, detail_url, summary,
                                 article_type, tags, scraped_at)
            VALUES (:source_id, :title, :cover_url, :detail_url, :summary,
                    :article_type, :tags, :scraped_at)
            ON CONFLICT(source_id) DO UPDATE SET
                title=excluded.title, cover_url=excluded.cover_url,
                detail_url=excluded.detail_url, summary=excluded.summary,
                article_type=excluded.article_type, tags=excluded.tags,
                scraped_at=excluded.scraped_at
        """, {**data, "scraped_at": now})
        return True
    except Exception as e:
        print(f"  [DB] upsert_article failed: {e}")
        return False


def upsert_topic_detail(conn: sqlite3.Connection, data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute("""
            INSERT INTO topic_details (topic_id, content_html, content_text, comic_refs, scraped_at)
            VALUES (:topic_id, :content_html, :content_text, :comic_refs, :scraped_at)
            ON CONFLICT(topic_id) DO UPDATE SET
                content_html=excluded.content_html, content_text=excluded.content_text,
                comic_refs=excluded.comic_refs, scraped_at=excluded.scraped_at
        """, {**data, "scraped_at": now})
        return True
    except Exception as e:
        print(f"  [DB] upsert_topic_detail failed: {e}")
        return False


_COMIC_DETAIL_COLS = {
    "title", "cover_url", "detail_url", "description", "categories", "tags",
    "chapter_count", "source", "author", "publish_date", "update_date",
    "status", "rating", "bookmark_count", "view_count", "like_count",
}

def update_comic_detail(conn: sqlite3.Connection, source_id: str, data: dict):
    sets = []
    vals = []
    for k, v in data.items():
        if k not in _COMIC_DETAIL_COLS:
            continue
        if v is not None and v != "":
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    vals.append(source_id)
    conn.execute(f"UPDATE comics SET {', '.join(sets)} WHERE source_id=?", vals)


def query_comics(conn: sqlite3.Connection, source: str = None, limit: int = 50) -> list:
    if source:
        rows = conn.execute(
            "SELECT * FROM comics WHERE source=? ORDER BY scraped_at DESC LIMIT ?",
            (source, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM comics ORDER BY scraped_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def query_comics_needing_detail(conn: sqlite3.Connection, limit: int = 500) -> list:
    rows = conn.execute(
        "SELECT * FROM comics WHERE (author IS NULL OR author = '') AND detail_url IS NOT NULL ORDER BY scraped_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def query_articles(conn: sqlite3.Connection, article_type: str = None, limit: int = 50) -> list:
    if article_type:
        rows = conn.execute(
            "SELECT * FROM articles WHERE article_type=? ORDER BY scraped_at DESC LIMIT ?",
            (article_type, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM articles ORDER BY scraped_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats(conn: sqlite3.Connection) -> dict:
    comics_count = conn.execute("SELECT COUNT(*) FROM comics").fetchone()[0]
    detailed_count = conn.execute("SELECT COUNT(*) FROM comics WHERE chapter_count IS NOT NULL").fetchone()[0]
    articles_count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    details_count = conn.execute("SELECT COUNT(*) FROM topic_details").fetchone()[0]
    chapters_count = conn.execute("SELECT COUNT(*) FROM chapters").fetchone()[0]
    pages_count = conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0]
    downloaded_count = conn.execute("SELECT COUNT(*) FROM pages WHERE local_path IS NOT NULL").fetchone()[0]
    return {
        "comics": comics_count,
        "comics_detailed": detailed_count,
        "articles": articles_count,
        "topic_details": details_count,
        "chapters": chapters_count,
        "pages": pages_count,
        "downloaded": downloaded_count,
    }


def upsert_chapter(conn: sqlite3.Connection, data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute("""
            INSERT INTO chapters (comic_source_id, chapter_id, chapter_name, chapter_url, page_count, scraped_at)
            VALUES (:comic_source_id, :chapter_id, :chapter_name, :chapter_url, :page_count, :scraped_at)
            ON CONFLICT(chapter_id) DO UPDATE SET
                chapter_name=excluded.chapter_name, chapter_url=excluded.chapter_url,
                page_count=excluded.page_count, scraped_at=excluded.scraped_at
        """, {**data, "scraped_at": now})
        return True
    except Exception as e:
        print(f"  [DB] upsert_chapter failed: {e}")
        return False


def upsert_page(conn: sqlite3.Connection, data: dict) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute("""
            INSERT INTO pages (chapter_id, page_number, image_url, local_path, file_size, scraped_at)
            VALUES (:chapter_id, :page_number, :image_url, :local_path, :file_size, :scraped_at)
            ON CONFLICT(chapter_id, page_number) DO UPDATE SET
                image_url=excluded.image_url, local_path=excluded.local_path,
                file_size=excluded.file_size, scraped_at=excluded.scraped_at
        """, {**data, "scraped_at": now})
        return True
    except Exception as e:
        print(f"  [DB] upsert_page failed: {e}")
        return False


def query_comics_without_chapters(conn: sqlite3.Connection, limit: int = 50) -> list:
    rows = conn.execute("""
        SELECT c.*, COUNT(ch.id) as existing_chapters
        FROM comics c
        LEFT JOIN chapters ch ON ch.comic_source_id = c.source_id
        WHERE c.detail_url IS NOT NULL
        GROUP BY c.source_id
        HAVING existing_chapters = 0
        ORDER BY c.scraped_at DESC LIMIT ?
    """, (limit,)).fetchall()
    return [dict(r) for r in rows]


def query_chapters_for_download(conn: sqlite3.Connection, limit: int = 100) -> list:
    rows = conn.execute("""
        SELECT ch.*, c.title as comic_title
        FROM chapters ch
        JOIN comics c ON c.source_id = ch.comic_source_id
        WHERE ch.chapter_id NOT IN (SELECT DISTINCT chapter_id FROM pages WHERE local_path IS NOT NULL)
        ORDER BY ch.scraped_at DESC LIMIT ?
    """, (limit,)).fetchall()
    return [dict(r) for r in rows]
