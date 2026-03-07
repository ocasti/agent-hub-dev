import type Database from 'better-sqlite3';

export function createQueries(db: Database.Database) {
  return {
    // Projects
    getAllProjects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
    getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
    insertProject: db.prepare(
      `INSERT INTO projects (id, name, path, repo, description, optional_skills, test_command, code_hosting, plugin_pm, plugin_pm_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ),
    updateProject: db.prepare(
      `UPDATE projects SET name=?, path=?, repo=?, description=?, optional_skills=?, test_command=?, code_hosting=?, plugin_pm=?, plugin_pm_config=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
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
    updateTaskStatus: db.prepare(
      'UPDATE tasks SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updateTaskLastPhase: db.prepare(
      'UPDATE tasks SET last_phase=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
    ),
    updateCriteriaStatus: db.prepare(
      'UPDATE tasks SET criteria_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
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

    // Active task count (for concurrency control)
    getActiveTaskCount: db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE status NOT IN ('queued', 'completed', 'failed', 'pr_feedback', 'spec_feedback', 'plan_review', 'test_fixing')`
    ),

    // Running task count per project (1 actively executing task per project)
    // Counts only tasks that are RUNNING (not paused states like plan_review, spec_feedback, pr_feedback)
    // Second param excludes a specific task ID (so a task doesn't block itself)
    getRunningTaskCountByProject: db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND id != ? AND status NOT IN ('queued', 'completed', 'failed', 'pr_feedback', 'spec_feedback', 'plan_review', 'push_review', 'test_fixing')`
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
