import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import type { Queries, GetWindow } from './types';
import { execFileAsync } from './claude-cli';
import { sendLog } from './state';
import { slugify, getDefaultBranch } from './git-ops';

// ── Diff types ──────────────────────────────────────────────────────────────────

export interface WorktreeDiffFile {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface WorktreeDiff {
  branchName: string;
  defaultBranch: string;
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  files: WorktreeDiffFile[];
}

// ── Monorepo types ──────────────────────────────────────────────────────────────

export interface MonorepoPackage {
  name: string;
  path: string;  // relative path from project root
  hasPackageJson: boolean;
}

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
    let branch = await execFileAsync('git', ['branch', '--show-current'], worktreePath, 10000, false, extraEnv)
      .then(b => b.trim())
      .catch(() => '');
    // Fallback to the branch stored in the task if git fails (e.g. PATH issues)
    if (!branch && existingBranch && existingBranch !== 'unknown') {
      branch = existingBranch;
    }
    if (!branch) {
      // Cannot determine branch — remove stale worktree and recreate below
      sendLog(q, getWindow, taskId, projectName, 'Worktree: exists but cannot determine branch — will recreate.', 'info');
      try { await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], projectPath, 30000, false, extraEnv); } catch { /* */ }
      try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* */ }
    } else {
      sendLog(q, getWindow, taskId, projectName, `Worktree: reusing existing at ${worktreePath} on branch ${branch}`, 'info');
      return { worktreePath, branchName: branch };
    }
  }

  // Determine branch name
  let branchName: string;

  if (existingBranch) {
    // Worktree for an existing branch
    branchName = existingBranch;

    // Clean up any stale worktree reference from a previous interrupted run
    try {
      await execFileAsync('git', ['worktree', 'prune'], projectPath, 30000, false, extraEnv);
    } catch { /* non-critical */ }

    // Check if the branch already exists locally
    const branchExists = await execFileAsync(
      'git', ['rev-parse', '--verify', existingBranch], projectPath, 10000, false, extraEnv
    ).then(() => true).catch(() => false);

    if (branchExists) {
      // Branch exists — attach worktree to it (no -b)
      await execFileAsync('git', ['worktree', 'add', worktreePath, existingBranch], projectPath, 60000, false, extraEnv);
    } else {
      // Branch doesn't exist locally — create it
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

      // Check if worktree's git reference is broken (gitdir target deleted)
      const dotGit = path.join(worktreePath, '.git');
      let worktreeBroken = false;
      try {
        const content = fs.readFileSync(dotGit, 'utf-8').trim();
        const match = content.match(/^gitdir:\s*(.+)$/);
        if (!match || !fs.existsSync(match[1])) worktreeBroken = true;
      } catch {
        worktreeBroken = true;
      }

      if (!task || !activeStatuses.has(task.status) || worktreeBroken) {
        // Task doesn't exist, is completed/failed/queued, or worktree is broken — clean up
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

// ── Worktree diff viewer ────────────────────────────────────────────────────────

/**
 * Get a summary diff between a worktree branch and the default branch.
 * Returns file-level changes with additions/deletions counts.
 */
export async function getWorktreeDiff(
  projectPath: string,
  branchName: string,
  extraEnv?: Record<string, string | undefined>
): Promise<WorktreeDiff> {
  const defaultBranch = await getDefaultBranch(projectPath, extraEnv);

  // Get numstat diff (additions, deletions, filename)
  const numstat = await execFileAsync(
    'git', ['diff', '--numstat', `${defaultBranch}...${branchName}`],
    projectPath, 30000, false, extraEnv
  ).catch(() => '');

  // Get name-status for add/modify/delete/rename info
  const nameStatus = await execFileAsync(
    'git', ['diff', '--name-status', `${defaultBranch}...${branchName}`],
    projectPath, 30000, false, extraEnv
  ).catch(() => '');

  const statusMap = new Map<string, string>();
  for (const line of nameStatus.trim().split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const statusChar = parts[0]?.[0] || 'M';
    const fileName = parts[parts.length - 1] || '';
    if (fileName) statusMap.set(fileName, statusChar);
  }

  const files: WorktreeDiffFile[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of numstat.trim().split('\n').filter(Boolean)) {
    const [addStr, delStr, ...fileParts] = line.split('\t');
    const file = fileParts.join('\t');
    const additions = parseInt(addStr, 10) || 0;
    const deletions = parseInt(delStr, 10) || 0;
    totalAdditions += additions;
    totalDeletions += deletions;

    const sc = statusMap.get(file) || 'M';
    const status: WorktreeDiffFile['status'] =
      sc === 'A' ? 'added' :
      sc === 'D' ? 'deleted' :
      sc === 'R' ? 'renamed' : 'modified';

    files.push({ file, status, additions, deletions });
  }

  return {
    branchName,
    defaultBranch,
    totalFiles: files.length,
    totalAdditions,
    totalDeletions,
    files: files.sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)),
  };
}

// ── Monorepo detection ──────────────────────────────────────────────────────────

/**
 * Detect if a project is a monorepo by looking at package.json workspaces,
 * pnpm-workspace.yaml, or lerna.json. Returns the list of packages found.
 */
export function detectMonorepoPackages(projectPath: string): MonorepoPackage[] {
  const packages: MonorepoPackage[] = [];

  // Check package.json workspaces
  const pkgJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const workspaces: string[] = Array.isArray(pkgJson.workspaces)
        ? pkgJson.workspaces
        : pkgJson.workspaces?.packages || [];

      for (const pattern of workspaces) {
        const resolved = resolveGlobPattern(projectPath, pattern);
        for (const dir of resolved) {
          const rel = path.relative(projectPath, dir);
          const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
          let name = rel;
          if (hasPkg) {
            try {
              const childPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
              name = childPkg.name || rel;
            } catch { /* use dir name */ }
          }
          packages.push({ name, path: rel, hasPackageJson: hasPkg });
        }
      }
    } catch { /* invalid JSON */ }
  }

  // Check pnpm-workspace.yaml
  if (packages.length === 0) {
    const pnpmWsPath = path.join(projectPath, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWsPath)) {
      try {
        const content = fs.readFileSync(pnpmWsPath, 'utf-8');
        // Simple YAML parsing for packages list
        const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
        if (match) {
          const patterns = match[1].split('\n')
            .map(l => l.replace(/^\s+-\s+['"]?/, '').replace(/['"]?\s*$/, ''))
            .filter(Boolean);
          for (const pattern of patterns) {
            const resolved = resolveGlobPattern(projectPath, pattern);
            for (const dir of resolved) {
              const rel = path.relative(projectPath, dir);
              const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
              let name = rel;
              if (hasPkg) {
                try {
                  const childPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
                  name = childPkg.name || rel;
                } catch { /* use dir name */ }
              }
              packages.push({ name, path: rel, hasPackageJson: hasPkg });
            }
          }
        }
      } catch { /* invalid YAML */ }
    }
  }

  // Check lerna.json
  if (packages.length === 0) {
    const lernaPath = path.join(projectPath, 'lerna.json');
    if (fs.existsSync(lernaPath)) {
      try {
        const lerna = JSON.parse(fs.readFileSync(lernaPath, 'utf-8'));
        const patterns: string[] = lerna.packages || ['packages/*'];
        for (const pattern of patterns) {
          const resolved = resolveGlobPattern(projectPath, pattern);
          for (const dir of resolved) {
            const rel = path.relative(projectPath, dir);
            const hasPkg = fs.existsSync(path.join(dir, 'package.json'));
            let name = rel;
            if (hasPkg) {
              try {
                const childPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
                name = childPkg.name || rel;
              } catch { /* use dir name */ }
            }
            packages.push({ name, path: rel, hasPackageJson: hasPkg });
          }
        }
      } catch { /* invalid JSON */ }
    }
  }

  return packages;
}

/**
 * Resolve a simple glob pattern (e.g., "packages/*") to actual directories.
 * Only supports trailing /* or /** patterns (no complex globs).
 */
function resolveGlobPattern(basePath: string, pattern: string): string[] {
  // Remove trailing /* or /**
  const cleanPattern = pattern.replace(/\/?\*\*?$/, '');
  const dir = path.join(basePath, cleanPattern);

  if (!fs.existsSync(dir)) return [];

  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => path.join(dir, e.name));
  } catch {
    return [];
  }
}
