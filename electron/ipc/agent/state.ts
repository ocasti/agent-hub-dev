import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';
import type { Queries, GetWindow } from './types';
import { RUNNING_STATUSES } from './types';

// ── Resolver Maps ──────────────────────────────────────────────────────────────

export const activeControllers = new Map<string, AbortController>();
export const specResolvers = new Map<string, (value: { action: 'accept' | 'edit'; editedSpec?: string }) => void>();
export const planResolvers = new Map<string, (value: { action: 'approve' | 'replan' }) => void>();
export const pushResolvers = new Map<string, (value: { action: 'approve' | 'reject' | 'revise'; prompt?: string }) => void>();
export const fixTestsResolvers = new Map<string, (value: void) => void>();

// ── Process Supervisor ─────────────────────────────────────────────────────────

/**
 * Every agent/test subprocess currently running, so the app can terminate them
 * on quit instead of orphaning them.
 *
 * Agents run with permissive tool access; an orphan keeps editing the user's
 * repository after the app is gone.
 */
const liveChildren = new Set<{ kill(signal: NodeJS.Signals): boolean; pid?: number }>();

export function registerChild(child: { kill(signal: NodeJS.Signals): boolean; pid?: number }): void {
  liveChildren.add(child);
}

export function unregisterChild(child: { kill(signal: NodeJS.Signals): boolean; pid?: number }): void {
  liveChildren.delete(child);
}

/**
 * Ask a child to stop, then force it. CLIs that trap SIGTERM (or sit in an
 * uninterruptible tool call) would otherwise ignore the request and leave the
 * phase awaiting a 'close' event that never fires.
 */
export function terminateChild(
  child: { kill(signal: NodeJS.Signals): boolean; pid?: number },
  graceMs: number = 5000
): void {
  try {
    child.kill('SIGTERM');
  } catch { /* already gone */ }

  const forceKill = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch { /* already gone */ }
  }, graceMs);
  // Don't hold the event loop open just to force-kill a process that already exited.
  forceKill.unref?.();
}

/**
 * Requeue tasks whose status says "running" but whose orchestration died with the
 * previous session. `last_phase` is preserved, so the task resumes where it stopped.
 *
 * Returns how many rows were reset.
 */
export function reconcileInFlightTasks(db: Database.Database): number {
  const placeholders = RUNNING_STATUSES.map(() => '?').join(', ');
  const result = db.prepare(
    `UPDATE tasks SET status = 'queued', updated_at = CURRENT_TIMESTAMP
     WHERE status IN (${placeholders})`
  ).run(...RUNNING_STATUSES);
  return result.changes;
}

/** Abort every running workflow and terminate its subprocesses. Called on app quit. */
export function shutdownAllAgents(): void {
  for (const controller of activeControllers.values()) {
    try {
      controller.abort();
    } catch { /* ignore */ }
  }
  activeControllers.clear();

  for (const child of liveChildren) {
    terminateChild(child, 2000);
  }
  liveChildren.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function sendLog(
  q: Queries,
  getWindow: GetWindow,
  taskId: string | null,
  projectName: string,
  message: string,
  kind: string
) {
  const win = getWindow();
  if (win) {
    win.webContents.send('agent:log', { taskId, projectName, message, kind });
  }
  // taskId may be null for operations not tied to a task (e.g. analyzeRepo, refineWithAI).
  // Use null for DB insert to satisfy FK constraint (logs.task_id allows NULL).
  q.insertLog.run(taskId, projectName, message, kind);
}

export function sendPhaseUpdate(
  getWindow: GetWindow,
  update: {
    taskId: string;
    phase: number;
    phaseLabel: string;
    status: string;
    reviewLoop?: number;
    prNumber?: number;
    branchName?: string;
    specSuggestions?: string[];
    planSummary?: string;
    subProgress?: { current: number; total: number; label: string; step?: string };
  }
) {
  const win = getWindow();
  if (win) {
    win.webContents.send('agent:phaseUpdate', update);
  }
}

export function checkAborted(controller: AbortController) {
  if (controller.signal.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
}

export function getSettingValue(q: Queries, key: string, defaultValue: number): number {
  const row = q.getSetting.get(key) as { value: string } | undefined;
  if (row) {
    const parsed = parseInt(row.value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Check if a worktree directory is a valid git worktree.
 * A worktree has a `.git` file (not directory) pointing to the parent repo's
 * `.git/worktrees/<name>` directory. Both must exist for the worktree to work.
 */
function isValidWorktree(worktreePath: string): boolean {
  if (!existsSync(worktreePath)) return false;

  const dotGit = join(worktreePath, '.git');
  if (!existsSync(dotGit)) return false;

  try {
    const content = readFileSync(dotGit, 'utf-8').trim();
    // Worktree .git file contains: "gitdir: /path/to/repo/.git/worktrees/<id>"
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return false;
    return existsSync(match[1]);
  } catch {
    return false;
  }
}

/**
 * Resolve the working directory for a task.
 * If the task has a worktree_path, verify it's a valid git worktree.
 * If the worktree is broken or removed, clear the stale reference and fall back to projectPath.
 */
export function resolveWorkDir(
  task: { worktree_path: string | null; project_path: string; id: string },
  db: Database.Database
): string {
  if (task.worktree_path) {
    if (isValidWorktree(task.worktree_path)) {
      return task.worktree_path;
    }
    // Worktree broken or removed — clear stale reference
    db.prepare('UPDATE tasks SET worktree_path = NULL WHERE id = ?').run(task.id);
    task.worktree_path = null;
  }
  return task.project_path;
}

// ── Resolver Waiters ──────────────────────────────────────────────────────────

export function waitForSpecContinue(
  taskId: string,
  controller: AbortController
): Promise<{ action: 'accept' | 'edit'; editedSpec?: string }> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    specResolvers.set(taskId, resolve);

    const onAbort = () => {
      specResolvers.delete(taskId);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function waitForPlanContinue(
  taskId: string,
  controller: AbortController
): Promise<{ action: 'approve' | 'replan' }> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    planResolvers.set(taskId, resolve);

    const onAbort = () => {
      planResolvers.delete(taskId);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function waitForPushApproval(
  taskId: string,
  controller: AbortController
): Promise<{ action: 'approve' | 'reject' | 'revise'; prompt?: string }> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }
    pushResolvers.set(taskId, resolve);
    const onAbort = () => {
      pushResolvers.delete(taskId);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function waitForFixTests(taskId: string, controller: AbortController): Promise<void> {
  return new Promise((resolve, reject) => {
    if (controller.signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }
    fixTestsResolvers.set(taskId, resolve);
    const onAbort = () => {
      fixTestsResolvers.delete(taskId);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}
