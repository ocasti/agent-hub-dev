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
