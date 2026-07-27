import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, ipcMain, Menu, protocol, net, shell } from 'electron';
import path from 'path';
import { execFileSync } from 'child_process';

// Load .env from project root (works in dev and packaged builds)
dotenvConfig({ path: path.resolve(__dirname, '..', '.env') });
import { initDatabase } from './db/index';
import { registerProjectHandlers } from './ipc/projects';
import { registerTaskHandlers } from './ipc/tasks';
import { registerAgentHandlers } from './ipc/agent/index';
import { registerGithubHandlers } from './ipc/github';
import { registerSkillsHandlers } from './ipc/skills';
import { registerKnowledgeHandlers } from './ipc/knowledge';
import { registerDialogHandlers } from './ipc/dialog';
import { registerPluginHandlers } from './ipc/plugins/index';
import { registerLicenseHandlers, validateLicense } from './ipc/license';
import { registerUpdateHandlers } from './ipc/updates';
import { registerNotificationHandlers, initNotifications } from './ipc/notifications';
import { cleanOrphanWorktrees } from './ipc/agent/worktree';
import { shutdownAllAgents, reconcileInFlightTasks } from './ipc/agent/state';
import i18nMain from './i18n/index';

// ── Fix PATH for desktop apps launched from GUI ─────────────────────────────────
// When launched from Finder (macOS) or desktop launcher (Linux), process.env.PATH
// is minimal and won't include tools like claude, gh, git, node, etc.
// We resolve the user's full shell PATH on both platforms.
if ((process.platform === 'darwin' || process.platform === 'linux') && !process.env.VITE_DEV_SERVER_URL) {
  try {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const shellPath = execFileSync(shell, ['-ilc', 'echo -n $PATH'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (shellPath) {
      process.env.PATH = shellPath;
    }
  } catch {
    // Fallback: append common tool paths
    const extra = process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          `${process.env.HOME}/.local/bin`,
          `${process.env.HOME}/.nvm/versions/node`,
        ]
      : [
          '/usr/local/bin',
          `${process.env.HOME}/.local/bin`,
          `${process.env.HOME}/.nvm/versions/node`,
          `${process.env.HOME}/.npm-global/bin`,
          '/snap/bin',
        ];
    process.env.PATH = `${process.env.PATH}:${extra.join(':')}`;
  }
}

const APP_NAME = 'Agent Hub';

/** Protocol of a URL, or '' when it doesn't parse. Never throws. */
function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

// Set app name early so macOS dock and Cmd+Tab show "Agent Hub" instead of "Electron"
app.setName(APP_NAME);

// Force userData path to "agent-hub" so it doesn't change when app.setName changes it to "Agent Hub"
app.setPath('userData', path.join(app.getPath('appData'), 'agent-hub'));

let mainWindow: BrowserWindow | null = null;
let db: ReturnType<typeof initDatabase>;

function send(channel: string) {
  mainWindow?.webContents.send(channel);
}

function createAppMenu() {
  const isMac = process.platform === 'darwin';
  const t = i18nMain.t.bind(i18nMain);

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about' as const, label: t('about', { name: APP_NAME }) },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const, label: t('hide', { name: APP_NAME }) },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: t('quit', { name: APP_NAME }) },
      ],
    }] : []),
    {
      label: t('file'),
      submenu: [
        {
          label: t('newProject'),
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:navigate:projects-new'),
        },
        {
          label: t('newTask'),
          accelerator: 'CmdOrCtrl+T',
          click: () => send('menu:navigate:tasks-new'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: t('edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: t('navigate'),
      submenu: [
        { label: t('dashboard'), accelerator: 'CmdOrCtrl+1', click: () => send('menu:navigate:dashboard') },
        { label: t('tasks'), accelerator: 'CmdOrCtrl+2', click: () => send('menu:navigate:tasks') },
        { label: t('projects'), accelerator: 'CmdOrCtrl+3', click: () => send('menu:navigate:projects') },
        { label: t('workflow'), accelerator: 'CmdOrCtrl+4', click: () => send('menu:navigate:workflow') },
        { label: t('skills'), accelerator: 'CmdOrCtrl+5', click: () => send('menu:navigate:skills') },
        { label: t('knowledge'), accelerator: 'CmdOrCtrl+6', click: () => send('menu:navigate:knowledge') },
        { label: t('logs'), accelerator: 'CmdOrCtrl+7', click: () => send('menu:navigate:logs') },
        { label: t('settings'), accelerator: 'CmdOrCtrl+8', click: () => send('menu:navigate:settings') },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: t('about', { name: APP_NAME }), click: () => send('menu:show-about') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111827',
    show: false,
  });

  // The renderer holds a bridge to ~80 IPC methods, several of which spawn
  // processes. Deny new windows and in-place navigation so a hostile string
  // rendered into the DOM (a PR comment, a PM field) can't pivot the window to
  // remote content that keeps that bridge.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(safeProtocol(url))) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    const isAppUrl = url.startsWith('file://') || (devServer && url.startsWith(devServer));
    if (!isAppUrl) event.preventDefault();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.AGENT_HUB_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`[main] Failed to load: ${code} ${desc}`);
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      { role: 'cut', visible: params.isEditable },
      { role: 'copy', enabled: params.selectionText.length > 0 },
      { role: 'paste', visible: params.isEditable },
      { type: 'separator' },
      { role: 'selectAll' },
    ]);
    contextMenu.popup();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Read locale from DB, falling back to system locale then 'en'.
 */
function getPersistedLocale(): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('locale') as { value: string } | undefined;
    if (row?.value && ['en', 'es'].includes(row.value)) return row.value;
  } catch {
    // DB not ready or key missing
  }
  // Fallback: system locale
  const sys = app.getLocale().split('-')[0];
  return ['en', 'es'].includes(sys) ? sys : 'en';
}

app.whenReady().then(() => {
  const t0 = Date.now();
  console.log('[startup] app ready');

  // Register custom protocol to serve images from app storage
  protocol.handle('app-image', (request) => {
    const fileName = decodeURIComponent(request.url.replace('app-image://', ''));
    const imagesDir = path.join(app.getPath('userData'), 'images');
    const filePath = path.resolve(imagesDir, fileName);
    // Prevent path traversal — resolved path must stay inside imagesDir
    if (!filePath.startsWith(imagesDir + path.sep) && filePath !== imagesDir) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(`file://${filePath}`);
  });

  console.log('[startup] initDatabase...');
  db = initDatabase();
  console.log(`[startup] initDatabase done (${Date.now() - t0}ms)`);

  // Apply persisted locale to main-process i18n before building menu
  const locale = getPersistedLocale();
  i18nMain.changeLanguage(locale);

  console.log('[startup] registering IPC handlers...');
  registerProjectHandlers(ipcMain, db);
  registerTaskHandlers(ipcMain, db);
  registerAgentHandlers(ipcMain, db, () => mainWindow);
  registerGithubHandlers(ipcMain);
  registerSkillsHandlers(ipcMain, db);
  registerKnowledgeHandlers(ipcMain, db);
  registerDialogHandlers(ipcMain, () => mainWindow);
  registerPluginHandlers(ipcMain, db);
  registerLicenseHandlers(ipcMain, db);
  registerUpdateHandlers(ipcMain, db, () => mainWindow);
  registerNotificationHandlers(ipcMain, db);
  initNotifications(db, () => mainWindow);
  console.log(`[startup] IPC handlers done (${Date.now() - t0}ms)`);

  // App version
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // Requeue tasks left mid-flight by a crash or a quit during a phase.
  // Their orchestration is gone but their status still reads as running, so the
  // concurrency counter treats them as occupying a slot forever — with
  // maxConcurrent = 1 that permanently blocks the queue.
  console.log('[startup] reconciling in-flight tasks...');
  try {
    const reconciled = reconcileInFlightTasks(db);
    if (reconciled > 0) console.log(`[startup] requeued ${reconciled} interrupted task(s)`);
  } catch (err) { console.error('[startup] reconcileInFlightTasks error:', err); }

  // Clean orphan worktrees from previous sessions
  console.log('[startup] cleaning orphan worktrees...');
  try { cleanOrphanWorktrees(db); } catch (err) { console.error('[startup] cleanOrphanWorktrees error:', err); }
  console.log(`[startup] worktree cleanup done (${Date.now() - t0}ms)`);

  // Background license validation 3s after window creation.
  // Calls the function directly: `ipcMain.emit` does not invoke an `ipcMain.handle`
  // handler, so this check silently never ran.
  setTimeout(() => {
    try {
      const licenseKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('license_key') as { value: string } | undefined;
      if (licenseKey?.value) {
        validateLicense(db).catch((err) => console.error('[startup] license validation failed:', err));
      }
    } catch { /* ignore */ }
  }, 3000);

  // Listen for locale changes from renderer → rebuild menu
  ipcMain.on('settings:locale-changed', (_event, newLocale: string) => {
    if (['en', 'es'].includes(newLocale)) {
      i18nMain.changeLanguage(newLocale);
      createAppMenu();
    }
  });

  if (process.platform === 'darwin') {
    try { app.dock?.setIcon(path.join(__dirname, '../public/icon.png')); } catch { /* icon not found in packaged app */ }
  }

  createAppMenu();
  console.log(`[startup] creating window (${Date.now() - t0}ms)`);
  createWindow();
  console.log(`[startup] window created (${Date.now() - t0}ms)`);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Terminate agent subprocesses before the app goes away. Agents run with
// permissive tool access; an orphaned one keeps editing the user's repository
// unsupervised after Agent Hub has exited.
app.on('before-quit', () => {
  try { shutdownAllAgents(); } catch (err) { console.error('[shutdown] shutdownAllAgents error:', err); }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
