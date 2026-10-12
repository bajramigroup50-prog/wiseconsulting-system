'use strict';
// IPC layer of the fiscal bridge (Electron main process). Every handler first checks that the request comes from the
// WISE server's own pages (`isAppUrl(senderFrame.url)`), validates nothing itself (the service does) and never passes
// file paths from the page: the vendor-program folder / exe are chosen in a native dialog here.
const { ipcMain, dialog, BrowserWindow, app } = require('electron');
const { FiscalService } = require('./service');
const { MESSAGES } = require('./receipt');

const FISCAL_CHANNELS = Object.freeze({
  status: 'wise:fiscal:status',
  printReceipt: 'wise:fiscal:printReceipt',
  printStorno: 'wise:fiscal:printStorno',
  dailyReport: 'wise:fiscal:dailyReport', // { type: 'X' | 'Z' }
  cash: 'wise:fiscal:cash', // { amount: +in / −out }
  lastReceipt: 'wise:fiscal:lastReceipt',
  test: 'wise:fiscal:test',
  info: 'wise:fiscal:info',
  getConfig: 'wise:fiscal:getConfig',
  setConfig: 'wise:fiscal:setConfig',
  listPorts: 'wise:fiscal:listPorts',
  pickFolder: 'wise:fiscal:pickFolder',
  pickExe: 'wise:fiscal:pickExe',
});

let service = null;

/** Registers the fiscal IPC handlers. `isAppUrl(url)` = the request comes from the WISE server's own pages. */
function registerFiscal(isAppUrl) {
  service = new FiscalService({ dataDir: app.getPath('userData') });
  const guard = (f) => async (e, arg) => {
    if (!isAppUrl(e.senderFrame && e.senderFrame.url)) return { ok: false, code: 'FORBIDDEN', error: MESSAGES.FORBIDDEN };
    try { return await f(arg, e); } catch (err) { return { ok: false, code: 'DEVICE_ERROR', error: String((err && err.message) || err).slice(0, 300) }; }
  };
  const win = (e) => BrowserWindow.fromWebContents(e.sender) || undefined;
  const h = (ch, f) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, guard(f)); };
  h(FISCAL_CHANNELS.status, () => service.status());
  h(FISCAL_CHANNELS.printReceipt, (r) => service.printReceipt(r));
  h(FISCAL_CHANNELS.printStorno, (r) => service.printStorno(r));
  h(FISCAL_CHANNELS.dailyReport, (a) => service.report(a && a.type));
  h(FISCAL_CHANNELS.cash, (a) => service.cash(a && a.amount));
  h(FISCAL_CHANNELS.lastReceipt, () => service.lastReceipt());
  h(FISCAL_CHANNELS.test, () => service.test());
  h(FISCAL_CHANNELS.info, () => ({ ok: true, ...service.info(), version: app.getVersion() }));
  h(FISCAL_CHANNELS.getConfig, () => service.getConfig());
  h(FISCAL_CHANNELS.setConfig, (c) => service.setConfig(c));
  h(FISCAL_CHANNELS.listPorts, () => service.listPorts());
  h(FISCAL_CHANNELS.pickFolder, async (_a, e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Папка на програмата на фискалниот апарат', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? service.getConfig() : service.setPaths({ folder: r.filePaths[0] });
  });
  h(FISCAL_CHANNELS.pickExe, async (_a, e) => {
    const r = await dialog.showOpenDialog(win(e), { title: 'Програма на производителот (на пр. Fiscal32.exe)', properties: ['openFile'], filters: [{ name: 'Програма', extensions: ['exe'] }] });
    if (r.canceled || !r.filePaths[0]) return service.getConfig();
    const exe = r.filePaths[0];
    return service.setPaths({ exePath: exe, folder: require('node:path').dirname(exe) });
  });
}

module.exports = { FISCAL_CHANNELS, registerFiscal };
