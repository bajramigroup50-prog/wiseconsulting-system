// WISE CONSULTING desktop: a window on the server app. Data and updates stay on the server.
const { app, BrowserWindow, Menu, shell, session } = require('electron');

const APP_URL = 'https://app.wiseconsulting.com.mk';
const APP_HOST = new URL(APP_URL).host;
const sameApp = (url) => { try { const h = new URL(url).host; return h === APP_HOST || h.endsWith('.' + APP_HOST); } catch { return false; } };

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'WISE CONSULTING', icon: __dirname + '/build/icon.ico', backgroundColor: '#0d5b4b', show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  // Show the window only once the first page has painted (no white flash while the server answers).
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  setTimeout(() => { if (!win.isVisible()) { win.maximize(); win.show(); } }, 8000);
  win.loadURL(APP_URL);

  // Links to other sites (bank, УЈП, WhatsApp, Maps…) open in the normal browser; the app's own pages and PDFs stay here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameApp(url) || url === 'about:blank') return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: __dirname + '/build/icon.ico' } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!sameApp(url)) { e.preventDefault(); shell.openExternal(url); } });

  // Offline / server unreachable: a plain message with retry instead of a blank window.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<html><body style="font-family:Segoe UI,Arial;padding:40px;color:#0d5b4b"><h2>WISE CONSULTING</h2>` +
      `<p>Серверот не е достапен. Проверете ја интернет врската.</p><p><button onclick="location.href='${APP_URL}'" ` +
      `style="padding:8px 16px;background:#0d5b4b;color:#fff;border:0;border-radius:6px;cursor:pointer">Обиди се повторно</button></p></body></html>`));
  });

  // Ask where to save downloads (Excel, PDF, ZIP) like a browser does.
  session.defaultSession.on('will-download', (_e, item) => { item.setSaveDialogOptions({ title: 'Зачувај датотека' }); });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'WISE', submenu: [
    { label: 'Почетна', accelerator: 'Alt+Home', click: (_m, w) => w && w.loadURL(APP_URL) },
    { role: 'reload', label: 'Освежи' }, { role: 'forceReload', label: 'Освежи целосно' },
    { type: 'separator' }, { role: 'zoomIn', label: 'Зголеми' }, { role: 'zoomOut', label: 'Намали' }, { role: 'resetZoom', label: 'Нормална големина' },
    { type: 'separator' }, { role: 'togglefullscreen', label: 'Цел екран' }, { role: 'quit', label: 'Излез' },
  ] },
  { label: 'Уреди', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
]));

app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
