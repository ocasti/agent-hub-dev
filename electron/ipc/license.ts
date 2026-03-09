import type { IpcMain } from 'electron';
import { app, net } from 'electron';
import type Database from 'better-sqlite3';

// ── Constants ────────────────────────────────────────────────────────────────────

export type TierName = 'free' | 'registered' | 'premium';

export interface LicenseLimits {
  max_projects: number;
  max_concurrent: number;
  can_configure_agents: boolean;
  max_review_loops: number;
  can_configure_review_loops: boolean;
  models: string[];
  max_knowledge: number;
  community_plugins: boolean;
  max_parallel_per_project: number;
  /** 'global_only' = one agent for all projects, 'per_project' = override per project, 'per_phase' = per-phase primary+fallback */
  multi_agent_mode: 'global_only' | 'per_project' | 'per_phase';
}

const TIER_LIMITS: Record<TierName, LicenseLimits> = {
  free: {
    max_projects: 2,
    max_concurrent: 1,
    can_configure_agents: false,
    max_review_loops: 2,
    can_configure_review_loops: false,
    models: ['sonnet'],
    max_knowledge: 20,
    community_plugins: false,
    max_parallel_per_project: 1,
    multi_agent_mode: 'global_only',
  },
  registered: {
    max_projects: 5,
    max_concurrent: 2,
    can_configure_agents: false,
    max_review_loops: 3,
    can_configure_review_loops: false,
    models: ['sonnet'],
    max_knowledge: 50,
    community_plugins: true,
    max_parallel_per_project: 1,
    multi_agent_mode: 'per_project',
  },
  premium: {
    max_projects: 999999,
    max_concurrent: 10,
    can_configure_agents: true,
    max_review_loops: 20,
    can_configure_review_loops: true,
    models: ['sonnet', 'opus'],
    max_knowledge: 999999,
    community_plugins: true,
    max_parallel_per_project: 3,
    multi_agent_mode: 'per_phase',
  },
};

export const FREE_LIMITS: LicenseLimits = TIER_LIMITS.free;

const API_BASE = process.env.API_BASE_URL || 'https://integral-apps.cloud/wp-json/agent-hub/v1';
const OFFLINE_GRACE_DAYS = 7;
const TOKEN_REFRESH_DAYS = 25; // Refresh before 30-day expiry

// ── HTTP helper using Electron net ───────────────────────────────────────────────

interface AuthApiResponse {
  token?: string;
  user_id?: number;
  username?: string;
  email?: string;
  tier?: TierName;
  limits?: {
    max_projects: number;
    max_agents: number;
    can_configure_agents: boolean;
  };
  code?: string;
  message?: string;
}

function apiRequest(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: Record<string, string>,
  bearerToken?: string
): Promise<AuthApiResponse> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}${endpoint}`;

    const request = net.request({ method, url });
    request.setHeader('Content-Type', 'application/json');
    request.setHeader('Accept', 'application/json');

    if (bearerToken) {
      request.setHeader('Authorization', `Bearer ${bearerToken}`);
    }

    let responseData = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        responseData += chunk.toString();
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseData) as AuthApiResponse;
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(parsed.message || `API error: ${response.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Invalid response from server'));
        }
      });
    });

    request.on('error', (err) => {
      reject(new Error(`Server unreachable: ${err.message}`));
    });

    if (body && method === 'POST') {
      request.write(JSON.stringify(body));
    }
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

function getTier(db: Database.Database): TierName {
  const tier = getSettingValue(db, 'license_plan') as TierName;
  if (tier && TIER_LIMITS[tier]) return tier;
  return 'free';
}

function getLimitsForTier(tier: TierName): LicenseLimits {
  return TIER_LIMITS[tier] || TIER_LIMITS.free;
}

function getCachedLimits(db: Database.Database): LicenseLimits {
  const tier = getTier(db);
  if (tier === 'free') return TIER_LIMITS.free;

  // Check offline grace period for authenticated tiers
  const cachedAt = getSettingValue(db, 'license_cached_at');
  if (cachedAt) {
    const ageMs = Date.now() - new Date(cachedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > OFFLINE_GRACE_DAYS) {
      return TIER_LIMITS.free;
    }
  }

  return getLimitsForTier(tier);
}

function saveAuthToDb(db: Database.Database, response: AuthApiResponse): void {
  if (response.token) setSettingValue(db, 'license_key', response.token); // Reuse key field for JWT
  if (response.email) setSettingValue(db, 'license_email', response.email);
  if (response.username) setSettingValue(db, 'license_username', response.username);
  if (response.tier) {
    setSettingValue(db, 'license_plan', response.tier);
    setSettingValue(db, 'license_status', response.tier);
    setSettingValue(db, 'license_limits', JSON.stringify(getLimitsForTier(response.tier)));
  }
  setSettingValue(db, 'license_cached_at', new Date().toISOString());
}

function clearAuth(db: Database.Database): void {
  setSettingValue(db, 'license_key', '');
  setSettingValue(db, 'license_status', 'free');
  setSettingValue(db, 'license_plan', 'free');
  setSettingValue(db, 'license_email', '');
  setSettingValue(db, 'license_username', '');
  setSettingValue(db, 'license_cached_at', '');
  setSettingValue(db, 'license_limits', JSON.stringify(TIER_LIMITS.free));
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
  if (!limits.can_configure_agents) {
    // Free and registered: fixed concurrent limit, not configurable
    return limits.max_concurrent;
  }
  // Premium: user can configure, but capped at tier max
  const userSetting = parseInt(getSettingValue(db, 'max_concurrent') || '3', 10);
  return Math.min(userSetting, limits.max_concurrent);
}

export function getEffectiveMaxReviewLoops(db: Database.Database): number {
  const limits = getCachedLimits(db);
  if (!limits.can_configure_review_loops) {
    return limits.max_review_loops;
  }
  const userSetting = parseInt(getSettingValue(db, 'max_review_loops') || '5', 10);
  return Math.min(userSetting, limits.max_review_loops);
}

export function getMaxParallelPerProject(db: Database.Database): number {
  const limits = getCachedLimits(db);
  if (limits.max_parallel_per_project <= 1) return 1; // Free/Registered — not configurable
  // Premium: user can configure, capped at tier max
  const userSetting = parseInt(getSettingValue(db, 'max_parallel_per_project') || '3', 10);
  return Math.min(Math.max(1, userSetting), limits.max_parallel_per_project);
}

export function canInstallCommunityPlugin(db: Database.Database): boolean {
  const limits = getCachedLimits(db);
  return limits.community_plugins;
}

// ── IPC Registration ─────────────────────────────────────────────────────────────

export function registerLicenseHandlers(ipcMain: IpcMain, db: Database.Database) {

  // Login with username/password → returns JWT + tier
  ipcMain.handle('license:login', async (_event, username: string, password: string) => {
    const response = await apiRequest('POST', '/auth', { username, password });

    saveAuthToDb(db, response);

    const tier = (response.tier || 'registered') as TierName;
    return {
      plan: tier,
      limits: getLimitsForTier(tier),
      username: response.username || username,
      email: response.email || '',
    };
  });

  // Register new user → returns JWT + tier
  ipcMain.handle('license:register', async (_event, username: string, email: string, password: string) => {
    const response = await apiRequest('POST', '/register', { username, email, password });

    saveAuthToDb(db, response);

    const tier = (response.tier || 'registered') as TierName;
    return {
      plan: tier,
      limits: getLimitsForTier(tier),
      username: response.username || username,
      email: response.email || email,
    };
  });

  // Validate current token (called on app startup)
  ipcMain.handle('license:validate', async () => {
    const token = getSettingValue(db, 'license_key');
    if (!token) {
      return { plan: 'free', limits: TIER_LIMITS.free };
    }

    try {
      const response = await apiRequest('GET', '/me', undefined, token);

      saveAuthToDb(db, { ...response, token });

      // Check if token needs refresh (approaching expiry)
      const cachedAt = getSettingValue(db, 'license_cached_at');
      if (cachedAt) {
        const ageMs = Date.now() - new Date(cachedAt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays > TOKEN_REFRESH_DAYS) {
          try {
            const refreshed = await apiRequest('POST', '/refresh', undefined, token);
            if (refreshed.token) {
              saveAuthToDb(db, refreshed);
            }
          } catch {
            // Token refresh failed — continue with current token
          }
        }
      }

      const tier = (response.tier || 'registered') as TierName;
      return {
        plan: tier,
        limits: getLimitsForTier(tier),
        username: response.username || '',
        email: response.email || '',
      };
    } catch {
      // Offline or invalid token → return cached data with grace period
      const cachedTier = getTier(db);
      const cachedLimits = getCachedLimits(db);
      return {
        plan: cachedTier,
        limits: cachedLimits,
        username: getSettingValue(db, 'license_username'),
        email: getSettingValue(db, 'license_email'),
      };
    }
  });

  // Logout — clear all auth data locally
  ipcMain.handle('license:logout', async () => {
    clearAuth(db);
  });

  // Deactivate (alias for logout — kept for backward compat)
  ipcMain.handle('license:deactivate', async () => {
    clearAuth(db);
  });

  // Get cached limits
  ipcMain.handle('license:getLimits', () => {
    return getCachedLimits(db);
  });

  // Legacy: license:activate redirects to login hint
  ipcMain.handle('license:activate', async () => {
    throw new Error('License keys are no longer supported. Please login with your account.');
  });
}
