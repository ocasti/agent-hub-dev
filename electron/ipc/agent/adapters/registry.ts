// ── Adapter Registry & Credential Resolver ──────────────────────────────────────
//
// Dynamic adapter discovery: adapters are only available when their
// corresponding plugin is installed and enabled. No hardcoded adapter map.

import type Database from 'better-sqlite3';
import type { CodeHostingAdapter, CodeHostingCredentials, CodeHostingEnvVars, CodeHostingProjectConfig } from './types';
import { GitHubAdapter } from './github';
import { BitbucketAdapter } from './bitbucket';
import { loadAllPlugins } from '../../plugins/loader';

// ── Adapter Factories ───────────────────────────────────────────────────────
// Maps plugin ID → adapter constructor. Known at compile time (Level 2 plugins
// are TypeScript modules), but only instantiated when the plugin is installed.

const adapterFactories: Record<string, () => CodeHostingAdapter> = {
  github: () => new GitHubAdapter(),
  bitbucket: () => new BitbucketAdapter(),
};

/** Lazy cache — adapters are instantiated on first use */
const adapterCache: Record<string, CodeHostingAdapter> = {};

/**
 * Get the code hosting adapter for a given plugin ID.
 * Only returns an adapter if the corresponding plugin is installed and enabled.
 */
export function getAdapter(pluginId: string): CodeHostingAdapter | undefined {
  // Check if plugin is installed and enabled
  const plugins = loadAllPlugins();
  const plugin = plugins.find((p) => p.id === pluginId && p.enabled);
  if (!plugin) return undefined;

  // Lazy instantiate
  if (!adapterCache[pluginId]) {
    const factory = adapterFactories[pluginId];
    if (!factory) return undefined;
    adapterCache[pluginId] = factory();
  }

  return adapterCache[pluginId];
}

/**
 * Register an adapter factory at runtime.
 * Used by future plugins that ship their own adapter module.
 */
export function registerAdapterFactory(pluginId: string, factory: () => CodeHostingAdapter): void {
  adapterFactories[pluginId] = factory;
  // Invalidate cache so next getAdapter() picks up the new factory
  delete adapterCache[pluginId];
}

// ── Credential Resolution ───────────────────────────────────────────────────

/**
 * Resolve credentials for a project by merging:
 * 1. Global plugin config (from installed.json → configSchema values)
 * 2. Per-project override (from projects.code_hosting_config column)
 *
 * Per-project values take precedence over global plugin config.
 */
export function resolveCredentials(
  projectId: string,
  db: Database.Database
): CodeHostingCredentials {
  const credentials: CodeHostingCredentials = {};

  // 1. Get the project's active code hosting plugin
  const project = db.prepare(
    'SELECT code_hosting, code_hosting_config FROM projects WHERE id = ?'
  ).get(projectId) as { code_hosting: string | null; code_hosting_config: string } | undefined;

  if (!project?.code_hosting) return credentials;

  // 2. Get global plugin config
  const plugins = loadAllPlugins();
  const plugin = plugins.find((p) => p.id === project.code_hosting);
  if (plugin?.config) {
    if (plugin.config.token) credentials.token = plugin.config.token;
    if (plugin.config.authorName) credentials.authorName = plugin.config.authorName;
    if (plugin.config.authorEmail) credentials.authorEmail = plugin.config.authorEmail;
  }

  // 3. Apply per-project overrides (take precedence)
  try {
    const projectConfig: CodeHostingProjectConfig = JSON.parse(project.code_hosting_config || '{}');
    if (projectConfig.token) credentials.token = projectConfig.token;
    if (projectConfig.authorName) credentials.authorName = projectConfig.authorName;
    if (projectConfig.authorEmail) credentials.authorEmail = projectConfig.authorEmail;
  } catch {
    // Invalid JSON — ignore
  }

  return credentials;
}

/**
 * Build environment variables for a project's code hosting operations.
 * Combines adapter-specific env var building with credential resolution.
 *
 * Returns undefined if no code hosting plugin is active.
 */
export function resolveEnvVars(
  projectId: string,
  db: Database.Database
): CodeHostingEnvVars | undefined {
  const project = db.prepare(
    'SELECT code_hosting FROM projects WHERE id = ?'
  ).get(projectId) as { code_hosting: string | null } | undefined;

  if (!project?.code_hosting) return undefined;

  const adapter = getAdapter(project.code_hosting);
  if (!adapter) return undefined;

  const credentials = resolveCredentials(projectId, db);
  return adapter.buildEnvVars(credentials);
}

/**
 * Get the adapter for a project's active code hosting plugin.
 * Returns undefined if no code hosting plugin is active or installed.
 */
export function getProjectAdapter(
  projectId: string,
  db: Database.Database
): CodeHostingAdapter | undefined {
  const project = db.prepare(
    'SELECT code_hosting FROM projects WHERE id = ?'
  ).get(projectId) as { code_hosting: string | null } | undefined;

  if (!project?.code_hosting) return undefined;
  return getAdapter(project.code_hosting);
}

/**
 * Resolve the default branch for a project.
 * Checks per-project config first, then global plugin config, then auto-detects from git.
 */
export function resolveDefaultBranch(
  projectId: string,
  db: Database.Database
): string | undefined {
  const project = db.prepare(
    'SELECT code_hosting, code_hosting_config FROM projects WHERE id = ?'
  ).get(projectId) as { code_hosting: string | null; code_hosting_config: string } | undefined;

  if (!project?.code_hosting) return undefined;

  // Per-project override
  try {
    const projectConfig: CodeHostingProjectConfig = JSON.parse(project.code_hosting_config || '{}');
    if (projectConfig.defaultBranch) return projectConfig.defaultBranch;
  } catch { /* ignore */ }

  // Global plugin config
  const plugins = loadAllPlugins();
  const plugin = plugins.find((p) => p.id === project.code_hosting);
  if (plugin?.config?.defaultBranch) return plugin.config.defaultBranch;

  return undefined;
}
