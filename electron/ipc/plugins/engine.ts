import type Database from 'better-sqlite3';
import type { HookContext, InstalledPlugin, PluginAction, PluginHook, PluginOperation, ResolvedPhase } from './types';
import { loadAllPlugins } from './loader';
import { callMcpHttpTool, getMcpServerConfig } from './mcp-client';

// ── Template Resolution ─────────────────────────────────────────────────────────

export function resolveTemplate(template: string, vars: Record<string, string>): string {
  // Support both {key} and {config.key} patterns
  return template.replace(/\{(\w+(?:\.\w+)?)\}/g, (_, key) => {
    const configMatch = key.match(/^config\.(.+)$/);
    if (configMatch) return vars[configMatch[1]] ?? '';
    return vars[key] ?? '';
  });
}

// ── Hook Execution ──────────────────────────────────────────────────────────────

export async function fireHook(
  event: string,
  context: HookContext,
  db: Database.Database
): Promise<void> {
  const plugins = getActivePluginsForContext(context, db);
  const hooks: { hook: PluginHook; plugin: InstalledPlugin }[] = [];

  for (const plugin of plugins) {
    const normalizedHooks = getNormalizedHooks(plugin);
    for (const hook of normalizedHooks) {
      if (hook.event === event) {
        hooks.push({ hook, plugin });
      }
    }
  }

  if (hooks.length === 0) return;

  // Sort by priority (lower = first)
  hooks.sort((a, b) => (a.hook.priority ?? 100) - (b.hook.priority ?? 100));

  for (const { hook, plugin } of hooks) {
    try {
      const vars = buildVarsFromContext(context, plugin.config, db);

      // Resolve the operation: inline (tool/server/args on hook) or reference
      const operation = resolveHookOperation(hook, plugin);
      if (!operation) {
        console.warn(`[plugins] Hook ${event}: no operation found for "${hook.operation || '(inline)'}"`);
        continue;
      }

      const exec = () => executeHookOperation(event, hook, operation, vars, plugin, context, db);

      if (hook.blocking) {
        await exec();
      } else {
        exec().catch((err) => {
          console.error(`[plugins] Non-blocking hook ${event} failed:`, err.message || err);
        });
      }
    } catch (err) {
      console.error(`[plugins] Hook ${event} error:`, (err as Error).message || err);
    }
  }
}

/**
 * Execute a single hook operation, handling iterate and update_status actions.
 */
async function executeHookOperation(
  event: string,
  hook: PluginHook,
  operation: PluginOperation,
  vars: Record<string, string>,
  plugin: InstalledPlugin,
  context: HookContext,
  db: Database.Database
): Promise<void> {
  // Handle action: "update_status" — resolve statusMap to a status ID
  if (hook.action === 'update_status' && hook.statusMap) {
    const statusMappings = getStatusMappings(plugin);
    const statusTemplate = statusMappings[hook.statusMap];
    if (!statusTemplate) {
      console.warn(`[plugins] Hook ${event}: statusMap "${hook.statusMap}" not found in plugin statusMap`);
      return;
    }
    const statusId = resolveTemplate(statusTemplate, vars);
    if (!statusId) {
      console.warn(`[plugins] Hook ${event}: status ID resolved to empty for "${hook.statusMap}"`);
      return;
    }

    // Use the updateStatus operation with the resolved status ID
    const updateOp = getTopLevelOperations(plugin)['updateStatus'];
    if (!updateOp) {
      console.warn(`[plugins] Hook ${event}: "updateStatus" operation not found for status action`);
      return;
    }
    const statusVars = { ...vars, statusId };
    await executeOperation(updateOp, statusVars);
    console.log(`[plugins] Hook ${event}: status updated to "${hook.statusMap}" (id: ${statusId})`);
    return;
  }

  // Handle iterate: call operation once per item in the collection
  if (hook.iterate) {
    const items = resolveIterateCollection(hook.iterate, context, plugin.id, db);
    if (!items || items.length === 0) {
      console.log(`[plugins] Hook ${event}: iterate "${hook.iterate}" — no items found`);
      return;
    }

    // Filter out items that already have a remote ID (already exist in PM).
    // This prevents on:plan_approved from creating duplicate dev_tasks
    // when subtasks were already fetched from PM during enrichment.
    const filteredItems = items.filter((item) => {
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        const id = String(obj.id || '');
        // Skip items with real PM IDs (non-empty, not local-generated)
        if (id && !id.startsWith('local-')) return false;
      }
      return true;
    });

    if (filteredItems.length === 0) {
      console.log(`[plugins] Hook ${event}: iterate "${hook.iterate}" — all ${items.length} item(s) already have remote IDs, skipping`);
      return;
    }

    if (filteredItems.length < items.length) {
      console.log(`[plugins] Hook ${event}: iterate "${hook.iterate}" — skipping ${items.length - filteredItems.length} item(s) with existing remote IDs`);
    }

    const collectedIds: string[] = [];
    const sourceDescs: string[] = [];

    for (const item of filteredItems) {
      const iterVars = { ...vars };
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        iterVars.item = obj.description ? String(obj.description) : JSON.stringify(item);
        iterVars.subtask = String(obj.description || '');
        iterVars.subtaskId = String(obj.id || '');
        iterVars.criterionId = String(obj.id || '');
      } else {
        iterVars.item = String(item);
        iterVars.subtask = String(item);
      }

      try {
        const result = await executeOperation(operation, iterVars);

        if (hook.store && result) {
          const extracted = extractFieldFromResult(result, hook.store.field);
          if (extracted) {
            collectedIds.push(extracted);
            sourceDescs.push(iterVars.subtask || iterVars.item);
          }
        }
      } catch (err) {
        console.error(`[plugins] Hook ${event}: iterate item failed:`, (err as Error).message);
      }
    }

    // Store collected IDs in plugin_context
    if (hook.store && collectedIds.length > 0 && context.taskId) {
      storeCollectedInPluginContext(db, context.taskId, plugin.id, hook.store.key, sourceDescs, collectedIds);
    }

    console.log(`[plugins] Hook ${event}: iterated ${filteredItems.length} item(s)`);
    return;
  }

  // Standard single execution
  await executeOperation(operation, vars);
  console.log(`[plugins] Hook ${event}: executed ${operation.tool} on ${operation.server}`);
}

// ── Enrichment ──────────────────────────────────────────────────────────────────

export async function getEnrichmentData(
  event: string,
  context: HookContext,
  db: Database.Database
): Promise<Record<string, unknown>> {
  const plugins = getActivePluginsForContext(context, db);
  const result: Record<string, unknown> = {};

  for (const plugin of plugins) {
    const enrichments = getNormalizedEnrichments(plugin);
    for (const enrichment of enrichments) {
      if (enrichment.event !== event) continue;

      const operation = resolveEnrichmentOperation(enrichment, plugin);
      if (!operation) continue;

      try {
        const vars = buildVarsFromContext(context, plugin.config, db);
        const data = await executeOperation(operation, vars);
        if (data) {
          result[`${plugin.id}:${enrichment.target}`] = data;

          // Persist subtask data from enrichment into plugin_context
          if (context.taskId) {
            const mapped = data as Record<string, unknown>;
            const subtaskDescs = mapped.subtasks || mapped.dev_tasks;
            const subtaskIds = mapped.subtaskIds || mapped.dev_task_ids;
            if (Array.isArray(subtaskDescs) && Array.isArray(subtaskIds)) {
              const subtasks = (subtaskDescs as string[]).map((desc, i) => ({
                id: String((subtaskIds as unknown[])[i] || ''),
                description: String(desc),
                completed: false,
              }));
              if (subtasks.length > 0) {
                storeSubtasksInPluginContext(db, context.taskId, plugin.id, subtasks);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[plugins] Enrichment ${event} error:`, (err as Error).message || err);
      }
    }
  }

  return result;
}

// ── Operation Execution ─────────────────────────────────────────────────────────

export async function executeOperation(
  operation: PluginOperation,
  vars: Record<string, string>
): Promise<unknown> {
  // Resolve template variables in operation args
  const resolvedArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(operation.args)) {
    resolvedArgs[key] = resolveTemplate(value, vars);
  }

  // Skip if required args resolved to empty (e.g. no pmWorkItemId)
  const hasEmptyRequired = Object.values(resolvedArgs).some((v) => v === '');
  if (hasEmptyRequired) {
    const emptyKeys = Object.entries(resolvedArgs).filter(([, v]) => v === '').map(([k]) => k);
    console.warn(`[plugins] Skipping ${operation.tool}: empty args [${emptyKeys.join(', ')}]`);
    return null;
  }

  try {
    const config = getMcpServerConfig(operation.server);
    const result = await callMcpHttpTool(config, operation.tool, resolvedArgs);
    console.log(`[plugins] MCP call OK: ${operation.tool} on ${operation.server}`);
    return result;
  } catch (err) {
    console.error(`[plugins] MCP call failed: ${operation.tool} on ${operation.server}:`, (err as Error).message);
    throw err;
  }
}

// ── Phase Resolution ────────────────────────────────────────────────────────────

const CORE_PHASES: ResolvedPhase[] = [
  { id: 'spec_review', label: 'Spec Review', phase: 0, source: 'core', icon: 'search' },
  { id: 'plan', label: 'Plan', phase: 1, source: 'core', icon: 'clipboard' },
  { id: 'implement', label: 'Implement', phase: 2, source: 'core', icon: 'gear' },
  { id: 'quality_gate', label: 'Quality Gate', phase: 3, source: 'core', icon: 'circle-check' },
];

export function resolveWorkflowPhases(
  projectId: string,
  db: Database.Database
): ResolvedPhase[] {
  const phases = [...CORE_PHASES];
  const plugins = getActivePluginsForProject(projectId, db);

  let nextPhaseNum = 4;
  for (const plugin of plugins) {
    const pluginPhases = getNormalizedPhases(plugin);
    for (const pluginPhase of pluginPhases) {
      phases.push({
        id: pluginPhase.id,
        label: pluginPhase.label,
        phase: nextPhaseNum++,
        source: plugin.id,
        icon: pluginPhase.icon,
        capability: pluginPhase.capability,
      });
    }
  }

  return phases;
}

// ── Plugin Queries ──────────────────────────────────────────────────────────────

export function getActivePluginsForProject(
  projectId: string,
  db: Database.Database
): InstalledPlugin[] {
  const allPlugins = loadAllPlugins();

  // Get project's active plugin IDs
  const project = db.prepare('SELECT code_hosting, plugin_pm FROM projects WHERE id = ?').get(projectId) as
    { code_hosting: string | null; plugin_pm: string | null } | undefined;

  if (!project) return [];

  const activeIds = new Set<string>();
  if (project.code_hosting) activeIds.add(project.code_hosting);
  if (project.plugin_pm) activeIds.add(project.plugin_pm);

  // A plugin is active for this project if: installed, enabled, and selected by the project.
  return allPlugins.filter((p) => activeIds.has(p.id) && p.enabled);
}

function getActivePluginsForContext(
  context: HookContext,
  db: Database.Database
): InstalledPlugin[] {
  if (!context.projectId) return [];
  return getActivePluginsForProject(context.projectId, db);
}

// ── Conflict Detection ──────────────────────────────────────────────────────────

export function checkCapabilityConflicts(
  projectId: string,
  pluginId: string,
  capability: string,
  db: Database.Database
): string[] {
  const allPlugins = loadAllPlugins();
  const plugin = allPlugins.find((p) => p.id === pluginId);
  if (!plugin?.manifest) return [];

  const activePlugins = getActivePluginsForProject(projectId, db);
  const conflicts: string[] = [];

  for (const active of activePlugins) {
    if (active.id === pluginId) continue;
    if (active.manifest?.capabilities.includes(capability)) {
      conflicts.push(`${active.manifest.name} already provides "${capability}" capability`);
    }
  }

  return conflicts;
}

// ── Manifest Normalization ──────────────────────────────────────────────────────
// manifest.json has two layers:
//   Top-level: provides, operations, statusMap
//   Nested: workflow.hooks, workflow.enrichment, workflow.actions, workflow.phases
// The loader reads the whole file as PluginWorkflow, so we need to access both layers.

type RawManifest = Record<string, unknown>;

/** Get top-level operations (always at root of manifest.json) */
function getTopLevelOperations(plugin: InstalledPlugin): Record<string, PluginOperation> {
  const raw = plugin.workflow as unknown as RawManifest;
  return (raw?.operations as Record<string, PluginOperation>) || {};
}

/** Get statusMap from root of manifest.json */
function getStatusMappings(plugin: InstalledPlugin): Record<string, string> {
  const raw = plugin.workflow as unknown as RawManifest;
  return (raw?.statusMap as Record<string, string>) || (raw?.statusMappings as Record<string, string>) || {};
}

/** Get nested workflow object */
function getNestedWorkflow(plugin: InstalledPlugin): RawManifest {
  const raw = plugin.workflow as unknown as RawManifest;
  return (raw?.workflow as RawManifest) || {};
}

/**
 * Normalize hooks from manifest.json.
 * Supports both formats:
 *   Array: [{ event, operation, priority }]  (GitHub plugin style)
 *   Object: { "on:event": { tool, server, args, priority } }  (PM plugin style)
 */
function getNormalizedHooks(plugin: InstalledPlugin): PluginHook[] {
  const nested = getNestedWorkflow(plugin);
  const rawHooks = nested.hooks;
  if (!rawHooks) return [];

  // Array format (GitHub plugin)
  if (Array.isArray(rawHooks)) {
    return rawHooks as PluginHook[];
  }

  // Object format (PM plugin) — convert to array
  // Supports both single hook and array of hooks per event
  const hooks: PluginHook[] = [];
  const pushHook = (event: string, hookDef: RawManifest) => {
    hooks.push({
      event,
      operation: (hookDef.operation as string) || '',
      priority: (hookDef.priority as number) || 100,
      blocking: (hookDef.blocking as boolean) || false,
      tool: hookDef.tool as string | undefined,
      server: hookDef.server as string | undefined,
      args: hookDef.args as Record<string, string> | undefined,
      action: hookDef.action as string | undefined,
      statusMap: hookDef.statusMap as string | undefined,
      iterate: hookDef.iterate as string | undefined,
      store: hookDef.store as { key: string; field: string } | undefined,
    } as PluginHook);
  };
  for (const [event, hookDef] of Object.entries(rawHooks as Record<string, RawManifest | RawManifest[]>)) {
    if (Array.isArray(hookDef)) {
      for (const h of hookDef) pushHook(event, h as RawManifest);
    } else {
      pushHook(event, hookDef as RawManifest);
    }
  }
  return hooks;
}

/** Normalize enrichments */
function getNormalizedEnrichments(plugin: InstalledPlugin): { event: string; operation?: string; target: string; tool?: string; server?: string; args?: Record<string, string>; inject?: Record<string, string> }[] {
  const nested = getNestedWorkflow(plugin);
  const rawEnrichment = nested.enrichment;
  if (!rawEnrichment) return [];

  if (Array.isArray(rawEnrichment)) {
    return rawEnrichment;
  }

  // Object format
  const enrichments: { event: string; operation?: string; target: string; tool?: string; server?: string; args?: Record<string, string>; inject?: Record<string, string> }[] = [];
  for (const [event, def] of Object.entries(rawEnrichment as Record<string, RawManifest>)) {
    enrichments.push({
      event,
      operation: def.operation as string | undefined,
      target: (def.target as string) || 'prompt',
      tool: def.tool as string | undefined,
      server: def.server as string | undefined,
      args: def.args as Record<string, string> | undefined,
      inject: def.inject as Record<string, string> | undefined,
    });
  }
  return enrichments;
}

/** Normalize phases (always in array format under workflow) */
function getNormalizedPhases(plugin: InstalledPlugin): { id: string; label: string; capability: string; icon?: string }[] {
  const nested = getNestedWorkflow(plugin);
  const phases = nested.phases;
  if (!phases || !Array.isArray(phases)) return [];
  return phases as { id: string; label: string; capability: string; icon?: string }[];
}

// ── Injected Actions ─────────────────────────────────────────────────────────────

/** Get actions from nested workflow */
function getNormalizedActions(plugin: InstalledPlugin): PluginAction[] {
  const nested = getNestedWorkflow(plugin);
  const rawActions = nested.actions;
  if (!rawActions) return [];

  // Array format
  if (Array.isArray(rawActions)) {
    return rawActions as PluginAction[];
  }

  // Object format: { "action_id": { label, icon, ... } }
  const actions: PluginAction[] = [];
  for (const [id, def] of Object.entries(rawActions as Record<string, RawManifest>)) {
    actions.push({
      id,
      label: String(def.label || id),
      icon: def.icon as string | undefined,
      operation: def.operation as string | undefined,
      context: (def.context as 'task' | 'project') || 'task',
      injectAt: def.injectAt as string | undefined,
      promptTemplate: def.promptTemplate as string | undefined,
      mode: (def.mode as 'copy' | 'modal') || undefined,
    });
  }
  return actions;
}

export interface InjectedAction {
  pluginId: string;
  actionId: string;
  label: string;
  icon?: string;
  mode: 'copy' | 'modal';
  prompt?: string;
}

/**
 * Get injected actions for a task at a given status.
 * Resolves promptTemplate with task data (criteria, title, description).
 */
export function getInjectedActions(
  projectId: string,
  taskStatus: string,
  taskData: { title: string; description: string; criteria: string[]; branchName?: string; projectPath?: string },
  db: Database.Database
): InjectedAction[] {
  const plugins = getActivePluginsForProject(projectId, db);
  const result: InjectedAction[] = [];

  for (const plugin of plugins) {
    const actions = getNormalizedActions(plugin);
    for (const action of actions) {
      if (!action.injectAt) continue;

      // Match by status (e.g. "status:pr_feedback")
      const statusMatch = action.injectAt.match(/^status:(.+)$/);
      if (statusMatch && statusMatch[1] === taskStatus) {
        const prompt = action.promptTemplate
          ? resolvePromptTemplate(action.promptTemplate, taskData)
          : undefined;

        result.push({
          pluginId: plugin.id,
          actionId: action.id,
          label: action.label,
          icon: action.icon,
          mode: action.mode || 'copy',
          prompt,
        });
      }
    }
  }

  return result;
}

/**
 * Resolve a prompt template with task data.
 * Supports: {taskTitle}, {taskDescription}, {criteria}, {branchName}, {projectPath}
 */
function resolvePromptTemplate(
  template: string,
  data: { title: string; description: string; criteria: string[]; branchName?: string; projectPath?: string }
): string {
  const criteriaText = data.criteria.length > 0
    ? data.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : 'No specific acceptance criteria defined.';

  return template
    .replace(/\{taskTitle\}/g, data.title)
    .replace(/\{taskDescription\}/g, data.description)
    .replace(/\{criteria\}/g, criteriaText)
    .replace(/\{branchName\}/g, data.branchName || 'unknown')
    .replace(/\{projectPath\}/g, data.projectPath || 'unknown');
}

// ── Hook Resolution ─────────────────────────────────────────────────────────────

/**
 * Resolve a hook to its operation.
 * Hooks can reference an operation by name, or have inline tool/server/args.
 */
function resolveHookOperation(hook: PluginHook, plugin: InstalledPlugin): PluginOperation | null {
  // Inline operation (PM plugin style: tool/server/args on hook itself)
  const inlineHook = hook as PluginHook & { tool?: string; server?: string; args?: Record<string, string> };
  if (inlineHook.tool && inlineHook.server) {
    return {
      tool: inlineHook.tool,
      server: inlineHook.server,
      args: inlineHook.args || {},
    };
  }

  // Reference to named operation
  if (hook.operation) {
    const ops = getTopLevelOperations(plugin);
    return ops[hook.operation] || null;
  }

  // action: "update_status" hooks are handled separately in executeHookOperation
  if ((hook as PluginHook & { action?: string }).action === 'update_status') {
    return { tool: '__update_status', server: '__internal', args: {} };
  }

  return null;
}

/** Resolve an enrichment to its operation */
function resolveEnrichmentOperation(
  enrichment: { operation?: string; tool?: string; server?: string; args?: Record<string, string> },
  plugin: InstalledPlugin
): PluginOperation | null {
  if (enrichment.tool && enrichment.server) {
    return {
      tool: enrichment.tool,
      server: enrichment.server,
      args: enrichment.args || {},
    };
  }
  if (enrichment.operation) {
    const ops = getTopLevelOperations(plugin);
    return ops[enrichment.operation] || null;
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function buildVarsFromContext(
  context: HookContext,
  config: Record<string, string>,
  db?: Database.Database
): Record<string, string> {
  // Get pmWorkItemId from the task if available
  let pmWorkItemId = context.pmWorkItemId || '';
  if (!pmWorkItemId && context.taskId && db) {
    try {
      const task = db.prepare('SELECT pm_work_item_id FROM tasks WHERE id = ?').get(context.taskId) as { pm_work_item_id: string | null } | undefined;
      pmWorkItemId = task?.pm_work_item_id || '';
    } catch { /* ignore */ }
  }

  return {
    ...config,
    taskId: context.taskId || '',
    projectId: context.projectId || '',
    projectPath: context.projectPath || '',
    taskTitle: context.taskTitle || '',
    taskDescription: context.taskDescription || '',
    branchName: context.branchName || '',
    prNumber: context.prNumber?.toString() || '',
    phase: context.phase?.toString() || '',
    phaseLabel: context.phaseLabel || '',
    error: context.error || '',
    planSummary: context.planSummary || '',
    commentCount: context.commentCount?.toString() || '',
    pmWorkItemId,
  };
}

/**
 * Check if a project has a code-hosting plugin active (for Ship phase).
 */
export function hasCodeHostingPlugin(projectId: string, db: Database.Database): boolean {
  const project = db.prepare('SELECT code_hosting FROM projects WHERE id = ?').get(projectId) as
    { code_hosting: string | null } | undefined;
  return !!project?.code_hosting;
}

// ── Iterate + Store Helpers ──────────────────────────────────────────────────────

function resolveIterateCollection(
  iterateKey: string,
  context: HookContext,
  pluginId: string,
  db: Database.Database
): unknown[] {
  // "stored.XXX" reads from plugin_context saved by a previous hook
  if (iterateKey.startsWith('stored.')) {
    const storedKey = iterateKey.replace('stored.', '');
    if (!context.taskId) return [];
    const row = db.prepare('SELECT plugin_context FROM tasks WHERE id = ?')
      .get(context.taskId) as { plugin_context: string } | undefined;
    if (!row) return [];
    const pc = JSON.parse(row.plugin_context || '{}');
    return Array.isArray(pc[pluginId]?.[storedKey]) ? pc[pluginId][storedKey] : [];
  }

  // Check context.extra for the collection (passed by orchestrator)
  if (context.extra && Array.isArray(context.extra[iterateKey])) {
    return context.extra[iterateKey] as unknown[];
  }

  // Check plugin_context for the collection
  if (context.taskId) {
    const row = db.prepare('SELECT plugin_context FROM tasks WHERE id = ?')
      .get(context.taskId) as { plugin_context: string } | undefined;
    if (row) {
      const pc = JSON.parse(row.plugin_context || '{}');
      if (Array.isArray(pc[pluginId]?.[iterateKey])) {
        return pc[pluginId][iterateKey];
      }
    }
  }

  return [];
}

function extractFieldFromResult(result: unknown, fieldPath: string): string | null {
  if (!result || typeof result !== 'object') return null;
  const clean = fieldPath.replace(/^\$\./, '');
  let current: unknown = result;
  for (const part of clean.split('.')) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else return null;
  }
  return current != null ? String(current) : null;
}

function storeCollectedInPluginContext(
  db: Database.Database,
  taskId: string,
  pluginId: string,
  key: string,
  sourceDescs: string[],
  collectedIds: string[]
): void {
  const row = db.prepare('SELECT plugin_context FROM tasks WHERE id = ?')
    .get(taskId) as { plugin_context: string } | undefined;
  if (!row) return;

  const pc = JSON.parse(row.plugin_context || '{}');
  if (!pc[pluginId]) pc[pluginId] = {};
  if (!pc[pluginId][key]) pc[pluginId][key] = [];

  for (let i = 0; i < collectedIds.length; i++) {
    pc[pluginId][key].push({
      id: collectedIds[i],
      description: sourceDescs[i] || '',
      completed: false,
    });
  }

  db.prepare('UPDATE tasks SET plugin_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(pc), taskId);
}

function storeSubtasksInPluginContext(
  db: Database.Database,
  taskId: string,
  pluginId: string,
  subtasks: { id: string; description: string; completed: boolean }[]
): void {
  const row = db.prepare('SELECT plugin_context FROM tasks WHERE id = ?')
    .get(taskId) as { plugin_context: string } | undefined;
  if (!row) return;

  const pc = JSON.parse(row.plugin_context || '{}');
  if (!pc[pluginId]) pc[pluginId] = {};
  pc[pluginId].subtasks = subtasks;

  db.prepare('UPDATE tasks SET plugin_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(pc), taskId);
}
