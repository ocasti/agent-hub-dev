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
