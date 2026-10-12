'use strict';
// IPC layer + preload with a stubbed `electron` module: the API exists only on the app's own origin, every handler
// refuses other senders, and the page reaches the simulator through the channels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function withElectron(stub, f) {
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? stub : orig.call(this, req, ...rest); };
  try { return f(); } finally { Module._load = orig; }
}

test('ipc: handlers answer only the WISE origin and drive the configured driver', async () => {
  const handlers = new Map();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wise-ipc-'));
  const stub = {
    ipcMain: { handle: (ch, f) => handlers.set(ch, f), removeHandler: (ch) => handlers.delete(ch) },
    app: { getPath: () => dir, getVersion: () => '1.2.0' },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    BrowserWindow: { fromWebContents: () => null },
  };
  const ipcPath = require.resolve('../ipc');
  delete require.cache[ipcPath];
  const { registerFiscal, FISCAL_CHANNELS } = withElectron(stub, () => require('../ipc'));
  const isApp = (u) => { try { return new URL(u).host === 'app.wiseconsulting.com.mk'; } catch { return false; } };
  registerFiscal(isApp);
  assert.deepEqual([...handlers.keys()].sort(), Object.values(FISCAL_CHANNELS).sort());
  const call = (ch, arg, url = 'https://app.wiseconsulting.com.mk/kasa') => handlers.get(ch)({ senderFrame: { url }, sender: {} }, arg);

  assert.equal((await call(FISCAL_CHANNELS.status, undefined, 'https://evil.example/')).code, 'FORBIDDEN');
  assert.equal((await call(FISCAL_CHANNELS.printReceipt, {}, 'data:text/html,x')).code, 'FORBIDDEN');
  assert.equal((await call(FISCAL_CHANNELS.status)).code, 'NOT_CONFIGURED');
  assert.equal((await call(FISCAL_CHANNELS.setConfig, { vendor: 'sim' })).ok, true);
  const r = await call(FISCAL_CHANNELS.printReceipt, { items: [{ name: 'Тест', qty: 1, price: 1, vat: 'А' }] });
  assert.deepEqual([r.ok, r.number], [true, '1']);
  const z = await call(FISCAL_CHANNELS.dailyReport, { type: 'Z' });
  assert.deepEqual([z.ok, z.number], [true, '1']);
  assert.ok(fs.readFileSync(path.join(dir, 'fiscal-simulator.log'), 'utf8').includes('"type":"receipt"'));
  // the page cannot set paths: folder / exePath in setConfig are ignored
  await call(FISCAL_CHANNELS.setConfig, { vendor: 'accent', driver: 'file', folder: 'C:\\Windows', exePath: 'C:\\Windows\\System32\\cmd.exe' });
  const c = (await call(FISCAL_CHANNELS.getConfig)).config;
  assert.deepEqual([c.folder, c.exePath], ['', '']);
});

test('preload: exposes window.wiseFiscal only on the app origin', () => {
  const run = (host) => {
    const exposed = {};
    const invoked = [];
    const stub = { contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } }, ipcRenderer: { invoke: (ch, a) => { invoked.push([ch, a]); return Promise.resolve({ ok: true }); } } };
    global.window = { location: { host } };
    const p = require.resolve('../../preload');
    delete require.cache[p];
    withElectron(stub, () => require('../../preload'));
    delete global.window;
    return { exposed, invoked };
  };
  assert.equal(run('evil.example').exposed.wiseFiscal, undefined);
  assert.equal(run('').exposed.wiseFiscal, undefined);
  const { exposed, invoked } = run('app.wiseconsulting.com.mk');
  const f = exposed.wiseFiscal;
  assert.equal(f.version, 1);
  assert.ok(Object.isFrozen(f));
  f.zReport(); f.printReceipt({ items: [] });
  assert.deepEqual(invoked, [['wise:fiscal:dailyReport', { type: 'Z' }], ['wise:fiscal:printReceipt', { items: [] }]]);
});
