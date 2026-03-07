/**
 * Renames the Electron.app bundle to "Agent Hub.app" on macOS so the dock
 * and Cmd+Tab show the correct app name during development.
 *
 * Runs automatically via postinstall. Safe to re-run.
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('[patch-electron-name] Skipping — not macOS');
  process.exit(0);
}

const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const oldApp = path.join(distDir, 'Electron.app');
const newApp = path.join(distDir, 'Agent Hub.app');
const pathTxt = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');

// Rename bundle
if (fs.existsSync(oldApp)) {
  fs.renameSync(oldApp, newApp);
  console.log('[patch-electron-name] Renamed Electron.app → Agent Hub.app');
} else if (fs.existsSync(newApp)) {
  console.log('[patch-electron-name] Already renamed to Agent Hub.app');
} else {
  console.log('[patch-electron-name] Warning: Electron.app not found');
  process.exit(0);
}

// Update path.txt so `require('electron')` resolves correctly
fs.writeFileSync(pathTxt, 'Agent Hub.app/Contents/MacOS/Electron');
console.log('[patch-electron-name] Updated path.txt');
