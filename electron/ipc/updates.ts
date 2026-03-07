import type { IpcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { autoUpdater } from 'electron-updater';

// ── Configuration ────────────────────────────────────────────────────────────────

export function registerUpdateHandlers(
  ipcMain: IpcMain,
  db: Database.Database,
  getWindow: () => BrowserWindow | null
) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Helper to read settings
  function getSetting(key: string): string {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  }

  function setSetting(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  // ── Forward autoUpdater events to renderer ───────────────────────────────────

  autoUpdater.on('update-available', (info) => {
    const skipped = getSetting('update_skipped_version');
    if (skipped && info.version === skipped) return;

    getWindow()?.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate || new Date().toISOString(),
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
          : '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    getWindow()?.webContents.send('update:not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    getWindow()?.webContents.send('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('update:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate || new Date().toISOString(),
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : '',
    });
  });

  autoUpdater.on('error', (err) => {
    getWindow()?.webContents.send('update:error', err.message);
  });

  // ── IPC handlers ─────────────────────────────────────────────────────────────

  ipcMain.handle('update:check', async () => {
    setSetting('update_last_check', new Date().toISOString());
    await autoUpdater.checkForUpdates();
  });

  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle('update:skip', (_event, version: string) => {
    setSetting('update_skipped_version', version);
  });

  // ── Scheduled checks ────────────────────────────────────────────────────────

  // Check every 4 hours if auto-check is enabled
  setInterval(() => {
    const autoCheck = getSetting('update_auto_check');
    if (autoCheck !== 'false') {
      setSetting('update_last_check', new Date().toISOString());
      autoUpdater.checkForUpdates().catch(() => {});
    }
  }, 4 * 60 * 60 * 1000);

  // Initial check 10s after startup
  setTimeout(() => {
    const autoCheck = getSetting('update_auto_check');
    if (autoCheck !== 'false') {
      setSetting('update_last_check', new Date().toISOString());
      autoUpdater.checkForUpdates().catch(() => {});
    }
  }, 10000);
}
