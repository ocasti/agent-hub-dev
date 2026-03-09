import type { IpcMain } from 'electron';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { createQueries } from '../db/queries';

interface TaskInput {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  images?: { url: string }[];
  model?: string;
  status?: string;
  prNumber?: number | null;
  reviewCycle?: number;
  specSuggestions?: string[];
  planSummary?: string | null;
  branchName?: string | null;
  pmWorkItemId?: string | null;
  pmWorkItemUrl?: string | null;
}

function rowToTask(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectName: row.project_name as string,
    projectPath: row.project_path as string,
    title: row.title as string,
    description: row.description as string,
    acceptanceCriteria: JSON.parse((row.acceptance_criteria as string) || '[]'),
    images: JSON.parse((row.images as string) || '[]'),
    model: row.model as string,
    status: row.status as string,
    prNumber: row.pr_number as number | undefined,
    reviewCycle: row.review_cycle as number,
    specSuggestions: JSON.parse((row.spec_suggestions as string) || '[]'),
    planSummary: (row.plan_summary as string) || undefined,
    lastPhase: (row.last_phase as number) ?? -1,
    branchName: row.branch_name as string | undefined,
    criteriaStatus: JSON.parse((row.criteria_status as string) || '[]'),
    pmWorkItemId: (row.pm_work_item_id as string) || undefined,
    pmWorkItemUrl: (row.pm_work_item_url as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function registerTaskHandlers(ipcMain: IpcMain, db: Database.Database) {
  const q = createQueries(db);

  ipcMain.handle('tasks:getAll', (_event, projectId?: string) => {
    const rows = (projectId ? q.getTasksByProject.all(projectId) : q.getAllTasks.all()) as Record<string, unknown>[];
    return rows.map(rowToTask);
  });

  ipcMain.handle('tasks:get', (_event, id: string) => {
    const row = q.getTask.get(id) as Record<string, unknown>;
    if (!row) throw new Error(`Task ${id} not found`);
    return rowToTask(row);
  });

  ipcMain.handle('tasks:create', (_event, task: TaskInput) => {
    const id = task.id || uuidv4();
    q.insertTask.run(
      id,
      task.projectId,
      task.title,
      task.description || '',
      JSON.stringify(task.acceptanceCriteria || []),
      JSON.stringify(task.images || []),
      task.model || 'sonnet',
      task.pmWorkItemId || null,
      task.pmWorkItemUrl || null
    );
    return rowToTask(q.getTask.get(id) as Record<string, unknown>);
  });

  ipcMain.handle('tasks:update', (_event, id: string, updates: TaskInput) => {
    const existing = q.getTask.get(id) as Record<string, unknown>;
    if (!existing) throw new Error(`Task ${id} not found`);

    q.updateTask.run(
      updates.title ?? existing.title,
      updates.description ?? existing.description,
      updates.acceptanceCriteria
        ? JSON.stringify(updates.acceptanceCriteria)
        : (existing.acceptance_criteria as string),
      updates.images ? JSON.stringify(updates.images) : (existing.images as string),
      updates.model ?? existing.model,
      updates.status ?? existing.status,
      updates.prNumber !== undefined ? updates.prNumber : existing.pr_number,
      updates.reviewCycle ?? existing.review_cycle,
      updates.specSuggestions
        ? JSON.stringify(updates.specSuggestions)
        : (existing.spec_suggestions as string),
      updates.planSummary !== undefined ? updates.planSummary : (existing.plan_summary as string | null),
      updates.branchName !== undefined ? updates.branchName : existing.branch_name,
      updates.pmWorkItemId !== undefined ? updates.pmWorkItemId : (existing.pm_work_item_id as string | null),
      updates.pmWorkItemUrl !== undefined ? updates.pmWorkItemUrl : (existing.pm_work_item_url as string | null),
      id
    );

    // Reset criteria_status when task is re-queued
    if (updates.status === 'queued') {
      q.updateCriteriaStatus.run('[]', id);
    }

    return rowToTask(q.getTask.get(id) as Record<string, unknown>);
  });

  ipcMain.handle('tasks:delete', async (_event, id: string) => {
    // Read task data before deleting from DB
    const row = q.getTask.get(id) as Record<string, unknown> | undefined;
    const projectPath = row?.project_path as string | undefined;
    const branchName = row?.branch_name as string | undefined;
    const title = row?.title as string | undefined;

    // Delete from DB first
    db.transaction(() => {
      q.deleteReviewPatternsByTask.run(id);
      q.nullifyKnowledgeByTask.run(id);
      q.deleteAgentRunsByTask.run(id);
      q.nullifyLogsByTask.run(id);
      q.deleteTask.run(id);
    })();

    if (!projectPath) return;

    // ── Delete spec folder if it exists ──
    // Speckit creates folders like specs/001-feature-name/
    // Match by slug suffix derived from the task title
    const specsDir = join(projectPath, 'specs');
    if (title && existsSync(specsDir)) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
      const slugPattern = new RegExp(`^\\d+-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
      try {
        const entries = readdirSync(specsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && slugPattern.test(entry.name)) {
            const specPath = join(specsDir, entry.name);
            rmSync(specPath, { recursive: true, force: true });
          }
        }
      } catch {
        // specs dir read error — ignore
      }
    }

    // ── Delete local git branch if it exists ──
    if (branchName) {
      try {
        // Make sure we're not on the branch we're trying to delete
        const currentBranch = await execFilePromise('git', ['branch', '--show-current'], projectPath);
        if (currentBranch.trim() === branchName) {
          // Switch to default branch first
          for (const fallback of ['main', 'master', 'develop']) {
            try {
              await execFilePromise('git', ['checkout', fallback], projectPath);
              break;
            } catch {
              // try next
            }
          }
        }
        await execFilePromise('git', ['branch', '-D', branchName], projectPath);
      } catch {
        // Branch doesn't exist or can't be deleted — ignore
      }
    }
  });

  // Settings
  ipcMain.handle('settings:getAll', () => {
    const rows = q.getAllSettings.all() as { key: string; value: string }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    let licenseLimits;
    try {
      licenseLimits = JSON.parse((settings.license_limits as string) || '{}');
    } catch {
      licenseLimits = { max_projects: 3, max_concurrent: 1, models: ['sonnet'], max_knowledge: 20, community_plugins: false };
    }

    return {
      maxConcurrent: parseInt(settings.max_concurrent as string) || 3,
      defaultModel: settings.default_model || 'sonnet',
      maxReviewLoops: parseInt(settings.max_review_loops as string) || 5,
      theme: (settings.theme as string) || 'light',
      locale: (settings.locale as string) || 'en',
      threadMaxFiles: parseInt(settings.thread_max_files as string) || 5,
      threadMaxLines: parseInt(settings.thread_max_lines as string) || 150,
      postFixLinesPerComment: parseInt(settings.postfix_lines_per_comment as string) || 50,
      postFixFilesPerComment: parseInt(settings.postfix_files_per_comment as string) || 3,
      testTimeoutMin: parseInt(settings.test_timeout_min as string) || 5,
      testFixRetries: parseInt(settings.test_fix_retries as string) || 3,
      // License
      licenseKey: (settings.license_key as string) || '',
      licenseStatus: (settings.license_status as string) || 'free',
      licensePlan: ((settings.license_plan as string) || 'free') as 'free' | 'registered' | 'premium',
      licenseEmail: (settings.license_email as string) || '',
      licenseUsername: (settings.license_username as string) || '',
      licenseLimits,
      // Updates
      updateAutoCheck: (settings.update_auto_check as string) !== 'false',
      updateLastCheck: (settings.update_last_check as string) || '',
      updateSkippedVersion: (settings.update_skipped_version as string) || '',
    };
  });

  const ALLOWED_SETTINGS_KEYS = new Set([
    'max_concurrent', 'default_model', 'max_review_loops', 'theme', 'locale',
    'thread_max_files', 'thread_max_lines', 'postfix_lines_per_comment',
    'postfix_files_per_comment', 'test_timeout_min', 'test_fix_retries',
    'branchCounter',
    'license_key', 'license_status', 'license_plan', 'license_email', 'license_username',
    'license_cached_at', 'license_limits',
    'update_auto_check', 'update_last_check', 'update_skipped_version',
  ]);

  ipcMain.handle('settings:update', (_event, key: string, value: string) => {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Settings key not allowed: ${key}`);
    }
    q.upsertSetting.run(key, value);
  });

  // Logs
  ipcMain.handle('logs:getAll', (_event, limit?: number, projectName?: string) => {
    const rows = projectName
      ? q.getLogsByProject.all(projectName, limit || 200)
      : q.getAllLogs.all(limit || 200);
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      projectName: row.project_name,
      message: row.message,
      kind: row.kind,
      createdAt: row.created_at,
    }));
  });

  ipcMain.handle('logs:create', (_event, log: Record<string, unknown>) => {
    q.insertLog.run(
      (log.taskId as string) || null,
      (log.projectName as string) || null,
      log.message as string,
      (log.kind as string) || 'step'
    );
  });

  ipcMain.handle('logs:clear', () => {
    q.clearLogs.run();
  });
}

function execFilePromise(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { shell: false, cwd, timeout: 15000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
