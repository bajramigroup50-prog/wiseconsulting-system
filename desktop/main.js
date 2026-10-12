// WISE CONSULTING desktop: a window on the server app. Data and updates stay on the server.
const { app, BrowserWindow, Menu, shell, session } = require('electron');
const { registerFiscal } = require('./fiscal');

const APP_URL = 'https://app.wiseconsulting.com.mk';
const APP_HOST = new URL(APP_URL).host;
/** Browser-internal URLs (blank / blob / data windows a page fills itself) — never handed to Windows. */
const internalUrl = (url) => /^(about:|blob:|data:)/i.test(String(url || ''));
/** Only real web / mail / phone links go to the system (never about:, file:, javascript: …). */
const externalOk = (url) => /^(https?:|mailto:|tel:)/i.test(String(url || ''));
const sameApp = (url) => { try { const h = new URL(url).host; return h === APP_HOST || h.endsWith('.' + APP_HOST); } catch { return false; } };

/** Issuer CN of the device certificates (apps/web/lib/device-certs.ts DEVICE_CA_CN). */
const DEVICE_CA_CN = 'WISE CONSULTING Device CA';

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'WISE CONSULTING', icon: __dirname + '/build/icon.ico', backgroundColor: '#0d5b4b', show: false,
    autoHideMenuBar: true,
    // preload.js exposes only `window.wiseFiscal` (fiscal device), and only on the app's own origin
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: __dirname + '/preload.js' },
  });
  // Show the window only once the first page has painted (no white flash while the server answers).
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  setTimeout(() => { if (!win.isVisible()) { win.maximize(); win.show(); } }, 8000);
  win.loadURL(APP_URL);

  // Links to other sites (bank, УЈП, WhatsApp, Maps…) open in the normal browser; the app's own pages and PDFs stay here.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // the app's own pages, PDFs and print previews (also blank / blob / data windows filled by the page) stay in the app
    if (sameApp(url) || internalUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: __dirname + '/build/icon.ico' } };
    if (externalOk(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!sameApp(url) && !internalUrl(url)) { e.preventDefault(); if (externalOk(url)) shell.openExternal(url); } });
  // windows opened by the page (PDF / print) follow the same rules
  win.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(({ url }) => (sameApp(url) || internalUrl(url) ? { action: 'allow' } : (externalOk(url) && shell.openExternal(url), { action: 'deny' })));
    child.webContents.on('will-navigate', (e, url) => { if (!sameApp(url) && !internalUrl(url)) { e.preventDefault(); if (externalOk(url)) shell.openExternal(url); } });
  });

  // Offline / server unreachable: a plain message with retry instead of a blank window. A TLS client-certificate
  // error (-110 ERR_SSL_CLIENT_AUTH_CERT_NEEDED, -117 ERR_BAD_SSL_CLIENT_AUTH_CERT, -123 / -134…) means this computer
  // is not enrolled (or its certificate was revoked / expired).
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return;
    const certErr = [-110, -117, -123, -134, -135, -136, -137].includes(code);
    const msg = certErr
      ? 'Овој компјутер не е овластен за пристап до серверот (нема важечки сертификат). Обратете се кај WISE CONSULTING.'
      : 'Серверот не е достапен. Проверете ја интернет врската.';
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      `<html><body style="font-family:Segoe UI,Arial;padding:40px;color:#0d5b4b"><h2>WISE CONSULTING</h2>` +
      `<p>${msg}</p><p><button onclick="location.href='${APP_URL}'" ` +
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

/**
 * 🔐 Mutual TLS: the server asks for this computer's certificate (installed into the Windows user store by the
 * per-device installer). Pick ours automatically — issuer = the WISE device CA, the newest one — never a dialog and
 * never a certificate of another issuer (bank / e-signature tokens stay untouched). Only for the app's own host.
 */
// Chromium passes „host:port“ (no scheme) here; accept a full URL too.
const certHost = (u) => String(u || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].replace(/:\d+$/, '').toLowerCase();
const certForApp = (u) => { const h = certHost(u); return h === APP_HOST || h.endsWith('.' + APP_HOST); };
app.on('select-client-certificate', (event, _wc, url, list, callback) => {
  if (!certForApp(url)) return; // default Chromium behaviour for other sites
  event.preventDefault();
  const ours = list.filter((c) => c.issuerName === DEVICE_CA_CN || (c.issuer && c.issuer.commonName === DEVICE_CA_CN))
    .sort((a, b) => (b.validStart || 0) - (a.validStart || 0));
  callback(ours[0]); // undefined → continue without a certificate (the server shows „not authorised“)
});

app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
/**
 * Safety: the app always starts at the login screen (then year → firm). The server's cookies (session, firm, year) are
 * deleted when the app starts and again when it quits, so neither a crash nor a restored session skips the login.
 */
const clearAppCookies = () => session.defaultSession.clearStorageData({ storages: ['cookies'] })
  .then(() => session.defaultSession.cookies.flushStore()).catch(() => {});

// a second instance only hands over to the running one: it must not touch the shared cookies
if (primary) app.whenReady().then(() => registerFiscal(sameApp)).then(clearAppCookies).then(createWindow);
app.on('window-all-closed', () => app.quit());
let cleared = false;
app.on('before-quit', (e) => {
  if (cleared || !primary) return;
  e.preventDefault();
  cleared = true;
  const done = () => app.quit();
  clearAppCookies().then(done, done);
  setTimeout(done, 3000); // never hang on quit
});
