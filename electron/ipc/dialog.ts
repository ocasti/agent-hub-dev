import type { IpcMain, BrowserWindow } from 'electron';
import { app, dialog, shell } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

function parseGitRemoteUrl(raw: string): string | null {
  const trimmed = raw.trim();

  // SSH: git@github.com:org/repo.git
  const sshMatch = trimmed.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/org/repo.git
  const httpsMatch = trimmed.match(/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

export function registerDialogHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
) {
  ipcMain.handle('dialog:selectFolder', async () => {
    const win = getMainWindow();
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:selectImages', async () => {
    const win = getMainWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return [];

    // Copy images to app storage so they persist if originals are moved/deleted
    const imagesDir = path.join(app.getPath('userData'), 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const imageUrls: string[] = [];
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath);
      const destName = `${uuidv4()}${ext}`;
      const destPath = path.join(imagesDir, destName);
      fs.copyFileSync(filePath, destPath);
      imageUrls.push(`app-image://${destName}`);
    }
    return imageUrls;
  });

  ipcMain.handle('dialog:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle('dialog:getPremiumUrl', () => {
    return process.env.PREMIUM_URL || 'https://integral-apps.cloud/get-coffee-pod/';
  });

  ipcMain.handle('dialog:getGitRemote', async (_event, folderPath: string) => {
    return new Promise<string | null>((resolve) => {
      execFile('git', ['-C', folderPath, 'remote', 'get-url', 'origin'], (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseGitRemoteUrl(stdout));
      });
    });
  });
}
