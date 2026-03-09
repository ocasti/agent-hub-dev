import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import type { Queries, GetWindow } from './types';
import { execFileAsync } from './claude-cli';
import { sendLog } from './state';
import { slugify, getDefaultBranch } from './git-ops';

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
