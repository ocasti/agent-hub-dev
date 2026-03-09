import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import type { Queries, GetWindow } from './types';
import { execFileAsync } from './claude-cli';
import { sendLog } from './state';
import { slugify, getDefaultBranch } from './git-ops';

// ── Types ───────────────────────────────────────────────────────────────────────

export interface WorktreeInfo {
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  branchName: string;
  worktreePath: string;
  projectName: string;
  projectId: string;
  diskSizeMB: number;
}

export interface ConflictFile {
  file: string;
  branches: string[];
}

// ── Worktree directory ──────────────────────────────────────────────────────────

function getWorktreeBaseDir(): string {
  return path.join(app.getPath('userData'), 'worktrees');
}

// ── Create worktree ─────────────────────────────────────────────────────────────

/**
 * Create a git worktree for a task. The worktree lives in
 * ~/.config/agent-hub/worktrees/{taskId}/ with its own feature branch.
 *
 * If the task already has an existing branch, the worktree checks it out.
 * Otherwise, it creates a new feature branch from the default branch.
 */
export async function createWorktree(
  projectPath: string,
  taskId: string,
  taskTitle: string,
  existingBranch: string | null | undefined,
  q: Queries,
  getWindow: GetWindow,
  projectName: string,
  extraEnv?: Record<string, string | undefined>
): Promise<{ worktreePath: string; branchName: string }> {
  const baseDir = getWorktreeBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });

  const worktreePath = path.join(baseDir, taskId);

  // If worktree already exists on disk, reuse it
  if (fs.existsSync(worktreePath)) {
    sendLog(q, getWindow, taskId, projectName, `Worktree: reusing existing at ${worktreePath}`, 'info');
    const branch = await execFileAsync('git', ['branch', '--show-current'], worktreePath, 10000, false, extraEnv)
      .then(b => b.trim())
      .catch(() => existingBranch || 'unknown');
    return { worktreePath, branchName: branch };
  }

  // Determine branch name
  let branchName: string;

  if (existingBranch) {
    // Worktree for an existing branch
    branchName = existingBranch;
    try {
      await execFileAsync('git', ['worktree', 'add', worktreePath, existingBranch], projectPath, 60000, false, extraEnv);
    } catch {
      // Branch might not exist locally — create it
      await execFileAsync('git', ['worktree', 'add', '-b', existingBranch, worktreePath], projectPath, 60000, false, extraEnv);
    }
  } else {
    // Fetch latest default branch before branching
    const defaultBranch = await getDefaultBranch(projectPath, extraEnv);
    try {
      await execFileAsync('git', ['fetch', 'origin', defaultBranch], projectPath, 60000, false, extraEnv);
    } catch {
      // Offline — continue with local state
    }

    // Create new feature branch
    const slug = slugify(taskTitle);
    const row = q.getSetting.get('branchCounter') as { value: string } | undefined;
    const counter = row ? parseInt(row.value, 10) : 0;
    const next = counter + 1;
    q.upsertSetting.run('branchCounter', String(next));
    const seq = String(next).padStart(4, '0');
    branchName = `feature/${seq}-${slug}`;

    await execFileAsync(
      'git',
      ['worktree', 'add', '-b', branchName, worktreePath, `origin/${defaultBranch}`],
      projectPath, 60000, false, extraEnv
    ).catch(async () => {
      // Fallback: branch from local default
      await execFileAsync(
        'git',
        ['worktree', 'add', '-b', branchName, worktreePath, defaultBranch],
        projectPath, 60000, false, extraEnv
      );
    });
  }

  sendLog(q, getWindow, taskId, projectName, `Worktree: created at ${worktreePath} on branch ${branchName}`, 'ok');
  return { worktreePath, branchName };
}

// ── Setup dependencies ──────────────────────────────────────────────────────────

/**
 * Install dependencies in the worktree so tests and builds work.
 * Detects package manager from lock files.
 */
export async function setupWorktreeDeps(
  worktreePath: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow
): Promise<void> {
  // Detect package manager
  let cmd: string;
  let args: string[];

  if (fs.existsSync(path.join(worktreePath, 'bun.lockb')) || fs.existsSync(path.join(worktreePath, 'bun.lock'))) {
    cmd = 'bun';
    args = ['install', '--frozen-lockfile'];
  } else if (fs.existsSync(path.join(worktreePath, 'pnpm-lock.yaml'))) {
    cmd = 'pnpm';
    args = ['install', '--frozen-lockfile'];
  } else if (fs.existsSync(path.join(worktreePath, 'yarn.lock'))) {
    cmd = 'yarn';
    args = ['install', '--frozen-lockfile'];
  } else if (fs.existsSync(path.join(worktreePath, 'package.json'))) {
    cmd = 'npm';
    args = ['ci', '--prefer-offline'];
  } else {
    // No JS project or no package.json — skip
    return;
  }

  sendLog(q, getWindow, taskId, projectName, `Worktree: installing dependencies (${cmd})...`, 'info');
  try {
    await execFileAsync(cmd, args, worktreePath, 300000); // 5 min timeout
    sendLog(q, getWindow, taskId, projectName, 'Worktree: dependencies installed', 'ok');
  } catch (err) {
    // Try without frozen lockfile as fallback
    sendLog(q, getWindow, taskId, projectName, `Worktree: frozen install failed, retrying...`, 'info');
    try {
      await execFileAsync(cmd, ['install'], worktreePath, 300000);
      sendLog(q, getWindow, taskId, projectName, 'Worktree: dependencies installed (fallback)', 'ok');
    } catch (err2) {
      sendLog(q, getWindow, taskId, projectName, `Worktree: dependency install warning: ${(err2 as Error).message}`, 'info');
    }
  }
}

// ── Remove worktree ─────────────────────────────────────────────────────────────

/**
 * Remove a worktree. Called when a task completes or fails.
 * Does NOT delete the branch — the branch persists for PR/history.
 */
export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], projectPath, 30000, false, extraEnv);
  } catch {
    // Manual cleanup if git worktree remove fails
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true });
      await execFileAsync('git', ['worktree', 'prune'], projectPath, 10000, false, extraEnv);
    } catch {
      // Best effort
    }
  }
}

// ── Cleanup orphan worktrees ────────────────────────────────────────────────────

/**
 * Clean up worktrees that belong to completed/failed tasks.
 * Called at app startup.
 */
export function cleanOrphanWorktrees(db: Database.Database): void {
  const baseDir = getWorktreeBaseDir();
  if (!fs.existsSync(baseDir)) return;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const activeStatuses = new Set([
    'spec_review', 'spec_feedback', 'planning', 'plan_review',
    'implementing', 'reviewing', 'fixing', 'shipping',
    'pr_feedback', 'pr_fixing', 'push_review', 'test_fixing',
  ]);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskId = entry.name;
    const worktreePath = path.join(baseDir, taskId);

    try {
      const task = db.prepare('SELECT status, project_id FROM tasks WHERE id = ?').get(taskId) as { status: string; project_id: string } | undefined;

      if (!task || !activeStatuses.has(task.status)) {
        // Task doesn't exist or is completed/failed/queued — clean up
        const project = task
          ? db.prepare('SELECT path FROM projects WHERE id = ?').get(task.project_id) as { path: string } | undefined
          : undefined;

        if (project?.path) {
          execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], project.path, 10000)
            .catch(() => {
              fs.rmSync(worktreePath, { recursive: true, force: true });
            });
        } else {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }

        // Clear worktree_path in DB
        if (task) {
          db.prepare('UPDATE tasks SET worktree_path = NULL WHERE id = ?').run(taskId);
        }
      }
    } catch {
      // Best effort — skip this entry
    }
  }
}

// ── List active worktrees ───────────────────────────────────────────────────────

/**
 * List all active worktrees with metadata for the Dashboard.
 */
export function listActiveWorktrees(db: Database.Database): WorktreeInfo[] {
  const rows = db.prepare(`
    SELECT t.id, t.title, t.status, t.branch_name, t.worktree_path,
           p.name AS project_name, p.id AS project_id
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.worktree_path IS NOT NULL
    ORDER BY t.updated_at DESC
  `).all() as {
    id: string; title: string; status: string; branch_name: string;
    worktree_path: string; project_name: string; project_id: string;
  }[];

  return rows.map((r) => ({
    taskId: r.id,
    taskTitle: r.title,
    taskStatus: r.status,
    branchName: r.branch_name || 'unknown',
    worktreePath: r.worktree_path,
    projectName: r.project_name,
    projectId: r.project_id,
    diskSizeMB: getDirSizeMB(r.worktree_path),
  }));
}

function getDirSizeMB(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    // Quick estimate: count files shallowly (node_modules dominates)
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return 0;
    // Use du for accurate size on unix
    const { execFileSync } = require('child_process');
    const output = execFileSync('du', ['-sk', dirPath], { timeout: 5000, encoding: 'utf8' }) as string;
    const kb = parseInt(output.split('\t')[0], 10);
    return Math.round((kb / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

// ── Conflict detection ──────────────────────────────────────────────────────────

/**
 * Detect potential file conflicts between a new task and existing worktrees.
 * Compares changed files in active worktree branches against the default branch.
 * Returns files that are modified in multiple branches.
 */
export async function detectWorktreeConflicts(
  projectPath: string,
  projectId: string,
  db: Database.Database,
  extraEnv?: Record<string, string | undefined>
): Promise<ConflictFile[]> {
  const defaultBranch = await getDefaultBranch(projectPath, extraEnv);

  // Get all active worktree branches for this project
  const rows = db.prepare(`
    SELECT branch_name, title FROM tasks
    WHERE project_id = ? AND worktree_path IS NOT NULL AND branch_name IS NOT NULL
      AND status NOT IN ('completed', 'failed', 'queued')
  `).all(projectId) as { branch_name: string; title: string }[];

  if (rows.length === 0) return [];

  // Get changed files per branch
  const filesByBranch = new Map<string, Set<string>>();

  for (const row of rows) {
    try {
      const diff = await execFileAsync(
        'git', ['diff', '--name-only', `${defaultBranch}...${row.branch_name}`],
        projectPath, 15000, false, extraEnv
      );
      const files = diff.trim().split('\n').filter(Boolean);
      filesByBranch.set(row.branch_name, new Set(files));
    } catch {
      // Branch might not exist yet — skip
    }
  }

  // Find files touched by multiple branches
  const fileOccurrences = new Map<string, string[]>();
  for (const [branch, files] of filesByBranch) {
    for (const file of files) {
      if (!fileOccurrences.has(file)) fileOccurrences.set(file, []);
      fileOccurrences.get(file)!.push(branch);
    }
  }

  const conflicts: ConflictFile[] = [];
  for (const [file, branches] of fileOccurrences) {
    if (branches.length > 1) {
      conflicts.push({ file, branches });
    }
  }

  return conflicts.sort((a, b) => b.branches.length - a.branches.length);
}

// ── Symlink node_modules ────────────────────────────────────────────────────────

/**
 * Instead of full npm install, symlink node_modules from the main project
 * to save disk space. Falls back to regular install if symlink fails
 * (e.g., different OS, cross-device link).
 */
export async function setupWorktreeDepsWithSymlink(
  worktreePath: string,
  projectPath: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow
): Promise<void> {
  const wtNodeModules = path.join(worktreePath, 'node_modules');
  const srcNodeModules = path.join(projectPath, 'node_modules');

  // Only symlink if source exists and destination doesn't
  if (fs.existsSync(srcNodeModules) && !fs.existsSync(wtNodeModules)) {
    try {
      fs.symlinkSync(srcNodeModules, wtNodeModules, 'junction');
      sendLog(q, getWindow, taskId, projectName, 'Worktree: node_modules symlinked from main project (saves disk space)', 'ok');
      return;
    } catch {
      sendLog(q, getWindow, taskId, projectName, 'Worktree: symlink failed, falling back to full install', 'info');
    }
  }

  // Fallback to regular install
  await setupWorktreeDeps(worktreePath, taskId, projectName, q, getWindow);
}

// ── Merge worktree into main ────────────────────────────────────────────────────

/**
 * Merge a worktree branch back into the default branch.
 * Used for manual "merge" action from Dashboard.
 */
export async function mergeWorktreeBranch(
  projectPath: string,
  branchName: string,
  extraEnv?: Record<string, string | undefined>
): Promise<{ success: boolean; message: string }> {
  const defaultBranch = await getDefaultBranch(projectPath, extraEnv);

  try {
    // Save current branch
    const currentBranch = (await execFileAsync(
      'git', ['branch', '--show-current'], projectPath, 10000, false, extraEnv
    )).trim();

    // Checkout default branch
    await execFileAsync('git', ['checkout', defaultBranch], projectPath, 30000, false, extraEnv);

    // Try merge
    try {
      await execFileAsync(
        'git', ['merge', branchName, '--no-edit'],
        projectPath, 60000, false, extraEnv
      );
      return { success: true, message: `Branch ${branchName} merged into ${defaultBranch}` };
    } catch (mergeErr) {
      // Abort failed merge
      await execFileAsync('git', ['merge', '--abort'], projectPath, 10000, false, extraEnv).catch(() => {});
      // Return to original branch
      if (currentBranch && currentBranch !== defaultBranch) {
        await execFileAsync('git', ['checkout', currentBranch], projectPath, 30000, false, extraEnv).catch(() => {});
      }
      return { success: false, message: `Merge conflict: ${(mergeErr as Error).message}` };
    }
  } catch (err) {
    return { success: false, message: `Merge failed: ${(err as Error).message}` };
  }
}
