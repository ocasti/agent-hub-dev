import { Notification, IpcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import path from 'path';

// ── Notification Keys ────────────────────────────────────────────────────────

export type NotificationKey =
  | 'spec_needs_input'
  | 'plan_ready'
  | 'quality_pass'
  | 'quality_fail'
  | 'pr_created'
  | 'pr_changes_requested'
  | 'push_review'
  | 'task_complete'
  | 'pr_fix_pushed'
  | 'workflow_failed'
  | 'workflow_aborted'
  | 'regression_detected'
  | 'max_review_loops'
  | 'tests_failing';

export const ALL_NOTIFICATION_KEYS: NotificationKey[] = [
  'spec_needs_input',
  'plan_ready',
  'quality_pass',
  'quality_fail',
  'pr_created',
  'pr_changes_requested',
  'push_review',
  'task_complete',
  'pr_fix_pushed',
  'workflow_failed',
  'workflow_aborted',
  'regression_detected',
  'max_review_loops',
  'tests_failing',
];

// ── Defaults (all enabled) ──────────────────────────────────────────────────

const SETTINGS_KEY = 'notifications_config';

interface NotificationsConfig {
  enabled: boolean;
  keys: Record<NotificationKey, boolean>;
}

function getDefaultConfig(): NotificationsConfig {
  const keys = {} as Record<NotificationKey, boolean>;
  for (const k of ALL_NOTIFICATION_KEYS) keys[k] = true;
  return { enabled: true, keys };
}

function getConfig(db: Database.Database): NotificationsConfig {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row?.value) return getDefaultConfig();
  try {
    const parsed = JSON.parse(row.value) as Partial<NotificationsConfig>;
    const defaults = getDefaultConfig();
    return {
      enabled: parsed.enabled ?? defaults.enabled,
      keys: { ...defaults.keys, ...(parsed.keys || {}) },
    };
  } catch {
    return getDefaultConfig();
  }
}

function saveConfig(db: Database.Database, config: NotificationsConfig): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, JSON.stringify(config));
}

// ── Send Notification ───────────────────────────────────────────────────────

let _db: Database.Database;
let _getWindow: () => BrowserWindow | null;

export function initNotifications(db: Database.Database, getWindow: () => BrowserWindow | null): void {
  _db = db;
  _getWindow = getWindow;
}

export function sendNotification(
  key: NotificationKey,
  title: string,
  body: string,
): void {
  if (!_db || !Notification.isSupported()) return;

  const config = getConfig(_db);
  if (!config.enabled || !config.keys[key]) return;

  // Only notify when window is not focused
  const win = _getWindow?.();
  if (win && win.isFocused()) return;

  const notification = new Notification({
    title,
    body,
    icon: path.join(__dirname, '../../public/icon.png'),
    silent: false,
  });

  // Click notification → focus window
  notification.on('click', () => {
    const w = _getWindow?.();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  notification.show();
}

// ── IPC Handlers ────────────────────────────────────────────────────────────

export function registerNotificationHandlers(ipcMain: IpcMain, db: Database.Database): void {
  ipcMain.handle('notifications:getConfig', () => {
    return getConfig(db);
  });

  ipcMain.handle('notifications:updateConfig', (_event, config: NotificationsConfig) => {
    saveConfig(db, config);
  });
}
