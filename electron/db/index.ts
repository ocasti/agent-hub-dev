import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { MIGRATIONS } from './migrations';

let db: Database.Database;

export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'agent-hub.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = db
    .prepare('SELECT version FROM _migrations ORDER BY version')
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map((m) => m.version));

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      })();
      console.log(`Migration ${migration.name} applied`);
    }
  }
}

export function getDatabase(): Database.Database {
  return db;
}
