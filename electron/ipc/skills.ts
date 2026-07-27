import type { IpcMain } from 'electron';
import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolve a project path and confirm it is one the user actually registered.
 *
 * The previous implementation compared the resolved path against
 * `path.resolve()` of the input's first three segments, which for `/a/../etc`
 * reduces to `/` — so every absolute path passed. Since these handlers create and
 * overwrite `.claude/settings.json`, that made them an arbitrary-write primitive.
 *
 * Membership in the projects table is the real boundary: the renderer may only
 * touch directories the user added as projects.
 */
export function validateProjectPath(
  projectPath: string,
  knownProjectPaths?: string[]
): string {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('Project path is required');
  }
  if (!path.isAbsolute(projectPath)) {
    throw new Error(`Project path must be absolute: ${projectPath}`);
  }

  const resolved = path.resolve(projectPath);

  // Resolve symlinks when the path exists, so a link into a registered project
  // can't be used to reach outside it.
  let real = resolved;
  try {
    real = fs.realpathSync(resolved);
  } catch { /* path may not exist yet — fall back to the resolved form */ }

  if (knownProjectPaths) {
    const allowed = knownProjectPaths.some((p) => {
      let candidate = path.resolve(p);
      try { candidate = fs.realpathSync(candidate); } catch { /* ignore */ }
      return candidate === real;
    });
    if (!allowed) {
      throw new Error(`Path is not a registered project: ${projectPath}`);
    }
  }

  return real;
}

export function registerSkillsHandlers(ipcMain: IpcMain, db?: Database.Database) {
  // Paths the renderer is allowed to reach, read fresh on each call so a project
  // added or removed mid-session is honoured. Without a db (tests) the check is skipped.
  const knownProjectPaths = (): string[] | undefined => {
    if (!db) return undefined;
    const rows = db.prepare('SELECT path FROM projects').all() as { path: string }[];
    return rows.map((r) => r.path);
  };

  ipcMain.handle('skills:readGlobal', () => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    return readSettingSources(settingsPath);
  });

  ipcMain.handle('skills:writeGlobal', (_event, skills: string[]) => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    writeSettingSources(settingsPath, skills);
  });

  ipcMain.handle('skills:readProject', (_event, projectPath: string) => {
    const safePath = validateProjectPath(projectPath, knownProjectPaths());
    const settingsPath = path.join(safePath, '.claude', 'settings.json');
    return readSettingSources(settingsPath);
  });

  ipcMain.handle(
    'skills:writeProject',
    (_event, projectPath: string, skills: string[]) => {
      const safePath = validateProjectPath(projectPath, knownProjectPaths());
      const settingsPath = path.join(safePath, '.claude', 'settings.json');
      writeSettingSources(settingsPath, skills);
    }
  );
}

export function readSettingSources(filePath: string): string[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);
    return Array.isArray(json.settingSources) ? json.settingSources : [];
  } catch {
    return [];
  }
}

export function writeSettingSources(filePath: string, skills: string[]): void {
  let json: Record<string, unknown> = {};
  const exists = fs.existsSync(filePath);

  if (exists) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      json = JSON.parse(raw);
    } catch (err) {
      // Never fall back to `{}` here. This file also holds the user's permissions,
      // hooks, env and model config; rewriting it from an empty object because of a
      // trailing comma (or a concurrent write by the Claude Code CLI) destroys all of it.
      throw new Error(
        `Cannot update ${filePath}: the file is not valid JSON (${(err as Error).message}). ` +
        'Fix or remove it and try again.'
      );
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      throw new Error(`Cannot update ${filePath}: expected a JSON object.`);
    }
  }

  json.settingSources = skills;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Keep one backup of the last good version before replacing it.
  if (exists) {
    try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch { /* best effort */ }
  }

  // Write to a temp file and rename, so a crash mid-write can't leave a truncated
  // settings.json that breaks the Claude Code CLI itself.
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(json, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
