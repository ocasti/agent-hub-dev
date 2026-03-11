export const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial',
    sql: `
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
    `,
  },
  {
    version: 2,
    name: '002_knowledge',
    sql: `
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
    `,
  },
  {
    version: 3,
    name: '003_review_patterns',
    sql: `
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
    `,
  },
  {
    version: 4,
    name: '004_theme_setting',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'light');
    `,
  },
  {
    version: 5,
    name: '005_plan_summary',
    sql: `
      ALTER TABLE tasks ADD COLUMN plan_summary TEXT;
    `,
  },
  {
    version: 6,
    name: '006_last_phase',
    sql: `
      ALTER TABLE tasks ADD COLUMN last_phase INTEGER DEFAULT -1;
    `,
  },
  {
    version: 7,
    name: '007_locale_setting',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('locale', 'en');
    `,
  },
  {
    version: 8,
    name: '008_criteria_status',
    sql: `
      ALTER TABLE tasks ADD COLUMN criteria_status TEXT DEFAULT '[]';
    `,
  },
  {
    version: 9,
    name: '009_test_command',
    sql: `
      ALTER TABLE projects ADD COLUMN test_command TEXT DEFAULT '';
      INSERT OR IGNORE INTO settings (key, value) VALUES ('test_fix_retries', '3');
    `,
  },
  {
    version: 10,
    name: '010_plugins',
    sql: `
      ALTER TABLE projects ADD COLUMN code_hosting TEXT DEFAULT NULL;
      ALTER TABLE projects ADD COLUMN plugin_pm TEXT DEFAULT NULL;
      ALTER TABLE projects ADD COLUMN plugin_pm_config TEXT DEFAULT '{}';
      ALTER TABLE tasks ADD COLUMN pm_work_item_id TEXT DEFAULT NULL;
      ALTER TABLE tasks ADD COLUMN pm_work_item_url TEXT DEFAULT NULL;
    `,
  },
  {
    version: 11,
    name: '011_license_and_updates',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_key', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_status', 'free');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_plan', 'free');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_email', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_cached_at', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_limits', '{"max_projects":2,"max_concurrent":1,"can_configure_agents":false,"max_review_loops":2,"can_configure_review_loops":false,"models":["sonnet"],"max_knowledge":20,"community_plugins":false,"max_parallel_per_project":1}');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('update_auto_check', 'true');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('update_last_check', '');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('update_skipped_version', '');
    `,
  },
  {
    version: 12,
    name: '012_code_hosting_config',
    sql: `
      ALTER TABLE projects ADD COLUMN code_hosting_config TEXT DEFAULT '{}';
    `,
  },
  {
    version: 13,
    name: '013_auth_username',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('license_username', '');
    `,
  },
  {
    version: 14,
    name: '014_notifications',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('notifications_config', '{"enabled":true,"keys":{"spec_needs_input":true,"plan_ready":true,"quality_pass":true,"quality_fail":true,"pr_created":true,"pr_changes_requested":true,"push_review":true,"task_complete":true,"pr_fix_pushed":true,"workflow_failed":true,"workflow_aborted":true,"regression_detected":true,"max_review_loops":true,"tests_failing":true}}');
    `,
  },
  {
    version: 15,
    name: '015_worktree',
    sql: `
      ALTER TABLE tasks ADD COLUMN worktree_path TEXT DEFAULT NULL;
    `,
  },
  {
    version: 16,
    name: '016_multi_agent',
    sql: `
      ALTER TABLE projects ADD COLUMN ai_agent TEXT DEFAULT 'claude';
      ALTER TABLE projects ADD COLUMN ai_agent_phases TEXT DEFAULT '{}';
      INSERT OR IGNORE INTO settings (key, value) VALUES ('default_ai_agent', 'claude');
    `,
  },
  {
    version: 17,
    name: '017_plugin_context',
    sql: `
      ALTER TABLE tasks ADD COLUMN plugin_context TEXT DEFAULT '{}';
    `,
  },
  {
    version: 18,
    name: '018_task_filters',
    sql: `
      INSERT OR IGNORE INTO settings (key, value) VALUES ('tasks_filter_projects', '[]');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('tasks_filter_statuses', '[]');
    `,
  },
];
