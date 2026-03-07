import type { Queries, GetWindow } from './types';
import { execFileAsync } from './claude-cli';
import { sendLog } from './state';

// ── Git Helpers ─────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * Detect the default branch of the repo (main, master, or develop).
 */
export async function getDefaultBranch(projectPath: string): Promise<string> {
  // Try symbolic ref to origin HEAD first
  try {
    const ref = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], projectPath);
    const branch = ref.trim().replace('origin/', '');
    if (branch) return branch;
  } catch {
    // Not set — fallback
  }
  // Check which common branches exist locally
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', candidate], projectPath);
      return candidate;
    } catch {
      // doesn't exist
    }
  }
  return 'main'; // ultimate fallback
}

/**
 * If there are uncommitted changes, create a WIP commit on the current branch
 * before switching branches. This preserves work-in-progress tied to the branch
 * (safer than stash which can get lost).
 */
export async function commitWipIfDirty(
  projectPath: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow
): Promise<void> {
  try {
    const status = await execFileAsync('git', ['status', '--porcelain'], projectPath);
    if (status.trim().length > 0) {
      sendLog(q, getWindow, taskId, projectName, 'Git: uncommitted changes detected. Creating WIP commit...', 'info');
      await execFileAsync('git', ['add', '-A'], projectPath);
      await execFileAsync('git', ['commit', '-m', 'WIP: auto-save before branch switch [agent-hub]'], projectPath);
      sendLog(q, getWindow, taskId, projectName, 'Git: WIP commit created', 'ok');
    }
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Git: WIP commit warning: ${(err as Error).message}. Continuing...`, 'info');
  }
}

/**
 * Prepare git state before implementation:
 * - If resuming with an existing branch, just checkout to it
 * - Otherwise: checkout default branch, pull, create feature branch
 * Returns the branch name.
 */
export async function prepareGitBranch(
  projectPath: string,
  taskTitle: string,
  existingBranch: string | null | undefined,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow
): Promise<string> {
  // WIP commit any uncommitted changes before branch switch
  await commitWipIfDirty(projectPath, taskId, projectName, q, getWindow);

  // If we already have a branch from a previous run, just switch to it
  if (existingBranch) {
    sendLog(q, getWindow, taskId, projectName, `Git: switching to existing branch ${existingBranch}`, 'info');
    try {
      await execFileAsync('git', ['checkout', existingBranch], projectPath);
      sendLog(q, getWindow, taskId, projectName, `Git: on branch ${existingBranch}`, 'ok');
      return existingBranch;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Git: could not checkout ${existingBranch}: ${(err as Error).message}. Will create new branch.`, 'info');
    }
  }

  // Detect default branch
  const defaultBranch = await getDefaultBranch(projectPath);
  sendLog(q, getWindow, taskId, projectName, `Git: default branch is ${defaultBranch}`, 'info');

  // Checkout default branch
  try {
    await execFileAsync('git', ['checkout', defaultBranch], projectPath);
    sendLog(q, getWindow, taskId, projectName, `Git: checked out ${defaultBranch}`, 'ok');
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Git: checkout ${defaultBranch} warning: ${(err as Error).message}`, 'info');
  }

  // Pull latest
  try {
    await execFileAsync('git', ['pull', 'origin', defaultBranch], projectPath, 60000);
    sendLog(q, getWindow, taskId, projectName, `Git: pulled latest from origin/${defaultBranch}`, 'ok');
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Git: pull warning: ${(err as Error).message}. Continuing with local state.`, 'info');
  }

  // Create feature branch with sequential numbering
  const slug = slugify(taskTitle);
  const row = q.getSetting.get('branchCounter') as { value: string } | undefined;
  const counter = row ? parseInt(row.value, 10) : 0;
  const next = counter + 1;
  q.upsertSetting.run('branchCounter', String(next));
  const seq = String(next).padStart(4, '0');
  const branchName = `feature/${seq}-${slug}`;
  try {
    await execFileAsync('git', ['checkout', '-b', branchName], projectPath);
    sendLog(q, getWindow, taskId, projectName, `Git: created branch ${branchName}`, 'ok');
  } catch {
    // Branch might already exist — try switching to it
    try {
      await execFileAsync('git', ['checkout', branchName], projectPath);
      sendLog(q, getWindow, taskId, projectName, `Git: branch ${branchName} already exists, switched to it`, 'ok');
    } catch (err2) {
      sendLog(q, getWindow, taskId, projectName, `Git: branch error: ${(err2 as Error).message}. Continuing on current branch.`, 'error');
      const current = await execFileAsync('git', ['branch', '--show-current'], projectPath).catch(() => 'unknown');
      return current.trim() || branchName;
    }
  }

  return branchName;
}
