import type { IpcMain } from 'electron';
import { app, net } from 'electron';
import { createHash } from 'crypto';
import { hostname, userInfo, platform } from 'os';
import type Database from 'better-sqlite3';

// ── Constants ────────────────────────────────────────────────────────────────────

export interface LicenseLimits {
  max_projects: number;
  max_concurrent: number;
  models: string[];
  max_knowledge: number;
  community_plugins: boolean;
}

export const FREE_LIMITS: LicenseLimits = {
  max_projects: 3,
  max_concurrent: 1,
  models: ['sonnet'],
  max_knowledge: 20,
  community_plugins: false,
};

const LICENSE_API_BASE = 'https://agenthub.app/wp-json/agent-hub/v1';
const OFFLINE_GRACE_DAYS = 7;

// ── Machine ID ───────────────────────────────────────────────────────────────────

function getMachineId(): string {
  const raw = `${hostname()}:${userInfo().username}:${platform()}`;
  return createHash('sha256').update(raw).digest('hex');
}

// ── HTTP helper using Electron net ───────────────────────────────────────────────

interface LicenseApiResponse {
  status?: string;
  plan?: string;
  email?: string;
  limits?: LicenseLimits;
  error?: string;
}

function licenseRequest(endpoint: string, body: Record<string, string>): Promise<LicenseApiResponse> {
  return new Promise((resolve, reject) => {
    const url = `${LICENSE_API_BASE}${endpoint}`;
    const postData = JSON.stringify(body);

    const request = net.request({
      method: 'POST',
      url,
    });

    request.setHeader('Content-Type', 'application/json');

    let responseData = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseData) as LicenseApiResponse;
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(parsed.error || `License API error: ${response.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Invalid response from license server`));
        }
      });
    });

    request.on('error', (err) => {
      reject(new Error(`License server unreachable: ${err.message}`));
    });

    request.write(postData);
    request.end();
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────────

function getSettingValue(db: Database.Database, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value || '';
}

function setSettingValue(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getCachedLimits(db: Database.Database): LicenseLimits {
  const raw = getSettingValue(db, 'license_limits');
  if (!raw) return FREE_LIMITS;

  try {
    const limits = JSON.parse(raw) as LicenseLimits;

    // Check if cache is too old (offline grace period)
    const cachedAt = getSettingValue(db, 'license_cached_at');
    if (cachedAt) {
      const ageMs = Date.now() - new Date(cachedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > OFFLINE_GRACE_DAYS) {
        // Expired cache → fall back to free
        return FREE_LIMITS;
      }
    }

    return limits;
  } catch {
    return FREE_LIMITS;
  }
}

function saveLicenseToDb(
  db: Database.Database,
  response: LicenseApiResponse
): void {
  if (response.plan) setSettingValue(db, 'license_plan', response.plan);
  if (response.email) setSettingValue(db, 'license_email', response.email);
  if (response.status) setSettingValue(db, 'license_status', response.status);
  if (response.limits) {
    setSettingValue(db, 'license_limits', JSON.stringify(response.limits));
  }
  setSettingValue(db, 'license_cached_at', new Date().toISOString());
}

// ── Exported enforcement functions ───────────────────────────────────────────────

export function getLicenseLimits(db: Database.Database): LicenseLimits {
  return getCachedLimits(db);
}

export function canCreateProject(db: Database.Database): boolean {
  const limits = getCachedLimits(db);
  const row = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
  return row.count < limits.max_projects;
}

export function canUseModel(db: Database.Database, model: string): boolean {
  const limits = getCachedLimits(db);
  return limits.models.includes(model);
}

export function canCreateKnowledge(db: Database.Database): boolean {
  const limits = getCachedLimits(db);
  const row = db.prepare('SELECT COUNT(*) as count FROM knowledge_entries').get() as { count: number };
  return row.count < limits.max_knowledge;
}

export function getEffectiveMaxConcurrent(db: Database.Database): number {
  const limits = getCachedLimits(db);
  const userSetting = parseInt(getSettingValue(db, 'max_concurrent') || '3', 10);
  return Math.min(userSetting, limits.max_concurrent);
}

export function canInstallCommunityPlugin(db: Database.Database): boolean {
  const limits = getCachedLimits(db);
  return limits.community_plugins;
}

// ── IPC Registration ─────────────────────────────────────────────────────────────

export function registerLicenseHandlers(ipcMain: IpcMain, db: Database.Database) {

  ipcMain.handle('license:activate', async (_event, licenseKey: string) => {
    const machineId = getMachineId();
    const response = await licenseRequest('/activate', {
      license_key: licenseKey,
      machine_id: machineId,
      app_version: app.getVersion(),
      platform: platform(),
    });

    setSettingValue(db, 'license_key', licenseKey);
    saveLicenseToDb(db, response);

    return {
      plan: response.plan || 'free',
      limits: response.limits || FREE_LIMITS,
    };
  });

  ipcMain.handle('license:validate', async () => {
    const licenseKey = getSettingValue(db, 'license_key');
    if (!licenseKey) {
      return { plan: 'free', limits: FREE_LIMITS };
    }

    try {
      const machineId = getMachineId();
      const response = await licenseRequest('/validate', {
        license_key: licenseKey,
        machine_id: machineId,
      });

      saveLicenseToDb(db, response);

      return {
        plan: response.plan || 'free',
        limits: response.limits || FREE_LIMITS,
      };
    } catch {
      // Offline or server error → return cached limits (grace period handled in getCachedLimits)
      const cachedLimits = getCachedLimits(db);
      const cachedPlan = getSettingValue(db, 'license_plan') || 'free';
      return { plan: cachedPlan, limits: cachedLimits };
    }
  });

  ipcMain.handle('license:deactivate', async () => {
    const licenseKey = getSettingValue(db, 'license_key');
    if (licenseKey) {
      try {
        const machineId = getMachineId();
        await licenseRequest('/deactivate', {
          license_key: licenseKey,
          machine_id: machineId,
        });
      } catch {
        // Proceed with local deactivation even if server fails
      }
    }

    // Reset all license settings to free
    setSettingValue(db, 'license_key', '');
    setSettingValue(db, 'license_status', 'free');
    setSettingValue(db, 'license_plan', 'free');
    setSettingValue(db, 'license_email', '');
    setSettingValue(db, 'license_cached_at', '');
    setSettingValue(db, 'license_limits', JSON.stringify(FREE_LIMITS));
  });

  ipcMain.handle('license:getLimits', () => {
    return getCachedLimits(db);
  });
}
