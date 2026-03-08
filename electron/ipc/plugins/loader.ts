import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { app, net } from 'electron';
import type { PluginManifest, PluginWorkflow, InstalledPlugin, CatalogPlugin } from './types';

// ── Paths ───────────────────────────────────────────────────────────────────────

function getPluginsDir(): string {
  const dir = join(app.getPath('home'), '.config', 'agent-hub', 'plugins');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getRegistryPath(): string {
  return join(getPluginsDir(), 'installed.json');
}

function getRegistryDir(): string {
  // Plugin registry: all plugins live in user space, none are bundled with the app.
  // This directory can hold a local cache/catalog fetched from a remote registry.
  const dir = join(app.getPath('home'), '.config', 'agent-hub', 'plugins', '.registry');
  return dir;
}

// ── Loaders ─────────────────────────────────────────────────────────────────────

export function loadPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = join(pluginDir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
  } catch {
    console.error(`[plugins] Failed to parse plugin.json at ${pluginDir}`);
    return null;
  }
}

export function loadPluginWorkflow(pluginDir: string): PluginWorkflow | null {
  const workflowPath = join(pluginDir, 'manifest.json');
  if (!existsSync(workflowPath)) return null;
  try {
    return JSON.parse(readFileSync(workflowPath, 'utf-8')) as PluginWorkflow;
  } catch {
    console.error(`[plugins] Failed to parse manifest.json at ${pluginDir}`);
    return null;
  }
}

// ── Registry ────────────────────────────────────────────────────────────────────

export function getInstalledPlugins(): InstalledPlugin[] {
  const registryPath = getRegistryPath();
  if (!existsSync(registryPath)) return [];
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8')) as InstalledPlugin[];
  } catch {
    return [];
  }
}

export function saveInstalledPlugins(plugins: InstalledPlugin[]): void {
  const registryPath = getRegistryPath();
  const dir = join(registryPath, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const { writeFileSync } = require('fs');
  writeFileSync(registryPath, JSON.stringify(plugins, null, 2), 'utf-8');
}

// ── Catalog Sanitization ────────────────────────────────────────────────────────

function sanitizeString(input: string): string {
  return input.replace(/<\/?[^>]+(>|$)/g, '').trim();
}

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const PLUGIN_ID_PATTERN = /^[a-z0-9-]+$/;

function validateCatalogEntry(entry: unknown): CatalogPlugin | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;

  // Required fields
  if (typeof e.id !== 'string' || !PLUGIN_ID_PATTERN.test(e.id)) return null;
  if (typeof e.name !== 'string' || !e.name) return null;
  if (typeof e.version !== 'string' || !e.version) return null;
  if (typeof e.downloadUrl !== 'string' || !isValidHttpsUrl(e.downloadUrl)) return null;

  return {
    id: e.id,
    name: sanitizeString(e.name),
    version: sanitizeString(e.version),
    description: typeof e.description === 'string' ? sanitizeString(e.description) : '',
    author: typeof e.author === 'string' ? sanitizeString(e.author) : '',
    capabilities: Array.isArray(e.capabilities) ? e.capabilities.filter((c): c is string => typeof c === 'string') : [],
    level: (e.level === 1 || e.level === 2) ? e.level : 1,
    source: e.source === 'official' ? 'official' : 'community',
    icon: typeof e.icon === 'string' ? sanitizeString(e.icon) : undefined,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string').map(sanitizeString) : undefined,
    category: typeof e.category === 'string' ? sanitizeString(e.category) : undefined,
    downloadUrl: e.downloadUrl,
    homepage: typeof e.homepage === 'string' && isValidHttpsUrl(e.homepage) ? e.homepage : undefined,
    license: typeof e.license === 'string' ? sanitizeString(e.license) : undefined,
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : undefined,
    downloads: typeof e.downloads === 'number' ? e.downloads : undefined,
    sha256: typeof e.sha256 === 'string' ? e.sha256 : undefined,
  } as CatalogPlugin;
}

// ── Registry Catalog ─────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY_URL = process.env.PLUGIN_REGISTRY_URL
  || 'https://raw.githubusercontent.com/ocasti/agent-hub-dev/main/plugin-registry/catalog.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachePath(): string {
  const dir = getRegistryDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'catalog.json');
}

function isCacheValid(): boolean {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return false;
  try {
    const stats = statSync(cachePath);
    return Date.now() - stats.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function readCachedCatalog(): CatalogPlugin[] {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return [];
  try {
    return JSON.parse(readFileSync(cachePath, 'utf-8')) as CatalogPlugin[];
  } catch {
    return [];
  }
}

function writeCatalogCache(catalog: CatalogPlugin[]): void {
  const cachePath = getCachePath();
  writeFileSync(cachePath, JSON.stringify(catalog, null, 2), 'utf-8');
}

function fetchRemoteCatalog(url: string): Promise<CatalogPlugin[]> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    let data = '';

    request.on('response', (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers['location'];
        if (redirectUrl) {
          const target = Array.isArray(redirectUrl) ? redirectUrl[0] : redirectUrl;
          fetchRemoteCatalog(target).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Registry returned status ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk) => { data += chunk.toString(); });
      response.on('end', () => {
        try {
          const raw = JSON.parse(data) as unknown[];
          if (!Array.isArray(raw)) {
            reject(new Error('Catalog is not an array'));
            return;
          }
          const catalog = raw
            .map(validateCatalogEntry)
            .filter((e): e is CatalogPlugin => e !== null);
          resolve(catalog);
        } catch (err) {
          reject(new Error(`Failed to parse catalog JSON: ${err}`));
        }
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

function readBundledCatalog(): CatalogPlugin[] {
  try {
    const bundledPath = join(app.getAppPath(), 'plugins', 'registry', 'catalog.json');
    if (existsSync(bundledPath)) {
      const raw = JSON.parse(readFileSync(bundledPath, 'utf-8'));
      if (Array.isArray(raw)) {
        return raw
          .map(validateCatalogEntry)
          .filter((e): e is CatalogPlugin => e !== null);
      }
    }
  } catch { /* ignore */ }
  return [];
}

function mergeCatalogs(primary: CatalogPlugin[], secondary: CatalogPlugin[]): CatalogPlugin[] {
  const ids = new Set(primary.map((p) => p.id));
  const merged = [...primary];
  for (const entry of secondary) {
    if (!ids.has(entry.id)) {
      merged.push(entry);
    }
  }
  return merged;
}

export async function getRegistryCatalog(
  registryUrl?: string,
  forceRefresh = false
): Promise<CatalogPlugin[]> {
  const url = registryUrl || DEFAULT_REGISTRY_URL;
  const bundled = readBundledCatalog();

  if (!forceRefresh && isCacheValid()) {
    const cached = readCachedCatalog();
    if (cached.length > 0) return mergeCatalogs(cached, bundled);
  }

  try {
    const catalog = await fetchRemoteCatalog(url);
    if (catalog.length > 0) {
      writeCatalogCache(catalog);
      return mergeCatalogs(catalog, bundled);
    }
  } catch (err) {
    console.error('[plugins] Failed to fetch remote catalog:', err);
    const cached = readCachedCatalog();
    if (cached.length > 0) {
      console.log('[plugins] Using expired cache as fallback');
      return mergeCatalogs(cached, bundled);
    }
  }

  // Bundled catalog is the last resort (always available offline)
  if (bundled.length > 0) {
    console.log('[plugins] Using bundled catalog');
  }
  return bundled;
}

// ── Load All ────────────────────────────────────────────────────────────────────

export function loadAllPlugins(): InstalledPlugin[] {
  const installed = getInstalledPlugins();

  // Load manifests for installed plugins
  for (const plugin of installed) {
    if (!plugin.manifest) {
      plugin.manifest = loadPluginManifest(plugin.pluginDir) || undefined;
    }
    if (!plugin.workflow) {
      plugin.workflow = loadPluginWorkflow(plugin.pluginDir) || undefined;
    }
  }

  return installed;
}
