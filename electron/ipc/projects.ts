import type { IpcMain } from 'electron';
import type Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createQueries } from '../db/queries';
import { readSettingSources, writeSettingSources } from './skills';
import { canCreateProject } from './license';

interface ProjectInput {
  id?: string;
  name: string;
  path: string;
  repo?: string;
  description?: string;
  optionalSkills?: string[];
  testCommand?: string;
  codeHosting?: string | null;
  codeHostingConfig?: Record<string, string>;
  pluginPm?: string | null;
  pluginPmConfig?: Record<string, string>;
  aiAgent?: string;
  aiAgentPhases?: Record<string, { primary: string; fallback?: string }>;
}

function rowToProject(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    repo: row.repo as string | undefined,
    description: row.description as string,
    optionalSkills: JSON.parse((row.optional_skills as string) || '[]'),
    testCommand: (row.test_command as string) || '',
    codeHosting: (row.code_hosting as string) || undefined,
    codeHostingConfig: JSON.parse((row.code_hosting_config as string) || '{}'),
    pluginPm: (row.plugin_pm as string) || undefined,
    pluginPmConfig: JSON.parse((row.plugin_pm_config as string) || '{}'),
    aiAgent: (row.ai_agent as string) || 'claude',
    aiAgentPhases: JSON.parse((row.ai_agent_phases as string) || '{}'),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function registerProjectHandlers(ipcMain: IpcMain, db: Database.Database) {
  const q = createQueries(db);

  ipcMain.handle('projects:getAll', () => {
    const rows = q.getAllProjects.all() as Record<string, unknown>[];
    return rows.map(rowToProject);
  });

  ipcMain.handle('projects:create', (_event, project: ProjectInput) => {
    if (!canCreateProject(db)) throw new Error('PROJECT_LIMIT_REACHED');
    const id = project.id || uuidv4();
    const skills = project.optionalSkills || [];

    // Read existing project settings.json to merge with selected skills
    const settingsPath = path.join(project.path, '.claude', 'settings.json');
    const existingSkills = readSettingSources(settingsPath);
    const mergedSkills = [...new Set([...existingSkills, ...skills])];

    q.insertProject.run(
      id,
      project.name,
      project.path,
      project.repo || null,
      project.description || '',
      JSON.stringify(mergedSkills),
      project.testCommand || '',
      project.codeHosting || null,
      JSON.stringify(project.codeHostingConfig || {}),
      project.pluginPm || null,
      JSON.stringify(project.pluginPmConfig || {}),
      project.aiAgent || 'claude',
      JSON.stringify(project.aiAgentPhases || {})
    );

    // Sync skills to project's .claude/settings.json
    writeSettingSources(settingsPath, mergedSkills);

    return rowToProject(q.getProject.get(id) as Record<string, unknown>);
  });

  ipcMain.handle('projects:update', (_event, id: string, updates: ProjectInput) => {
    const existing = q.getProject.get(id) as Record<string, unknown>;
    if (!existing) throw new Error(`Project ${id} not found`);

    const projectPath = (updates.path ?? existing.path) as string;
    const skills = updates.optionalSkills
      ? updates.optionalSkills
      : JSON.parse((existing.optional_skills as string) || '[]');

    q.updateProject.run(
      updates.name ?? existing.name,
      projectPath,
      updates.repo ?? existing.repo,
      updates.description ?? existing.description,
      JSON.stringify(skills),
      updates.testCommand ?? (existing.test_command as string) ?? '',
      updates.codeHosting !== undefined ? updates.codeHosting : (existing.code_hosting as string | null),
      updates.codeHostingConfig ? JSON.stringify(updates.codeHostingConfig) : (existing.code_hosting_config as string) || '{}',
      updates.pluginPm !== undefined ? updates.pluginPm : (existing.plugin_pm as string | null),
      updates.pluginPmConfig ? JSON.stringify(updates.pluginPmConfig) : (existing.plugin_pm_config as string) || '{}',
      updates.aiAgent !== undefined ? updates.aiAgent : (existing.ai_agent as string) || 'claude',
      updates.aiAgentPhases ? JSON.stringify(updates.aiAgentPhases) : (existing.ai_agent_phases as string) || '{}',
      id
    );

    // Sync skills to project's .claude/settings.json
    const settingsPath = path.join(projectPath, '.claude', 'settings.json');
    writeSettingSources(settingsPath, skills);

    return rowToProject(q.getProject.get(id) as Record<string, unknown>);
  });

  ipcMain.handle('projects:delete', (_event, id: string) => {
    db.transaction(() => {
      // Cascade: delete all tasks and their references
      const taskRows = q.getTaskIdsByProject.all(id) as { id: string }[];
      for (const row of taskRows) {
        q.deleteReviewPatternsByTask.run(row.id);
        q.nullifyKnowledgeByTask.run(row.id);
        q.deleteAgentRunsByTask.run(row.id);
        q.nullifyLogsByTask.run(row.id);
        q.deleteTask.run(row.id);
      }
      q.nullifyKnowledgeByProject.run(id);
      q.deleteProject.run(id);
    })();
  });
}
