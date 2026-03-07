import type { IpcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Validate that a project path is an absolute path and does not escape
 * its own directory via traversal sequences.  Returns the normalised
 * absolute path or throws.
 */
export function validateProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  // Must be absolute and must not have changed after resolve (catches ../)
  if (!path.isAbsolute(projectPath)) {
    throw new Error(`Project path must be absolute: ${projectPath}`);
  }
  // After resolving, the path must still start with the original root
  // (prevents /safe/../../etc/passwd style attacks)
  if (!resolved.startsWith(path.resolve(projectPath.split(path.sep).slice(0, 3).join(path.sep)))) {
    throw new Error(`Invalid project path (traversal detected): ${projectPath}`);
  }
  return resolved;
}

export function registerSkillsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('skills:readGlobal', () => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    return readSettingSources(settingsPath);
  });

  ipcMain.handle('skills:writeGlobal', (_event, skills: string[]) => {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    writeSettingSources(settingsPath, skills);
  });

  ipcMain.handle('skills:readProject', (_event, projectPath: string) => {
    const safePath = validateProjectPath(projectPath);
    const settingsPath = path.join(safePath, '.claude', 'settings.json');
    return readSettingSources(settingsPath);
  });

  ipcMain.handle(
    'skills:writeProject',
    (_event, projectPath: string, skills: string[]) => {
      const safePath = validateProjectPath(projectPath);
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

  try {
    if (fs.existsSync(filePath)) {
      json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    json = {};
  }

  json.settingSources = skills;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
}
