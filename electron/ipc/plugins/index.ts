import type { IpcMain } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type Database from 'better-sqlite3';
import { loadAllPlugins, getRegistryCatalog } from './loader';
import { installPlugin, uninstallPlugin, updatePluginConfig, downloadAndInstallPlugin, installBundledPlugin, checkPluginCompatibility, previewLocalPlugin, installPluginFromDisk } from './installer';
import { checkCapabilityConflicts, executeOperation } from './engine';
import { fetchConfigOptions, getMcpServerConfig, callMcpHttpTool, extractOptionsFromResult } from './mcp-client';
import type { InstalledPlugin, CatalogPlugin, TaskField } from './types';
import { canInstallCommunityPlugin } from '../license';

// ── JSONPath-like field extraction ──────────────────────────────────────────────

function extractFieldByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  // Remove leading "$."
  const cleanPath = path.replace(/^\$\./, '');

  // Handle array wildcard: "items[*].field"
  const wildcardMatch = cleanPath.match(/^(.+?)\[\*\]\.(.+)$/);
  if (wildcardMatch) {
    const arrayField = wildcardMatch[1];
    const subField = wildcardMatch[2];
    const arr = (obj as Record<string, unknown>)[arrayField];
    if (!Array.isArray(arr)) return [];
    return arr.map((item) => {
      if (item && typeof item === 'object') return (item as Record<string, unknown>)[subField];
      return undefined;
    }).filter((v) => v !== undefined);
  }

  // Simple dot-path: "field.sub"
  let current: unknown = obj;
  for (const part of cleanPath.split('.')) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

// ── Secret masking ──────────────────────────────────────────────────────────────

function maskSecretConfig(
  config: Record<string, string>,
  schema?: { key: string; type?: string; secret?: boolean }[]
): Record<string, string> {
  if (!schema) return config;
  const secretKeys = new Set(
    schema
      .filter((f) => f.secret === true || f.type === 'secret')
      .map((f) => f.key)
  );
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (secretKeys.has(key) && value) {
      masked[key] = value.length > 3
        ? `••••••${value.slice(-3)}`
        : '••••••';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ── Plugin to frontend shape ────────────────────────────────────────────────────

function toFrontendPlugin(p: InstalledPlugin) {
  return {
    id: p.id,
    name: p.manifest?.name || p.id,
    version: p.manifest?.version || p.version,
    description: p.manifest?.description || '',
    author: p.manifest?.author,
    capabilities: p.manifest?.capabilities || [],
    level: p.manifest?.level || 1,
    enabled: p.enabled,
    source: p.source || 'community',
    config: maskSecretConfig(p.config, p.manifest?.configSchema),
    configSchema: p.manifest?.configSchema,
  };
}

// ── Registration ────────────────────────────────────────────────────────────────

export function registerPluginHandlers(ipcMain: IpcMain, db: Database.Database) {

  // List all available plugins (built-in + installed)
  ipcMain.handle('plugins:list', () => {
    return loadAllPlugins().map(toFrontendPlugin);
  });

  // Get single plugin details
  ipcMain.handle('plugins:get', (_event, pluginId: string) => {
    const plugins = loadAllPlugins();
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
    return toFrontendPlugin(plugin);
  });

  // Install plugin with config
  ipcMain.handle('plugins:install', async (_event, pluginId: string, config: Record<string, string>) => {
    await installPlugin(pluginId, config);
  });

  // Uninstall plugin
  ipcMain.handle('plugins:uninstall', async (_event, pluginId: string) => {
    await uninstallPlugin(pluginId);
  });

  // Update plugin config
  ipcMain.handle('plugins:updateConfig', async (_event, pluginId: string, config: Record<string, string>) => {
    await updatePluginConfig(pluginId, config);
  });

  // Get active plugins for a project
  ipcMain.handle('plugins:getProjectPlugins', (_event, projectId: string) => {
    const project = db.prepare('SELECT code_hosting, plugin_pm FROM projects WHERE id = ?').get(projectId) as
      { code_hosting: string | null; plugin_pm: string | null } | undefined;
    if (!project) return [];

    const allPlugins = loadAllPlugins();
    const activeIds = new Set<string>();
    if (project.code_hosting) activeIds.add(project.code_hosting);
    if (project.plugin_pm) activeIds.add(project.plugin_pm);

    return allPlugins.filter((p) => activeIds.has(p.id)).map(toFrontendPlugin);
  });

  // Activate plugin for project
  ipcMain.handle('plugins:activateForProject', (_event, projectId: string, pluginId: string, capability: string) => {
    if (capability === 'ship' || capability === 'pr_feedback') {
      db.prepare('UPDATE projects SET code_hosting = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(pluginId, projectId);
    } else {
      db.prepare('UPDATE projects SET plugin_pm = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(pluginId, projectId);
    }
  });

  // Deactivate plugin for project
  ipcMain.handle('plugins:deactivateForProject', (_event, projectId: string, capability: string) => {
    if (capability === 'ship' || capability === 'pr_feedback') {
      db.prepare('UPDATE projects SET code_hosting = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
    } else {
      db.prepare('UPDATE projects SET plugin_pm = NULL, plugin_pm_config = \'{}\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(projectId);
    }
  });

  // Check plugin conflicts before activation
  ipcMain.handle('plugins:checkConflicts', (_event, projectId: string, pluginId: string) => {
    const allPlugins = loadAllPlugins();
    const plugin = allPlugins.find((p) => p.id === pluginId);
    if (!plugin?.manifest) return [];

    const conflicts: string[] = [];
    for (const cap of plugin.manifest.capabilities) {
      conflicts.push(...checkCapabilityConflicts(projectId, pluginId, cap, db));
    }
    return conflicts;
  });

  // Fetch plugin catalog from remote registry
  ipcMain.handle('plugins:catalog', async (_event, forceRefresh?: boolean) => {
    let registryUrl: string | undefined;
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('pluginRegistryUrl') as { value: string } | undefined;
      if (row?.value) registryUrl = row.value;
    } catch { /* use default */ }
    return getRegistryCatalog(registryUrl, forceRefresh ?? false);
  });

  // Install plugin from catalog
  ipcMain.handle('plugins:installFromCatalog', async (_event, pluginId: string, config: Record<string, string>) => {
    const catalog = await getRegistryCatalog();
    const entry = catalog.find((p: CatalogPlugin) => p.id === pluginId);
    if (!entry) throw new Error(`Plugin "${pluginId}" not found in catalog`);
    if (entry.source === 'community' && !canInstallCommunityPlugin(db)) {
      throw new Error('COMMUNITY_PLUGIN_REQUIRES_PRO');
    }

    // Try bundled install first (for official plugins shipped with the app)
    const appPath = app.getAppPath();
    const base = appPath.endsWith('.asar') ? appPath + '.unpacked' : appPath;
    const bundledDir = join(base, 'plugin-registry', 'plugins', entry.id);
    if (existsSync(bundledDir)) {
      await installBundledPlugin(entry.id, config);
    } else {
      await downloadAndInstallPlugin(entry, config);
    }
  });

  // Preview a local plugin folder (validates without installing)
  ipcMain.handle('plugins:previewLocalPlugin', (_event, folderPath: string) => {
    return previewLocalPlugin(folderPath);
  });

  // Install plugin from a local folder on disk
  ipcMain.handle('plugins:installFromDisk', async (_event, folderPath: string, config: Record<string, string>) => {
    await installPluginFromDisk(folderPath, config);
  });

  // Check compatibility of all installed plugins
  ipcMain.handle('plugins:checkCompatibility', () => {
    const plugins = loadAllPlugins();
    return plugins
      .filter((p) => p.manifest)
      .map((p) => {
        const result = checkPluginCompatibility(p.manifest!);
        return {
          pluginId: p.id,
          name: p.manifest?.name || p.id,
          compatible: result.compatible,
          reason: result.reason,
        };
      });
  });

  // Fetch dynamic config options from MCP server
  ipcMain.handle('plugins:fetchConfigOptions', async (
    _event,
    server: string,
    tool: string,
    labelField: string,
    valueField: string,
    args?: Record<string, string>
  ) => {
    return fetchConfigOptions(server, tool, labelField, valueField, args);
  });

  // List PM work items from a plugin's MCP server
  ipcMain.handle('plugins:listWorkItems', async (_event, pluginId: string) => {
    const allPlugins = loadAllPlugins();
    const plugin = allPlugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

    // Find the listMyWork operation in the manifest
    const manifest = plugin.workflow;
    const operation = manifest?.operations?.['listMyWork'];
    if (!operation) throw new Error(`Plugin "${pluginId}" has no listMyWork operation`);

    const config = getMcpServerConfig(operation.server);
    const result = await callMcpHttpTool(config, operation.tool, operation.args || {});

    // Extract structured items using fieldMap or defaults
    const fieldMap = (operation as { fieldMap?: Record<string, string> }).fieldMap;
    const idField = fieldMap?.id?.replace(/^\$\./, '') || 'id';
    const titleField = fieldMap?.title?.replace(/^\$\./, '') || 'title';
    const statusField = fieldMap?.status?.replace(/^\$\./, '') || 'status';
    const projectField = fieldMap?.project?.replace(/^\$\./, '') || 'project';

    // Normalize result to array
    let items: unknown[];
    if (Array.isArray(result)) {
      items = result;
    } else if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      const arrayProp = Object.values(obj).find((v) => Array.isArray(v));
      items = (arrayProp as unknown[]) || [];
    } else {
      items = [];
    }

    return items.map((item) => {
      const r = item as Record<string, unknown>;
      return {
        id: String(r[idField] || ''),
        title: String(r[titleField] || ''),
        status: r[statusField] ? String(r[statusField]) : undefined,
        project: r[projectField] ? String(r[projectField]) : undefined,
      };
    }).filter((wi) => wi.id && wi.title);
  });

  // Get task fields declared by active plugins for a project
  ipcMain.handle('plugins:getTaskFields', (_event, projectId: string) => {
    const project = db.prepare('SELECT code_hosting, plugin_pm FROM projects WHERE id = ?').get(projectId) as
      { code_hosting: string | null; plugin_pm: string | null } | undefined;
    if (!project) return [];

    const allPlugins = loadAllPlugins();
    const activeIds = new Set<string>();
    if (project.code_hosting) activeIds.add(project.code_hosting);
    if (project.plugin_pm) activeIds.add(project.plugin_pm);

    const fields: (TaskField & { pluginId: string })[] = [];
    for (const plugin of allPlugins) {
      if (!activeIds.has(plugin.id) || !plugin.manifest?.taskFields) continue;
      for (const field of plugin.manifest.taskFields) {
        fields.push({ ...field, pluginId: plugin.id });
      }
    }
    return fields;
  });

  // Execute a plugin operation by ID and return the result (used by taskField onSelect.fetch)
  ipcMain.handle('plugins:executeOperation', async (_event, pluginId: string, operationId: string, args?: Record<string, string>) => {
    const allPlugins = loadAllPlugins();
    const plugin = allPlugins.find((p) => p.id === pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);

    const operation = plugin.workflow?.operations?.[operationId];
    if (!operation) throw new Error(`Operation "${operationId}" not found in plugin "${pluginId}"`);

    const config = getMcpServerConfig(operation.server);

    // Merge plugin config + provided args, resolve template variables
    const vars: Record<string, string> = { ...plugin.config, ...(args || {}) };
    const resolvedArgs: Record<string, string> = {};
    for (const [key, value] of Object.entries(operation.args)) {
      resolvedArgs[key] = value.replace(/\{(\w+(?:\.\w+)?)\}/g, (_, k) => {
        // Support {config.xxx} and {xxx}
        const configMatch = k.match(/^config\.(.+)$/);
        if (configMatch) return plugin.config[configMatch[1]] || '';
        return vars[k] || '';
      });
    }

    const result = await callMcpHttpTool(config, operation.tool, resolvedArgs);

    // Apply fieldMap if present to extract structured data
    if (operation.fieldMap) {
      const mapped: Record<string, unknown> = {};
      for (const [field, path] of Object.entries(operation.fieldMap)) {
        mapped[field] = extractFieldByPath(result, path);
      }
      return mapped;
    }

    return result;
  });

  // Execute a manual plugin action
  ipcMain.handle('plugins:executeAction', async (_event, pluginId: string, actionId: string, context: Record<string, string>) => {
    const allPlugins = loadAllPlugins();
    const plugin = allPlugins.find((p) => p.id === pluginId);
    if (!plugin?.workflow?.actions) throw new Error(`Plugin "${pluginId}" has no actions`);

    const action = plugin.workflow.actions.find((a) => a.id === actionId);
    if (!action) throw new Error(`Action "${actionId}" not found in plugin "${pluginId}"`);

    const operation = plugin.workflow.operations?.[action.operation];
    if (!operation) throw new Error(`Operation "${action.operation}" not found`);

    return executeOperation(operation, { ...plugin.config, ...context });
  });
}
