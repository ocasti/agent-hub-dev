import type Database from 'better-sqlite3';
import type { HookContext, InstalledPlugin, PluginHook, PluginOperation, ResolvedPhase } from './types';
import { loadAllPlugins } from './loader';

// ── Template Resolution ─────────────────────────────────────────────────────────

export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
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
    if (!plugin.workflow?.hooks) continue;
    for (const hook of plugin.workflow.hooks) {
      if (hook.event === event) {
        hooks.push({ hook, plugin });
      }
    }
  }

  // Sort by priority (lower = first)
  hooks.sort((a, b) => (a.hook.priority ?? 100) - (b.hook.priority ?? 100));

  for (const { hook, plugin } of hooks) {
    try {
      const operation = plugin.workflow?.operations?.[hook.operation];
      if (!operation) continue;

      const vars = buildVarsFromContext(context, plugin.config);

      if (hook.blocking) {
        await executeOperation(operation, vars);
      } else {
        // Fire and forget
        executeOperation(operation, vars).catch((err) => {
          console.error(`[plugins] Non-blocking hook ${event}/${hook.operation} failed:`, err);
        });
      }
    } catch (err) {
      console.error(`[plugins] Hook ${event}/${hook.operation} error:`, err);
    }
  }
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
    if (!plugin.workflow?.enrichment) continue;
    for (const enrichment of plugin.workflow.enrichment) {
      if (enrichment.event !== event) continue;

      const operation = plugin.workflow.operations?.[enrichment.operation];
      if (!operation) continue;

      try {
        const vars = buildVarsFromContext(context, plugin.config);
        const data = await executeOperation(operation, vars);
        if (data) {
          result[`${plugin.id}:${enrichment.target}`] = data;
        }
      } catch (err) {
        console.error(`[plugins] Enrichment ${event}/${enrichment.operation} error:`, err);
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

  // Execute via Claude CLI MCP tool call
  // For now, log the intended call. Full MCP execution requires the CLI subprocess.
  console.log(`[plugins] Execute operation: ${operation.tool} on ${operation.server}`, resolvedArgs);

  // TODO: Implement actual MCP tool execution via Claude CLI
  // const prompt = `Call the MCP tool "${operation.tool}" with these arguments: ${JSON.stringify(resolvedArgs)}. Return ONLY the raw JSON result.`;
  // const result = await runClaudePhase(cwd, 'haiku', prompt, ...);

  return { tool: operation.tool, args: resolvedArgs, status: 'pending' };
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
    if (!plugin.workflow?.phases) continue;
    for (const pluginPhase of plugin.workflow.phases) {
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

// ── Helpers ─────────────────────────────────────────────────────────────────────

function buildVarsFromContext(
  context: HookContext,
  config: Record<string, string>
): Record<string, string> {
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
