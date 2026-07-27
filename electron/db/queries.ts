import type Database from 'better-sqlite3';
import { NON_RUNNING_STATUSES } from '../ipc/agent/types';

/**
 * SQL literal list of statuses that don't occupy a concurrency slot.
 * Built from the shared constant so the two counters below can never disagree.
 * Values are compile-time constants, never user input.
 */
const NON_RUNNING_SQL_LIST = NON_RUNNING_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * Columns `patchTask` is allowed to write. Anything not listed here is ignored,
 * so a caller can never reach id/created_at or an arbitrary identifier.
 */
const PATCHABLE_TASK_COLUMNS = [
  'title', 'description', 'acceptance_criteria', 'images', 'model', 'status',
  'pr_number', 'review_cycle', 'spec_suggestions', 'plan_summary', 'branch_name',
  'pm_work_item_id', 'pm_work_item_url', 'last_phase', 'worktree_path',
  'criteria_status', 'plugin_context',
] as const;

export type PatchableTaskColumn = (typeof PATCHABLE_TASK_COLUMNS)[number];
export type TaskPatch = Partial<Record<PatchableTaskColumn, string | number | null>>;

/**
 * Update only the given task columns, bound by name.
 *
 * The positional 14-argument `updateTask` statement requires every caller to
 * re-send the whole row in exact order; three call sites had already drifted
 * (one passed 12 values and threw at runtime). Prefer this for partial updates.
 */
function makeTaskPatcher(db: Database.Database) {
  const allowed = new Set<string>(PATCHABLE_TASK_COLUMNS);
  const cache = new Map<string, Database.Statement>();

  return function patchTask(taskId: string, patch: TaskPatch): void {
    const cols = Object.keys(patch).filter((c) => allowed.has(c));
    if (cols.length === 0) return;

    const key = cols.join(',');
    let stmt = cache.get(key);
    if (!stmt) {
      const setClause = cols.map((c) => `${c}=@${c}`).join(', ');
      stmt = db.prepare(
        `UPDATE tasks SET ${setClause}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`
      );
      cache.set(key, stmt);
    }

    const bind: Record<string, unknown> = { id: taskId };
    for (const c of cols) bind[c] = patch[c as PatchableTaskColumn] ?? null;
    stmt.run(bind);
  };
}

export function createQueries(db: Database.Database) {
  return {
    // Projects
    getAllProjects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
    getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
    insertProject: db.prepare(
      `INSERT INTO projects (id, name, path, repo, description, optional_skills, test_command, code_hosting, code_hosting_config, plugin_pm, plugin_pm_config, ai_agent, ai_agent_phases, default_model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ),
    updateProject: db.prepare(
      `UPDATE projects SET name=?, path=?, repo=?, description=?, optional_skills=?, test_command=?, code_hosting=?, code_hosting_config=?, plugin_pm=?, plugin_pm_config=?, ai_agent=?, ai_agent_phases=?, default_model=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    getTaskIdsByProject: db.prepare('SELECT id FROM tasks WHERE project_id = ?'),
    nullifyKnowledgeByProject: db.prepare('UPDATE knowledge_entries SET project_id = NULL WHERE project_id = ?'),

    // Tasks
    getAllTasks: db.prepare(
      `SELECT t.*, p.name as project_name, p.path as project_path, p.description as project_description
       FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
       ORDER BY t.created_at DESC`
    ),
    getTasksByProject: db.prepare(
      `SELECT t.*, p.name as project_name, p.path as project_path, p.description as project_description
       FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.project_id = ?
       ORDER BY t.created_at DESC`
    ),
    getTask: db.prepare(
      `SELECT t.*, p.name as project_name, p.path as project_path, p.description as project_description
       FROM tasks t LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = ?`
    ),
    insertTask: db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, acceptance_criteria, images, model, status, pm_work_item_id, pm_work_item_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ),
    updateTask: db.prepare(
      `UPDATE tasks SET title=?, description=?, acceptance_criteria=?, images=?, model=?, status=?,
       pr_number=?, review_cycle=?, spec_suggestions=?, plan_summary=?, branch_name=?, pm_work_item_id=?, pm_work_item_url=?,
       updated_at=CURRENT_TIMESTAMP
       WHERE id=?`
    ),
    patchTask: makeTaskPatcher(db),
    updateTaskStatus: db.prepare(
      'UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updateTaskLastPhase: db.prepare(
      'UPDATE tasks SET last_phase=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updateTaskWorktree: db.prepare(
      'UPDATE tasks SET worktree_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updateCriteriaStatus: db.prepare(
      'UPDATE tasks SET criteria_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updatePluginContext: db.prepare(
      'UPDATE tasks SET plugin_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
    deleteAgentRunsByTask: db.prepare('DELETE FROM agent_runs WHERE task_id = ?'),
    nullifyLogsByTask: db.prepare('UPDATE logs SET task_id = NULL WHERE task_id = ?'),
    nullifyKnowledgeByTask: db.prepare('UPDATE knowledge_entries SET source_task = NULL WHERE source_task = ?'),
    deleteReviewPatternsByTask: db.prepare('DELETE FROM review_patterns WHERE task_id = ?'),

    // Agent Runs
    insertAgentRun: db.prepare(
      `INSERT INTO agent_runs (id, task_id, phase, started_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ),
    finishAgentRun: db.prepare(
      `UPDATE agent_runs SET finished_at=CURRENT_TIMESTAMP, result=?, output=?, error_output=? WHERE id=?`
    ),
    getAgentRunsByTask: db.prepare(
      'SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC'
    ),

    // Logs
    getAllLogs: db.prepare(
      'SELECT * FROM logs ORDER BY created_at DESC LIMIT ?'
    ),
    getLogsByProject: db.prepare(
      'SELECT * FROM logs WHERE project_name = ? ORDER BY created_at DESC LIMIT ?'
    ),
    insertLog: db.prepare(
      `INSERT INTO logs (task_id, project_name, message, kind, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ),
    clearLogs: db.prepare('DELETE FROM logs'),

    // Settings
    getAllSettings: db.prepare('SELECT * FROM settings'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    upsertSetting: db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ),

    // Knowledge
    getAllKnowledge: db.prepare(
      'SELECT * FROM knowledge_entries ORDER BY created_at DESC'
    ),
    getKnowledgeById: db.prepare('SELECT * FROM knowledge_entries WHERE id = ?'),
    getKnowledgeByProject: db.prepare(
      'SELECT * FROM knowledge_entries WHERE project_id = ? OR project_id IS NULL ORDER BY severity, created_at DESC'
    ),
    insertKnowledge: db.prepare(
      `INSERT INTO knowledge_entries (id, project_id, category, severity, title, description, source_task, source_pr, code_example, anti_pattern, tags, times_applied, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
    ),
    updateKnowledge: db.prepare(
      `UPDATE knowledge_entries SET category=?, severity=?, title=?, description=?, code_example=?, anti_pattern=?, tags=?, times_applied=? WHERE id=?`
    ),
    deleteKnowledge: db.prepare('DELETE FROM knowledge_entries WHERE id = ?'),
    incrementKnowledgeApplied: db.prepare(
      'UPDATE knowledge_entries SET times_applied = times_applied + 1 WHERE id = ?'
    ),

    // Active task count (for concurrency control).
    // Both counters derive from NON_RUNNING_STATUSES so they can't drift apart —
    // 'push_review' used to be missing here, so a task paused awaiting push approval
    // silently consumed a global concurrency slot.
    getActiveTaskCount: db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE status NOT IN (${NON_RUNNING_SQL_LIST})`
    ),

    // Running task count per project (1 actively executing task per project)
    // Counts only tasks that are RUNNING (not paused states like plan_review, spec_feedback, pr_feedback)
    // Second param excludes a specific task ID (so a task doesn't block itself)
    getRunningTaskCountByProject: db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND id != ? AND status NOT IN (${NON_RUNNING_SQL_LIST})`
    ),

    // Project knowledge (for prompt injection)
    getProjectKnowledge: db.prepare(
      'SELECT * FROM knowledge_entries WHERE project_id = ? OR project_id IS NULL ORDER BY severity'
    ),

    // Review Patterns
    insertReviewPattern: db.prepare(
      `INSERT INTO review_patterns (id, knowledge_id, task_id, reviewer, issue_found, fix_applied, phase, auto_fixable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ),
    getReviewPatternsByKnowledge: db.prepare(
      'SELECT * FROM review_patterns WHERE knowledge_id = ? ORDER BY created_at DESC'
    ),
  };
}
