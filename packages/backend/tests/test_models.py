import scraper.models as models


def _db(tmp_path, monkeypatch):
    """Point models at an isolated temp DB and return a fresh connection."""
    monkeypatch.setattr(models, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(models, "DB_PATH", str(tmp_path / "test.db"))
    models.init_db()
    return models.get_db()


def _comic(**over):
    base = dict(
        source_id="1", title="T", cover_url="", detail_url="https://x/1",
        description="", categories="", tags="", chapter_count=None, source="home",
    )
    base.update(over)
    return base


# --- init_db / schema -------------------------------------------------------

def test_init_db_is_idempotent(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    # Calling again on an already-migrated DB must not raise or reset data.
    models.init_db()
    version = conn.execute("SELECT version FROM schema_version").fetchone()[0]
    assert version == models.SCHEMA_VERSION


# --- upsert_comic -----------------------------------------------------------

def test_upsert_comic_idempotent_and_coalesces_author(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    assert models.upsert_comic(conn, _comic(author="原作者")) is True
    # Second upsert omits author -> COALESCE must keep the existing one.
    assert models.upsert_comic(conn, _comic(title="新标题")) is True
    rows = models.query_comics(conn)
    assert len(rows) == 1
    assert rows[0]["title"] == "新标题"
    assert rows[0]["author"] == "原作者"


# --- update_comic_detail ----------------------------------------------------

def test_update_comic_detail_whitelists_and_skips_empty(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    models.upsert_comic(conn, _comic(author="原作者"))
    models.update_comic_detail(conn, "1", {"author": "改后", "status": "完结", "evil_col": "x"})
    row = models.query_comics(conn)[0]
    assert row["author"] == "改后"
    assert row["status"] == "完结"
    # Empty string is skipped -> author unchanged.
    models.update_comic_detail(conn, "1", {"author": ""})
    assert models.query_comics(conn)[0]["author"] == "改后"


# --- get_stats --------------------------------------------------------------

def test_get_stats_counts(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    models.upsert_comic(conn, _comic(source_id="1", chapter_count=3))  # detailed
    models.upsert_comic(conn, _comic(source_id="2"))                   # not detailed
    models.upsert_article(conn, {
        "source_id": "a1", "title": "A", "cover_url": "", "detail_url": "",
        "summary": "", "article_type": "hub", "tags": "",
    })
    stats = models.get_stats(conn)
    assert stats["comics"] == 2
    assert stats["comics_detailed"] == 1
    assert stats["articles"] == 1
    assert stats["pages"] == 0


# --- A1 sunk functions: chapters/pages data-access --------------------------

def _seed_chapter(conn, comic_id="1", chapter_id="c1"):
    models.upsert_comic(conn, _comic(source_id=comic_id))
    models.upsert_chapter(conn, {
        "comic_source_id": comic_id, "chapter_id": chapter_id,
        "chapter_name": "第1话", "chapter_url": "https://x/chapter/" + chapter_id,
        "page_count": None,
    })


def test_query_chapters_needing_pages_excludes_chapters_with_pages(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    _seed_chapter(conn, chapter_id="c1")
    _seed_chapter(conn, chapter_id="c2")
    # c1 already has a page row -> only c2 should need pages.
    models.upsert_page(conn, {
        "chapter_id": "c1", "page_number": 1, "image_url": "u",
        "local_path": None, "file_size": None,
    })
    need = models.query_chapters_needing_pages(conn, limit=10)
    ids = {c["chapter_id"] for c in need}
    assert ids == {"c2"}
    assert need[0]["comic_title"] == "T"  # join brought the comic title


def test_set_chapter_page_count(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    _seed_chapter(conn, chapter_id="c1")
    models.set_chapter_page_count(conn, "c1", 7)
    row = conn.execute("SELECT page_count FROM chapters WHERE chapter_id='c1'").fetchone()
    assert row["page_count"] == 7


def test_query_pages_to_download_only_undownloaded(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    _seed_chapter(conn, comic_id="1", chapter_id="c1")
    models.upsert_page(conn, {"chapter_id": "c1", "page_number": 1, "image_url": "u1",
                              "local_path": None, "file_size": None})
    models.upsert_page(conn, {"chapter_id": "c1", "page_number": 2, "image_url": "u2",
                              "local_path": "/tmp/p.jpg", "file_size": 10})
    pending = models.query_pages_to_download(conn, limit=10)
    assert len(pending) == 1
    assert pending[0]["page_number"] == 1
    assert pending[0]["source_id"] == "1"        # comic source_id via join
    assert pending[0]["comic_title"] == "T"


def test_set_page_local_path(tmp_path, monkeypatch):
    conn = _db(tmp_path, monkeypatch)
    _seed_chapter(conn, chapter_id="c1")
    models.upsert_page(conn, {"chapter_id": "c1", "page_number": 1, "image_url": "u",
                              "local_path": None, "file_size": None})
    models.set_page_local_path(conn, "c1", 1, "/tmp/p.jpg", 123)
    row = conn.execute(
        "SELECT local_path, file_size FROM pages WHERE chapter_id='c1' AND page_number=1"
    ).fetchone()
    assert row["local_path"] == "/tmp/p.jpg"
    assert row["file_size"] == 123
