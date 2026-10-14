// Automatic updates (electron-updater, generic provider on the WISE server): checked shortly after start and every
// 4 hours; a new version downloads in the background and installs when the app closes (or at once on „Рестартирај“).
// The update files are served only to the desktop app (header below) — the installer is never a public download.
const { app, dialog, BrowserWindow } = require('electron');

const UPDATE_HEADER = { 'x-wise-desktop': 'wise-desktop-update-1' };

function startUpdates() {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; } // dev run without the package
  if (!app.isPackaged) return;
  autoUpdater.requestHeaders = UPDATE_HEADER;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', () => { /* offline / server busy: try again at the next check */ });
  autoUpdater.on('update-downloaded', async (info) => {
    const w = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showMessageBox(w, {
      type: 'info', buttons: ['Рестартирај сега', 'Подоцна'], defaultId: 0, cancelId: 1,
      title: 'WISE CONSULTING', message: `Преземена е нова верзија (${info.version}).`,
      detail: 'Ќе се инсталира автоматски кога ќе ја затворите програмата. Или рестартирајте сега.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall(true, true);
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 20_000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

module.exports = { startUpdates, UPDATE_HEADER };
