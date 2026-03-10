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
export async function getDefaultBranch(projectPath: string, extraEnv?: Record<string, string | undefined>): Promise<string> {
  // Try symbolic ref to origin HEAD first
  try {
    const ref = await execFileAsync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], projectPath, 30000, false, extraEnv);
    const branch = ref.trim().replace('origin/', '');
    if (branch) return branch;
  } catch {
    // Not set — fallback
  }
  // Check which common branches exist locally
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', candidate], projectPath, 30000, false, extraEnv);
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
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<void> {
  try {
    const status = await execFileAsync('git', ['status', '--porcelain'], projectPath, 30000, false, extraEnv);
    if (status.trim().length > 0) {
      sendLog(q, getWindow, taskId, projectName, 'Git: uncommitted changes detected. Creating WIP commit...', 'info');
      await execFileAsync('git', ['add', '-A'], projectPath, 30000, false, extraEnv);
      await execFileAsync('git', ['commit', '-m', 'WIP: auto-save before branch switch [agent-hub]'], projectPath, 30000, false, extraEnv);
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
/**
 * Sync the current branch with its remote counterpart (git pull).
 * Used when changes were pushed to the branch outside the app.
 */
export async function syncRemoteBranch(
  projectPath: string,
  branchName: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<{ success: boolean; message: string }> {
  try {
    // Ensure we're on the correct branch
    const currentBranch = (await execFileAsync('git', ['branch', '--show-current'], projectPath, 30000, false, extraEnv)).trim();
    if (currentBranch !== branchName) {
      await execFileAsync('git', ['checkout', branchName], projectPath, 30000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Git: switched to branch ${branchName}`, 'info');
    }

    // Pull from remote
    sendLog(q, getWindow, taskId, projectName, `Git: pulling from origin/${branchName}...`, 'info');
    const output = await execFileAsync('git', ['pull', 'origin', branchName], projectPath, 60000, false, extraEnv);
    const summary = output.trim().split('\n').slice(-2).join(' ');
    sendLog(q, getWindow, taskId, projectName, `Git: sync with remote complete — ${summary}`, 'ok');
    return { success: true, message: summary };
  } catch (err) {
    const msg = (err as Error).message;
    sendLog(q, getWindow, taskId, projectName, `Git: remote sync failed — ${msg}`, 'error');
    return { success: false, message: msg };
  }
}

/**
 * Sync the current branch with the parent (default) branch by merging it in.
 * If conflicts arise, returns them so the agent can resolve them.
 */
export async function syncParentBranch(
  projectPath: string,
  branchName: string,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<{ success: boolean; message: string; hasConflicts: boolean; conflictFiles: string[] }> {
  try {
    // Ensure we're on the feature branch
    const currentBranch = (await execFileAsync('git', ['branch', '--show-current'], projectPath, 30000, false, extraEnv)).trim();
    if (currentBranch !== branchName) {
      await execFileAsync('git', ['checkout', branchName], projectPath, 30000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Git: switched to branch ${branchName}`, 'info');
    }

    // Detect default branch
    const defaultBranch = await getDefaultBranch(projectPath, extraEnv);
    sendLog(q, getWindow, taskId, projectName, `Git: syncing with parent branch ${defaultBranch}...`, 'info');

    // Fetch latest from origin
    try {
      await execFileAsync('git', ['fetch', 'origin', defaultBranch], projectPath, 60000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Git: fetched latest origin/${defaultBranch}`, 'info');
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Git: fetch warning — ${(err as Error).message}. Merging with local state.`, 'info');
    }

    // Attempt merge
    try {
      const mergeOutput = await execFileAsync('git', ['merge', `origin/${defaultBranch}`, '--no-edit'], projectPath, 60000, false, extraEnv);
      const summary = mergeOutput.trim().split('\n').slice(-2).join(' ');
      sendLog(q, getWindow, taskId, projectName, `Git: merge with ${defaultBranch} complete — ${summary}`, 'ok');
      return { success: true, message: summary, hasConflicts: false, conflictFiles: [] };
    } catch (mergeErr) {
      // Check if there are merge conflicts
      const statusOutput = await execFileAsync('git', ['status', '--porcelain'], projectPath, 30000, false, extraEnv);
      const conflictFiles = statusOutput.split('\n')
        .filter((line) => line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD '))
        .map((line) => line.substring(3).trim());

      if (conflictFiles.length > 0) {
        sendLog(q, getWindow, taskId, projectName,
          `Git: merge conflicts detected in ${conflictFiles.length} file(s): ${conflictFiles.join(', ')}`,
          'info'
        );
        return {
          success: false,
          message: `Merge conflicts in ${conflictFiles.length} file(s)`,
          hasConflicts: true,
          conflictFiles,
        };
      }

      // Not a conflict — some other merge error
      const msg = (mergeErr as Error).message;
      sendLog(q, getWindow, taskId, projectName, `Git: merge failed — ${msg}`, 'error');
      // Abort the failed merge
      try { await execFileAsync('git', ['merge', '--abort'], projectPath, 30000, false, extraEnv); } catch { /* ignore */ }
      return { success: false, message: msg, hasConflicts: false, conflictFiles: [] };
    }
  } catch (err) {
    const msg = (err as Error).message;
    sendLog(q, getWindow, taskId, projectName, `Git: parent sync failed — ${msg}`, 'error');
    return { success: false, message: msg, hasConflicts: false, conflictFiles: [] };
  }
}

export async function prepareGitBranch(
  projectPath: string,
  taskTitle: string,
  existingBranch: string | null | undefined,
  taskId: string,
  projectName: string,
  q: Queries,
  getWindow: GetWindow,
  extraEnv?: Record<string, string | undefined>
): Promise<string> {
  // WIP commit any uncommitted changes before branch switch
  await commitWipIfDirty(projectPath, taskId, projectName, q, getWindow, extraEnv);

  // If we already have a branch from a previous run, just switch to it
  if (existingBranch) {
    sendLog(q, getWindow, taskId, projectName, `Git: switching to existing branch ${existingBranch}`, 'info');
    try {
      await execFileAsync('git', ['checkout', existingBranch], projectPath, 30000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Git: on branch ${existingBranch}`, 'ok');
      return existingBranch;
    } catch (err) {
      sendLog(q, getWindow, taskId, projectName, `Git: could not checkout ${existingBranch}: ${(err as Error).message}. Will create new branch.`, 'info');
    }
  }

  // Detect default branch
  const defaultBranch = await getDefaultBranch(projectPath, extraEnv);
  sendLog(q, getWindow, taskId, projectName, `Git: default branch is ${defaultBranch}`, 'info');

  // Checkout default branch
  try {
    await execFileAsync('git', ['checkout', defaultBranch], projectPath, 30000, false, extraEnv);
    sendLog(q, getWindow, taskId, projectName, `Git: checked out ${defaultBranch}`, 'ok');
  } catch (err) {
    sendLog(q, getWindow, taskId, projectName, `Git: checkout ${defaultBranch} warning: ${(err as Error).message}`, 'info');
  }

  // Pull latest
  try {
    await execFileAsync('git', ['pull', 'origin', defaultBranch], projectPath, 60000, false, extraEnv);
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
    await execFileAsync('git', ['checkout', '-b', branchName], projectPath, 30000, false, extraEnv);
    sendLog(q, getWindow, taskId, projectName, `Git: created branch ${branchName}`, 'ok');
  } catch {
    // Branch might already exist — try switching to it
    try {
      await execFileAsync('git', ['checkout', branchName], projectPath, 30000, false, extraEnv);
      sendLog(q, getWindow, taskId, projectName, `Git: branch ${branchName} already exists, switched to it`, 'ok');
    } catch (err2) {
      sendLog(q, getWindow, taskId, projectName, `Git: branch error: ${(err2 as Error).message}. Continuing on current branch.`, 'error');
      const current = await execFileAsync('git', ['branch', '--show-current'], projectPath, 30000, false, extraEnv).catch(() => 'unknown');
      return current.trim() || branchName;
    }
  }

  return branchName;
}
