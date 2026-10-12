// WISE CONSULTING desktop — fiscal cash register (фискален апарат) bridge: PLACEHOLDER, not implemented yet.
//
// Many client computers (markets, rent-a-car, wholesale) will need the app to print fiscal receipts on a locally
// connected fiscal device (COM / USB-serial / LAN). That must run in the Electron MAIN process (the page is sandboxed
// and has no access to ports). The planned structure:
//
//   main process (this file)            ipcMain.handle('wise:fiscal:<op>', …)  — talks to the device driver / port
//   preload.js (to add, contextBridge)  window.wiseFiscal = { status(), printReceipt(doc), … } → ipcRenderer.invoke
//   web app                             feature-detects `window.wiseFiscal` (absent in a normal browser)
//
// Channels (reserved; every handler validates its input and only answers the app's own origin):
//   wise:fiscal:status        → { available: boolean, model?: string, port?: string, error?: string }
//   wise:fiscal:printReceipt  → { ok: boolean, number?: string, error?: string }   (doc = items, payments, operator)
//   wise:fiscal:dailyReport   → { ok: boolean, error?: string }                     (Z / X report)
//
// Today only `status` is registered and it answers „not available“, so the channel name and the shape are fixed.
// No preload is attached yet, so the page cannot call it; adding preload.js + webPreferences.preload enables it.
const { ipcMain } = require('electron');

const FISCAL_CHANNELS = Object.freeze({
  status: 'wise:fiscal:status',
  printReceipt: 'wise:fiscal:printReceipt',
  dailyReport: 'wise:fiscal:dailyReport',
});

/** Registers the fiscal IPC handlers. `isAppUrl(url)` = the request comes from the WISE server's own pages. */
function registerFiscal(isAppUrl) {
  ipcMain.handle(FISCAL_CHANNELS.status, (e) => {
    if (!isAppUrl(e.senderFrame && e.senderFrame.url)) return { available: false, error: 'forbidden' };
    return { available: false, error: 'Фискалниот апарат уште не е поддржан во оваа верзија.' };
  });
}

module.exports = { FISCAL_CHANNELS, registerFiscal };
