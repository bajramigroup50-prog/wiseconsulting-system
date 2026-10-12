// WISE CONSULTING desktop — fiscal cash register (фискален апарат) bridge.
//
//   main process (fiscal/ipc.js)        ipcMain.handle('wise:fiscal:<op>', …) — sender-origin check, then fiscal/service.js
//   preload.js (contextBridge)          window.wiseFiscal = { status(), printReceipt(r), printStorno(r), xReport(), zReport(), … }
//   web app                             feature-detects `window.wiseFiscal` (absent in a normal browser), lib/fiscal-bridge.ts
//
// Drivers (fiscal/drivers): Datecs-family raw protocol over COM / LAN (ACCENT PF500/PF550/PF700, DAVID Expert SX…),
// vendor command files (ACCENT Fiscal32.exe IN/OUT/ERR) and a SIMULATOR. See docs/FISKALNI-APARATI.md.
module.exports = require('./fiscal/ipc');
