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
