import type { IpcMain } from 'electron';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createQueries } from '../db/queries';
import { canCreateKnowledge } from './license';

interface KnowledgeInput {
  id?: string;
  projectId?: string;
  category: string;
  severity?: string;
  title: string;
  description: string;
  sourceTask?: string;
  sourcePr?: number;
  codeExample?: string;
  antiPattern?: string;
  tags?: string[];
  timesApplied?: number;
}

function rowToKnowledge(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    projectId: row.project_id as string | undefined,
    category: row.category as string,
    severity: row.severity as string,
    title: row.title as string,
    description: row.description as string,
    sourceTask: row.source_task as string | undefined,
    sourcePr: row.source_pr as number | undefined,
    codeExample: row.code_example as string | undefined,
    antiPattern: row.anti_pattern as string | undefined,
    tags: JSON.parse((row.tags as string) || '[]'),
    timesApplied: row.times_applied as number,
    createdAt: row.created_at as string,
  };
}

export function registerKnowledgeHandlers(ipcMain: IpcMain, db: Database.Database) {
  const q = createQueries(db);

  ipcMain.handle('knowledge:getAll', (_event, projectId?: string) => {
    const rows = (projectId
      ? q.getKnowledgeByProject.all(projectId)
      : q.getAllKnowledge.all()) as Record<string, unknown>[];
    return rows.map(rowToKnowledge);
  });

  ipcMain.handle('knowledge:create', (_event, entry: KnowledgeInput) => {
    if (!canCreateKnowledge(db)) throw new Error('KNOWLEDGE_LIMIT_REACHED');
    const id = entry.id || uuidv4();
    q.insertKnowledge.run(
      id,
      entry.projectId || null,
      entry.category,
      entry.severity || 'medium',
      entry.title,
      entry.description,
      entry.sourceTask || null,
      entry.sourcePr || null,
      entry.codeExample || null,
      entry.antiPattern || null,
      JSON.stringify(entry.tags || [])
    );
    return rowToKnowledge(q.getKnowledgeByProject.all(id)?.[0] as Record<string, unknown> ?? q.getAllKnowledge.all().find((r: unknown) => (r as Record<string, unknown>).id === id) as Record<string, unknown>);
  });

  ipcMain.handle('knowledge:update', (_event, id: string, updates: KnowledgeInput) => {
    const existing = q.getAllKnowledge.all().find((r: unknown) => (r as Record<string, unknown>).id === id) as Record<string, unknown>;
    if (!existing) throw new Error(`Knowledge entry ${id} not found`);

    q.updateKnowledge.run(
      updates.category ?? existing.category,
      updates.severity ?? existing.severity,
      updates.title ?? existing.title,
      updates.description ?? existing.description,
      updates.codeExample !== undefined ? updates.codeExample : existing.code_example,
      updates.antiPattern !== undefined ? updates.antiPattern : existing.anti_pattern,
      updates.tags ? JSON.stringify(updates.tags) : (existing.tags as string),
      updates.timesApplied ?? existing.times_applied,
      id
    );
  });

  ipcMain.handle('knowledge:delete', (_event, id: string) => {
    q.deleteKnowledge.run(id);
  });
}
