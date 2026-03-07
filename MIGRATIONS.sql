-- ══════════════════════════════════════
-- Agent Hub — SQLite Migrations
-- ══════════════════════════════════════

-- ──────────────────────────────────────
-- 001_initial.sql
-- ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  path            TEXT NOT NULL,
  repo            TEXT,
  description     TEXT DEFAULT '',
  optional_skills TEXT DEFAULT '[]',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id),
  title               TEXT NOT NULL,
  description         TEXT DEFAULT '',
  acceptance_criteria TEXT DEFAULT '[]',
  images              TEXT DEFAULT '[]',
  model               TEXT DEFAULT 'sonnet',
  status              TEXT DEFAULT 'queued',
  pr_number           INTEGER,
  review_cycle        INTEGER DEFAULT 0,
  spec_suggestions    TEXT DEFAULT '[]',
  branch_name         TEXT,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  phase         TEXT NOT NULL,
  started_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME,
  result        TEXT,
  output        TEXT,
  error_output  TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT REFERENCES tasks(id),
  project_name  TEXT,
  message       TEXT NOT NULL,
  kind          TEXT DEFAULT 'step',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings VALUES ('max_concurrent', '3');
INSERT OR IGNORE INTO settings VALUES ('default_model', 'sonnet');
INSERT OR IGNORE INTO settings VALUES ('max_review_loops', '5');

-- ──────────────────────────────────────
-- 002_knowledge.sql
-- ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id),
  category      TEXT NOT NULL,
  severity      TEXT DEFAULT 'medium',
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  source_task   TEXT REFERENCES tasks(id),
  source_pr     INTEGER,
  code_example  TEXT,
  anti_pattern  TEXT,
  tags          TEXT DEFAULT '[]',
  times_applied INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────
-- 003_review_patterns.sql
-- ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_patterns (
  id            TEXT PRIMARY KEY,
  knowledge_id  TEXT REFERENCES knowledge_entries(id),
  task_id       TEXT REFERENCES tasks(id),
  reviewer      TEXT,
  issue_found   TEXT NOT NULL,
  fix_applied   TEXT NOT NULL,
  phase         TEXT,
  auto_fixable  BOOLEAN DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
