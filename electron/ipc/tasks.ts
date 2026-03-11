import type { IpcMain } from 'electron';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { createQueries } from '../db/queries';
import { getProjectAdapter, resolveEnvVars } from './agent/adapters/registry';

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
  pluginContext?: Record<string, unknown>;
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
    worktreePath: (row.worktree_path as string) || undefined,
    pluginContext: JSON.parse((row.plugin_context as string) || '{}'),
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
    // Save plugin_context if provided (e.g., PM subtasks from TaskForm)
    if (task.pluginContext) {
      q.updatePluginContext.run(JSON.stringify(task.pluginContext), id);
    }
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

    // Save plugin_context if provided (e.g., PM subtasks from TaskForm)
    if (updates.pluginContext) {
      // Merge with existing plugin_context instead of overwriting
      const existingPc = JSON.parse((existing.plugin_context as string) || '{}');
      const merged = { ...existingPc, ...updates.pluginContext };
      q.updatePluginContext.run(JSON.stringify(merged), id);
    }

    // Reset criteria_status when task is re-queued
    if (updates.status === 'queued') {
      q.updateCriteriaStatus.run('[]', id);

      // Close existing PR if task had one (re-queue = full re-execution)
      const prNumber = existing.pr_number as number | null;
      const projectPath = existing.project_path as string | undefined;
      const projectId = existing.project_id as string | undefined;
      if (prNumber && projectPath && projectId) {
        const taskTitle = (updates.title ?? existing.title) as string;
        const comment = `Closed by Agent Hub: task "${taskTitle}" was re-queued for re-execution. A new PR will be created.`;
        const prAdapter = getProjectAdapter(projectId, db);
        const prEnv = resolveEnvVars(projectId, db) || {};
        if (prAdapter) {
          prAdapter.closePR({ projectPath, prNumber, comment }, prEnv).catch((err) => {
            console.warn(`[tasks] Failed to close PR #${prNumber}:`, err.message);
          }).then(() => {
            console.log(`[tasks] Closed PR #${prNumber} via ${prAdapter.name} (task re-queued)`);
          });
        }
        // Clear PR number so the agent creates a fresh one
        q.updateTask.run(
          updates.title ?? existing.title,
          updates.description ?? existing.description,
          updates.acceptanceCriteria ? JSON.stringify(updates.acceptanceCriteria) : (existing.acceptance_criteria as string),
          updates.images ? JSON.stringify(updates.images) : (existing.images as string),
          updates.model ?? existing.model,
          'queued',
          null, // pr_number cleared
          0,    // review_cycle reset
          updates.specSuggestions ? JSON.stringify(updates.specSuggestions) : (existing.spec_suggestions as string),
          null, // plan_summary cleared
          existing.branch_name, // keep branch for reuse
          updates.pmWorkItemId !== undefined ? updates.pmWorkItemId : (existing.pm_work_item_id as string | null),
          updates.pmWorkItemUrl !== undefined ? updates.pmWorkItemUrl : (existing.pm_work_item_url as string | null),
          id
        );
      }
    }

    return rowToTask(q.getTask.get(id) as Record<string, unknown>);
  });

  ipcMain.handle('tasks:delete', async (_event, id: string) => {
    // Read task data before deleting from DB
    const row = q.getTask.get(id) as Record<string, unknown> | undefined;
    const projectPath = row?.project_path as string | undefined;
    const branchName = row?.branch_name as string | undefined;
    const worktreePath = row?.worktree_path as string | undefined;
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

    // ── Remove worktree if it exists ──
    if (worktreePath && existsSync(worktreePath)) {
      try {
        await execFilePromise('git', ['worktree', 'remove', '--force', worktreePath], projectPath);
      } catch {
        // Fallback: remove directory manually
        try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* */ }
      }
      // Clean up stale worktree refs
      try { await execFilePromise('git', ['worktree', 'prune'], projectPath); } catch { /* */ }
    }

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

  // Subtask completion (toggle via PM plugin MCP)
  ipcMain.handle('tasks:completeSubtask', async (_event, taskId: string, pluginId: string, subtaskId: string, completed: boolean) => {
    const row = q.getTask.get(taskId) as Record<string, unknown>;
    if (!row) throw new Error(`Task ${taskId} not found`);

    const pc = JSON.parse((row.plugin_context as string) || '{}');
    const pluginData = pc[pluginId];
    if (!pluginData?.subtasks) throw new Error('No subtasks found for this plugin');

    const subtask = (pluginData.subtasks as { id: string; description: string; completed: boolean }[])
      .find((s) => s.id === subtaskId);
    if (!subtask) throw new Error(`Subtask ${subtaskId} not found`);

    subtask.completed = completed;
    q.updatePluginContext.run(JSON.stringify(pc), taskId);

    // Call PM tool via MCP to sync the completion status
    try {
      const { executeOperation, getActivePluginsForProject } = await import('../ipc/plugins/engine');
      const projectId = row.project_id as string;
      const plugins = getActivePluginsForProject(projectId, db);
      const plugin = plugins.find((p) => p.id === pluginId);
      if (plugin) {
        const raw = plugin.workflow as unknown as Record<string, unknown>;
        const operations = (raw?.operations as Record<string, { tool: string; server: string; args: Record<string, string> }>) || {};
        const op = completed ? operations.completeSubtask : operations.uncompleteSubtask;
        if (op) {
          await executeOperation(op, { subtaskId, taskId }).catch((err: Error) => {
            console.warn(`[tasks] MCP ${completed ? 'complete' : 'uncomplete'}Subtask failed:`, err.message);
          });
        }
      }
    } catch (err) {
      console.warn(`[tasks] PM sync failed:`, (err as Error).message);
    }

    return rowToTask(q.getTask.get(taskId) as Record<string, unknown>);
  });

  // Criterion completion (toggle via PM plugin MCP)
  ipcMain.handle('tasks:completeCriterion', async (_event, taskId: string, pluginId: string, criterionId: string, completed: boolean) => {
    const row = q.getTask.get(taskId) as Record<string, unknown>;
    if (!row) throw new Error(`Task ${taskId} not found`);

    const pc = JSON.parse((row.plugin_context as string) || '{}');
    const pluginData = pc[pluginId];
    if (!pluginData?.criteria) throw new Error('No criteria found for this plugin');

    const criterion = (pluginData.criteria as { id: string; description: string; completed: boolean }[])
      .find((c) => c.id === criterionId);
    if (!criterion) throw new Error(`Criterion ${criterionId} not found`);

    criterion.completed = completed;
    q.updatePluginContext.run(JSON.stringify(pc), taskId);

    // Call PM tool via MCP to sync the completion status
    try {
      const { executeOperation, getActivePluginsForProject } = await import('../ipc/plugins/engine');
      const projectId = row.project_id as string;
      const plugins = getActivePluginsForProject(projectId, db);
      const plugin = plugins.find((p) => p.id === pluginId);
      if (plugin) {
        const raw = plugin.workflow as unknown as Record<string, unknown>;
        const operations = (raw?.operations as Record<string, { tool: string; server: string; args: Record<string, string> }>) || {};
        const op = completed ? operations.completeCriterion : operations.uncompleteCriterion;
        if (op) {
          await executeOperation(op, { criterionId, taskId }).catch((err: Error) => {
            console.warn(`[tasks] MCP ${completed ? 'complete' : 'uncomplete'}Criterion failed:`, err.message);
          });
        }
      }
    } catch (err) {
      console.warn(`[tasks] PM sync failed:`, (err as Error).message);
    }

    return rowToTask(q.getTask.get(taskId) as Record<string, unknown>);
  });

  // Refresh subtasks from PM tool
  ipcMain.handle('tasks:refreshSubtasks', async (_event, taskId: string) => {
    const row = q.getTask.get(taskId) as Record<string, unknown>;
    if (!row) throw new Error(`Task ${taskId} not found`);

    const pmWorkItemId = row.pm_work_item_id as string | null;
    if (!pmWorkItemId) throw new Error('Task has no PM work item');

    const projectId = row.project_id as string;
    const project = db.prepare('SELECT plugin_pm FROM projects WHERE id = ?').get(projectId) as { plugin_pm: string | null } | undefined;
    const pluginId = project?.plugin_pm;
    if (!pluginId) throw new Error('Project has no PM plugin');

    // Load plugin and call fetch operation
    const { loadAllPlugins } = await import('../ipc/plugins/loader');
    const { getMcpServerConfig, callMcpHttpTool } = await import('../ipc/plugins/mcp-client');
    const allPlugins = loadAllPlugins();
    const plugin = allPlugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    const raw = plugin.workflow as unknown as Record<string, unknown>;
    const operations = (raw?.operations as Record<string, { tool: string; server: string; args: Record<string, string>; fieldMap?: Record<string, string> }>) || {};
    const fetchOp = operations.fetch;
    if (!fetchOp) throw new Error('Plugin has no fetch operation');

    // Execute MCP call
    const resolvedArgs: Record<string, string> = {};
    for (const [k, v] of Object.entries(fetchOp.args)) {
      resolvedArgs[k] = v.replace(/\{(\w+)\}/g, (_, key) => {
        if (key === 'pmWorkItemId') return pmWorkItemId;
        return plugin.config?.[key] || '';
      });
    }
    const config = getMcpServerConfig(fetchOp.server);
    const result = await callMcpHttpTool(config, fetchOp.tool, resolvedArgs);

    // Apply fieldMap to extract subtasks/subtaskIds and criteria/criteriaIds + completion status
    let descs: string[] = [];
    let ids: string[] = [];
    let stCompleted: unknown[] = [];
    let cDescs: string[] = [];
    let cIds: string[] = [];
    let crCompleted: unknown[] = [];
    if (fetchOp.fieldMap) {
      const { extractFieldByPath } = await import('../ipc/plugins/index');
      const mapped: Record<string, unknown> = {};
      for (const [field, path] of Object.entries(fetchOp.fieldMap)) {
        mapped[field] = extractFieldByPath(result, path);
      }
      if (Array.isArray(mapped.subtasks)) descs = mapped.subtasks as string[];
      if (Array.isArray(mapped.subtaskIds)) ids = mapped.subtaskIds as string[];
      if (Array.isArray(mapped.subtasksCompleted)) stCompleted = mapped.subtasksCompleted as unknown[];
      if (Array.isArray(mapped.criteria)) cDescs = mapped.criteria as string[];
      if (Array.isArray(mapped.criteriaIds)) cIds = mapped.criteriaIds as string[];
      if (Array.isArray(mapped.criteriaCompleted)) crCompleted = mapped.criteriaCompleted as unknown[];
    }

    // Merge with existing plugin_context
    // Remote completion status takes priority; fallback to local state
    const pc = JSON.parse((row.plugin_context as string) || '{}');
    if (!pc[pluginId]) pc[pluginId] = {};

    // Subtasks
    const existingSt = (pc[pluginId].subtasks || []) as { id: string; description: string; completed: boolean }[];
    const stMap = new Map(existingSt.map((s) => [s.id, s.completed]));
    pc[pluginId].subtasks = descs.map((desc, i) => ({
      id: String(ids[i] ?? ''),
      description: String(desc),
      completed: stCompleted.length > 0 ? !!stCompleted[i] : (stMap.get(String(ids[i] ?? '')) ?? false),
    }));

    // Criteria
    const existingCr = (pc[pluginId].criteria || []) as { id: string; description: string; completed: boolean }[];
    const crMap = new Map(existingCr.map((c) => [c.id, c.completed]));
    pc[pluginId].criteria = cDescs.map((desc, i) => ({
      id: String(cIds[i] ?? ''),
      description: String(desc),
      completed: crCompleted.length > 0 ? !!crCompleted[i] : (crMap.get(String(cIds[i] ?? '')) ?? false),
    }));

    q.updatePluginContext.run(JSON.stringify(pc), taskId);
    return rowToTask(q.getTask.get(taskId) as Record<string, unknown>);
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
      defaultAiAgent: (settings.default_ai_agent as string) || 'claude',
      maxReviewLoops: parseInt(settings.max_review_loops as string) || 5,
      theme: (settings.theme as string) || 'light',
      locale: (settings.locale as string) || 'en',
      threadMaxFiles: parseInt(settings.thread_max_files as string) || 5,
      threadMaxLines: parseInt(settings.thread_max_lines as string) || 150,
      postFixLinesPerComment: parseInt(settings.postfix_lines_per_comment as string) || 50,
      postFixFilesPerComment: parseInt(settings.postfix_files_per_comment as string) || 3,
      testTimeoutMin: parseInt(settings.test_timeout_min as string) || 5,
      testFixRetries: parseInt(settings.test_fix_retries as string) || 3,
      maxParallelPerProject: parseInt(settings.max_parallel_per_project as string) || 3,
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
      // Task filters
      tasksFilterProjects: (() => { try { return JSON.parse((settings.tasks_filter_projects as string) || '[]'); } catch { return []; } })(),
      tasksFilterStatuses: (() => { try { return JSON.parse((settings.tasks_filter_statuses as string) || '[]'); } catch { return []; } })(),
    };
  });

  const ALLOWED_SETTINGS_KEYS = new Set([
    'max_concurrent', 'max_parallel_per_project', 'default_model', 'max_review_loops', 'theme', 'locale',
    'default_ai_agent',
    'thread_max_files', 'thread_max_lines', 'postfix_lines_per_comment',
    'postfix_files_per_comment', 'test_timeout_min', 'test_fix_retries',
    'branchCounter',
    'license_key', 'license_status', 'license_plan', 'license_email', 'license_username',
    'license_cached_at', 'license_limits',
    'update_auto_check', 'update_last_check', 'update_skipped_version',
    'tasks_filter_projects', 'tasks_filter_statuses',
  ]);

  ipcMain.handle('settings:update', (_event, key: string, value: string) => {
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      throw new Error(`Settings key not allowed: ${key}`);
    }
    q.upsertSetting.run(key, value);

    // Free tier: changing global agent updates ALL projects
    if (key === 'default_ai_agent') {
      const tier = (q.getSetting.get('license_plan') as { value: string } | undefined)?.value || 'free';
      if (tier === 'free') {
        db.prepare('UPDATE projects SET ai_agent = ?').run(value);
      }
    }
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
