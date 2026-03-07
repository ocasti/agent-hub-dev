import { existsSync, mkdirSync, writeFileSync, rmSync, createWriteStream, readFileSync } from 'fs';
import { join, normalize } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { app, net } from 'electron';
import { execFile } from 'child_process';
import * as tar from 'tar';
import { satisfies } from 'semver';
import type { ConfigField, InstalledPlugin, PluginManifest, PluginSetup, CatalogPlugin } from './types';
import { getInstalledPlugins, saveInstalledPlugins, loadPluginManifest, loadPluginWorkflow } from './loader';

// ── A1: Command Execution Whitelist ──────────────────────────────────────────────

const ALLOWED_COMMAND_PREFIXES = [
  'claude mcp add',
  'claude mcp remove',
  'claude mcp list',
  'gh --version',
  'gh auth status',
  'glab --version',
  'glab auth status',
  'git --version',
  'node --version',
];

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  return ALLOWED_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// ── A2: Tarball Path Traversal Protection ────────────────────────────────────────

const ALLOWED_PLUGIN_FILE_EXTENSIONS = new Set([
  '.json', '.js', '.ts', '.md', '.svg', '.png', '.txt', '.yml', '.yaml',
]);

async function safeExtractTarball(tarPath: string, destDir: string): Promise<void> {
  await tar.extract({
    file: tarPath,
    cwd: destDir,
    strip: 1,
    filter: (entryPath) => {
      // Block path traversal
      const normalized = normalize(entryPath);
      if (normalized.includes('..')) return false;

      // Allow directories
      if (entryPath.endsWith('/')) return true;

      // Check file extension
      const dotIdx = entryPath.lastIndexOf('.');
      if (dotIdx === -1) return false;
      const ext = entryPath.slice(dotIdx).toLowerCase();
      return ALLOWED_PLUGIN_FILE_EXTENSIONS.has(ext);
    },
  });
}

// ── A3: Download URL Validation ──────────────────────────────────────────────────

const ALLOWED_DOWNLOAD_DOMAINS = [
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
];

const MAX_REDIRECT_DEPTH = 3;
const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50 MB

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return ALLOWED_DOWNLOAD_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

// ── A6: SHA-256 Checksum Verification ────────────────────────────────────────────

function verifyChecksum(filePath: string, expectedHash: string): void {
  const fileBuffer = readFileSync(filePath);
  const actual = createHash('sha256').update(fileBuffer).digest('hex');
  if (actual !== expectedHash) {
    throw new Error(
      `Checksum mismatch: expected ${expectedHash}, got ${actual}`
    );
  }
}

// ── Install ─────────────────────────────────────────────────────────────────────

export async function installPlugin(
  pluginId: string,
  config: Record<string, string>
): Promise<void> {
  const installed = getInstalledPlugins();
  const existing = installed.find((p) => p.id === pluginId);
  if (existing) {
    throw new Error(`Plugin "${pluginId}" is already installed`);
  }

  const pluginDir = join(app.getPath('home'), '.config', 'agent-hub', 'plugins', pluginId);
  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true });
  }

  const manifest = loadPluginManifest(pluginDir);

  const entry: InstalledPlugin = {
    id: pluginId,
    version: manifest?.version || '0.0.0',
    enabled: true,
    config,
    source: 'community',
    installedAt: new Date().toISOString(),
    pluginDir,
    manifest: manifest || undefined,
    workflow: loadPluginWorkflow(pluginDir) || undefined,
  };

  installed.push(entry);
  saveInstalledPlugins(installed);
}

// ── Uninstall ───────────────────────────────────────────────────────────────────

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const installed = getInstalledPlugins();
  const idx = installed.findIndex((p) => p.id === pluginId);
  if (idx === -1) return;

  const plugin = installed[idx];

  // Remove plugin directory
  if (existsSync(plugin.pluginDir)) {
    rmSync(plugin.pluginDir, { recursive: true, force: true });
  }

  installed.splice(idx, 1);
  saveInstalledPlugins(installed);
}

// ── Config ──────────────────────────────────────────────────────────────────────

export async function updatePluginConfig(
  pluginId: string,
  config: Record<string, string>
): Promise<void> {
  const installed = getInstalledPlugins();
  const plugin = installed.find((p) => p.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" is not installed`);
  }

  plugin.config = { ...plugin.config, ...config };
  saveInstalledPlugins(installed);
}

// ── Plugin Compatibility ─────────────────────────────────────────────────────────

export function checkPluginCompatibility(manifest: PluginManifest): { compatible: boolean; reason?: string } {
  const appVersion = app.getVersion();

  if (manifest.requires?.agentHub) {
    try {
      if (!satisfies(appVersion, manifest.requires.agentHub)) {
        return {
          compatible: false,
          reason: `Requires Agent Hub ${manifest.requires.agentHub}, current version is ${appVersion}`,
        };
      }
    } catch {
      return {
        compatible: false,
        reason: `Invalid semver range: ${manifest.requires.agentHub}`,
      };
    }
  }

  return { compatible: true };
}

// ── Validation ──────────────────────────────────────────────────────────────────

export function validateConfig(
  schema: ConfigField[],
  config: Record<string, string>
): string[] {
  const errors: string[] = [];
  for (const field of schema) {
    if (field.required && !config[field.key]) {
      errors.push(`"${field.label}" is required`);
    }
  }
  return errors;
}

// ── MCP Setup (A1: hardened) ─────────────────────────────────────────────────────

export async function executeMcpSetup(setup: PluginSetup): Promise<void> {
  for (const step of setup.steps) {
    switch (step.type) {
      case 'mcp_add': {
        if (!step.command) continue;
        if (!step.command.trim().startsWith('claude mcp')) {
          throw new Error(`Blocked: mcp_add commands must start with "claude mcp". Got: ${step.command}`);
        }
        if (!isCommandAllowed(step.command)) {
          throw new Error(`Blocked: command not in whitelist: ${step.command}`);
        }
        await execCommand(step.command);
        break;
      }
      case 'cli_check': {
        if (!step.command) continue;
        // cli_check must match "<tool> --version" or "<tool> auth status"
        if (!isCommandAllowed(step.command)) {
          throw new Error(`Blocked: cli_check command not in whitelist: ${step.command}`);
        }
        try {
          await execCommand(step.command);
        } catch {
          throw new Error(`Required CLI tool not found: ${step.description}`);
        }
        break;
      }
      case 'config_write': {
        // Write config files if needed
        break;
      }
    }
  }
}

function execCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isCommandAllowed(command)) {
      reject(new Error(`Blocked: command not in whitelist: ${command}`));
      return;
    }
    const [cmd, ...args] = command.split(' ');
    execFile(cmd, args, { timeout: 30000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

// ── Download helpers (A3: hardened) ──────────────────────────────────────────────

function downloadFile(url: string, destPath: string, depth = 0): Promise<void> {
  if (!isUrlAllowed(url)) {
    return Promise.reject(new Error(`Blocked: download URL not allowed: ${url}`));
  }
  if (depth > MAX_REDIRECT_DEPTH) {
    return Promise.reject(new Error(`Too many redirects (max ${MAX_REDIRECT_DEPTH})`));
  }

  return new Promise((resolve, reject) => {
    const request = net.request(url);
    let totalBytes = 0;

    request.on('response', (response) => {
      // Follow redirects (GitHub releases → CDN)
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers['location'];
        if (redirectUrl) {
          const target = Array.isArray(redirectUrl) ? redirectUrl[0] : redirectUrl;
          downloadFile(target, destPath, depth + 1).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destPath);
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_DOWNLOAD_SIZE) {
          file.destroy();
          reject(new Error(`Download exceeds maximum size of ${MAX_DOWNLOAD_SIZE} bytes`));
          return;
        }
        file.write(chunk);
      });
      response.on('end', () => {
        file.end();
        file.on('finish', resolve);
      });
      response.on('error', (err) => {
        file.destroy();
        reject(err);
      });
    });

    request.on('error', reject);
    request.end();
  });
}

// ── Download & Install from Catalog (A2, A3, A6: hardened) ───────────────────────

export async function downloadAndInstallPlugin(
  catalogEntry: CatalogPlugin,
  config: Record<string, string>
): Promise<void> {
  const pluginDir = join(app.getPath('home'), '.config', 'agent-hub', 'plugins', catalogEntry.id);
  const tempPath = join(tmpdir(), `agent-hub-plugin-${catalogEntry.id}-${Date.now()}.tar.gz`);

  // If already installed with different version, uninstall first (preserves config)
  const installed = getInstalledPlugins();
  const existing = installed.find((p) => p.id === catalogEntry.id);
  if (existing) {
    if (existing.version === catalogEntry.version) {
      throw new Error(`Plugin "${catalogEntry.id}" v${catalogEntry.version} is already installed`);
    }
    // Update: remove old version first
    await uninstallPlugin(catalogEntry.id);
  }

  try {
    // Download tarball (A3: validated URL + size limit)
    await downloadFile(catalogEntry.downloadUrl, tempPath);

    // A6: Verify checksum if provided
    if (catalogEntry.sha256) {
      verifyChecksum(tempPath, catalogEntry.sha256);
    }

    // Prepare target directory
    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true });
    }

    // A2: Safe extraction with path traversal + extension filtering
    await safeExtractTarball(tempPath, pluginDir);

    // Verify plugin.json exists
    const pluginJsonPath = join(pluginDir, 'plugin.json');
    if (!existsSync(pluginJsonPath)) {
      rmSync(pluginDir, { recursive: true, force: true });
      throw new Error('Invalid plugin: plugin.json not found in archive');
    }

    // Load manifest and workflow
    const manifest = loadPluginManifest(pluginDir);
    const workflow = loadPluginWorkflow(pluginDir);

    // Check compatibility before registering
    if (manifest) {
      const compat = checkPluginCompatibility(manifest);
      if (!compat.compatible) {
        rmSync(pluginDir, { recursive: true, force: true });
        throw new Error(`Plugin incompatible: ${compat.reason}`);
      }
    }

    // Register in installed.json
    const entry: InstalledPlugin = {
      id: catalogEntry.id,
      version: catalogEntry.version,
      enabled: true,
      config,
      source: catalogEntry.source,
      installedAt: new Date().toISOString(),
      pluginDir,
      manifest: manifest || undefined,
      workflow: workflow || undefined,
    };

    const currentInstalled = getInstalledPlugins();
    currentInstalled.push(entry);
    saveInstalledPlugins(currentInstalled);

    // Execute setup.json if present
    const setupPath = join(pluginDir, 'setup.json');
    if (existsSync(setupPath)) {
      try {
        const setup = JSON.parse(readFileSync(setupPath, 'utf-8')) as PluginSetup;
        await executeMcpSetup(setup);
      } catch (err) {
        console.error(`[plugins] Setup execution failed for ${catalogEntry.id}:`, err);
      }
    }
  } finally {
    // Clean up temp tarball
    if (existsSync(tempPath)) {
      try { rmSync(tempPath); } catch { /* ignore */ }
    }
  }
}
