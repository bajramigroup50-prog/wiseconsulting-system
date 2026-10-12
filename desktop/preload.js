'use strict';
// Preload of the WISE window (sandboxed): exposes `window.wiseFiscal` — a minimal, promise-based fiscal device API —
// to the WISE server's own pages only. Nothing else of Node/Electron reaches the page. The main process checks the
// sender's origin again on every call (fiscal/ipc.js).
const { contextBridge, ipcRenderer } = require('electron');

const APP_HOST = 'app.wiseconsulting.com.mk';
const host = (() => { try { return window.location.host.toLowerCase(); } catch { return ''; } })();
const ours = host === APP_HOST || host.endsWith('.' + APP_HOST);

if (ours) {
  const call = (ch, arg) => ipcRenderer.invoke('wise:fiscal:' + ch, arg);
  contextBridge.exposeInMainWorld('wiseFiscal', Object.freeze({
    version: 1,
    info: () => call('info'),
    status: () => call('status'),
    /** receipt = { items: [{ name, qty, price, vat: 'А'|'Б'|'В'|'Г' }], discountPct?, payments: { card? } } */
    printReceipt: (receipt) => call('printReceipt', receipt),
    /** same as printReceipt + ref (number of the original fiscal receipt) */
    printStorno: (receipt) => call('printStorno', receipt),
    xReport: () => call('dailyReport', { type: 'X' }),
    zReport: () => call('dailyReport', { type: 'Z' }),
    cash: (amount) => call('cash', { amount }),
    lastReceipt: () => call('lastReceipt'),
    test: () => call('test'),
    getConfig: () => call('getConfig'),
    setConfig: (c) => call('setConfig', c),
    listPorts: () => call('listPorts'),
    pickFolder: () => call('pickFolder'),
    pickExe: () => call('pickExe'),
  }));
}
