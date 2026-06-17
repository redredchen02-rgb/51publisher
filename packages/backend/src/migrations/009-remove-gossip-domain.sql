-- 清理 gossip 选题数据；gossip pipeline 已从代码库移除。
-- 现有 domain CHECK 约束（'acg' | 'gossip'）通过 SQLite 重建表方式收紧为 'acg' only。
-- Step 1: 删除所有 gossip domain 选题
DELETE FROM pending_topics WHERE domain = 'gossip';

-- Step 2: 重建 pending_topics 收紧 CHECK 约束（SQLite 不支持 ALTER COLUMN）
PRAGMA foreign_keys = OFF;

CREATE TABLE pending_topics_new (
  id              TEXT PRIMARY KEY,
  source_url      TEXT NOT NULL UNIQUE,
  site_name       TEXT NOT NULL,
  title           TEXT NOT NULL,
  raw_content     TEXT NOT NULL DEFAULT '{}',
  facts           TEXT NOT NULL DEFAULT '{}',
  confidence      REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'approved', 'rejected')),
  rejected_reason TEXT,
  cover_image_url TEXT,
  score           REAL,
  enrichment      TEXT,
  domain          TEXT NOT NULL DEFAULT 'acg'
                  CHECK(domain IN ('acg')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

INSERT INTO pending_topics_new
  SELECT id, source_url, site_name, title, raw_content, facts, confidence,
         status, rejected_reason, cover_image_url, score, enrichment,
         domain, created_at, updated_at
  FROM pending_topics;

DROP TABLE pending_topics;
ALTER TABLE pending_topics_new RENAME TO pending_topics;

CREATE INDEX IF NOT EXISTS idx_pending_status  ON pending_topics(status);
CREATE INDEX IF NOT EXISTS idx_pending_domain  ON pending_topics(domain);
CREATE INDEX IF NOT EXISTS idx_pending_score   ON pending_topics(score DESC);

PRAGMA foreign_keys = ON;
