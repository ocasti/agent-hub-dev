import { type IpcMain, BrowserWindow, app } from 'electron';
import type Database from 'better-sqlite3';
import { autoUpdater } from 'electron-updater';
import { gt } from 'semver';

/** Strip HTML tags and decode common entities from release notes */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Configuration ────────────────────────────────────────────────────────────────

export function registerUpdateHandlers(
  ipcMain: IpcMain,
  db: Database.Database,
  getWindow: () => BrowserWindow | null
) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (msg: unknown) => console.log('[updater]', msg),
    warn: (msg: unknown) => console.warn('[updater]', msg),
    error: (msg: unknown) => console.error('[updater]', msg),
    debug: (msg: unknown) => console.log('[updater:debug]', msg),
  };

  // Helper to read settings
  function getSetting(key: string): string {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value || '';
  }

  function setSetting(key: string, value: string): void {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  /** Send a log entry visible in the app's Logs tab */
  function sendUpdateLog(message: string, kind: 'info' | 'ok' | 'error' = 'info') {
    console.log(`[updater] ${message}`);
    const win = getWindow();
    if (win) {
      win.webContents.send('agent:log', { taskId: '__system__', projectName: 'Auto-Updater', message, kind });
    }
    // Also persist to DB so it survives restarts
    // Note: id is INTEGER PRIMARY KEY AUTOINCREMENT — do NOT pass it, let SQLite handle it
    // task_id is NULL to avoid FK constraint (no task associated)
    try {
      db.prepare('INSERT INTO logs (task_id, project_name, message, kind, created_at) VALUES (NULL, ?, ?, ?, ?)')
        .run('Auto-Updater', message, kind, new Date().toISOString());
    } catch { /* logs table might not exist yet */ }
  }

  // ── Forward autoUpdater events to renderer ───────────────────────────────────

  autoUpdater.on('update-available', (info) => {
    sendUpdateLog(`Update available: v${info.version}`);
    const skipped = getSetting('update_skipped_version');
    // Only skip if the skipped version matches exactly; if a newer version
    // is available, clear the skipped flag and show the alert
    if (skipped) {
      try {
        if (gt(info.version, skipped)) {
          setSetting('update_skipped_version', '');
        } else if (info.version === skipped) {
          return;
        }
      } catch {
        // Invalid semver — ignore skip logic
      }
    }

    const rawNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
        : '';

    getWindow()?.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate || new Date().toISOString(),
      releaseNotes: stripHtml(rawNotes),
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateLog(`Already up to date (v${info.version})`);
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
    sendUpdateLog(`Update v${info.version} downloaded and ready to install`, 'ok');
    getWindow()?.webContents.send('update:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate || new Date().toISOString(),
      releaseNotes: stripHtml(
        typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
      ),
    });
  });

  autoUpdater.on('error', (err) => {
    sendUpdateLog(`Update error: ${err.message}`, 'error');
    getWindow()?.webContents.send('update:error', err.message);
  });

  // ── IPC handlers ─────────────────────────────────────────────────────────────

  ipcMain.handle('update:check', async () => {
    setSetting('update_last_check', new Date().toISOString());
    try {
      sendUpdateLog('Checking for updates...');
      const result = await autoUpdater.checkForUpdates();
      return { version: result?.updateInfo?.version || null };
    } catch (err) {
      sendUpdateLog(`Check failed: ${(err as Error).message}`, 'error');
      getWindow()?.webContents.send('update:error', (err as Error).message);
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    sendUpdateLog(`Installing update... (platform: ${process.platform})`);
    // Defer to next tick so the IPC response reaches the renderer before quit
    setImmediate(() => {
      // Remove all listeners that could block the quit sequence
      app.removeAllListeners('window-all-closed');
      BrowserWindow.getAllWindows().forEach((win) => {
        win.removeAllListeners('close');
      });

      if (process.platform === 'darwin') {
        // On macOS, quitAndInstall() delegates to Squirrel/ShipIt which requires
        // proper Apple code signing. With ad-hoc signing it silently does nothing.
        // Instead, rely on autoInstallOnAppQuit (which is true by default) —
        // electron-updater applies the update during the before-quit event.
        // Then relaunch the app so the user gets the new version immediately.
        sendUpdateLog('macOS: relaunch + quit (autoInstallOnAppQuit will apply update)');
        app.relaunch();
        app.quit();
      } else {
        // On Windows/Linux, quitAndInstall works reliably
        try {
          sendUpdateLog('Calling quitAndInstall...');
          autoUpdater.quitAndInstall(false, true);
        } catch (err) {
          sendUpdateLog(`quitAndInstall failed: ${(err as Error).message}`, 'error');
          app.relaunch();
          app.quit();
        }
      }
    });
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
