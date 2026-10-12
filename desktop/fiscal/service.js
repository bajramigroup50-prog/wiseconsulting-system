'use strict';
// Fiscal service (Electron-free, testable): device configuration, the vendor catalogue, the driver factory and a job
// queue (one job at a time per device). The IPC layer (ipc.js) only checks the caller and forwards here.
const fs = require('node:fs');
const path = require('node:path');
const { FiscalError, errorResult, MESSAGES } = require('./receipt');
const { isLanHost, listSerialPorts, serialTransport, tcpTransport } = require('./transport');
const { DatecsRawDriver } = require('./drivers/datecs-raw');
const { CommandFileDriver } = require('./drivers/command-file');
const { SimulatorDriver } = require('./drivers/simulator');

/**
 * Vendors sold in North Macedonia and what we know about them (see docs/FISKALNI-APARATI.md):
 *  accent — Synergy PF500/PF550/PF700 printers: Datecs protocol, documented (control codes v1.36 / v1.40), RS232 9600 8N1,
 *           PF700 also USB / LAN; IN-file program Fiscal32.exe. SY cash registers use another (TAB) syntax — за проверка.
 *  david  — David FP, FX1200, FX1300 printers, Expert SX / Perfect S / David S / M registers (Daisy-made): the open
 *           driver tinodj/mk-fiscal-printer-driver prints on Expert SX with the same frames and commands — за проверка
 *           for the other models, storno and the payment codes.
 *  duna   — Вардарец / Развигорец / Северец / Пелистерец / Маестрал (own production): RS232 115200 to the PC in „Fiscal
 *           printer (FPR)“ mode; the protocol is not public — за проверка (ask Duna; meanwhile the vendor program).
 */
const VENDORS = Object.freeze({
  accent: { label: 'ACCENT (Synergy)', models: ['PF550', 'PF700', 'PF500', 'SY55', 'SY250', 'SY46', 'SY47'], drivers: ['serial', 'tcp', 'file'], nameMax: 25, baud: 9600 },
  david: { label: 'DAVID (Давид компјутери)', models: ['ДАВИД ФП', 'FX1200', 'FX1300', 'Expert SX', 'Perfect S', 'Давид S', 'Давид М'], drivers: ['serial', 'tcp', 'file'], nameMax: 22, baud: 9600 },
  duna: { label: 'ДУНА (Дуна компјутери)', models: ['Вардарец', 'Развигорец', 'Северец', 'Пелистерец', 'Маестрал'], drivers: ['file', 'serial'], nameMax: 22, baud: 115200 },
  sim: { label: 'СИМУЛАТОР (тест / демо, без апарат)', models: ['SIM'], drivers: ['sim'], nameMax: 32, baud: 9600 },
});
const DRIVERS = Object.freeze({ serial: 'COM порта (RS232 / USB-сериски)', tcp: 'Мрежа (LAN, IP:порта)', file: 'Програма на производителот (IN/OUT датотеки)', sim: 'Симулатор' });

const DEFAULTS = Object.freeze({ vendor: '', model: '', driver: '', port: '', baud: 9600, host: '', tcpPort: 0, folder: '', exePath: '', op: 1, pwd: '0000', till: 1, fault: '' });

/** Validates the part of the configuration the web page may change (paths are set only through the native dialog). */
function cleanConfig(c, prev = DEFAULTS) {
  const o = { ...DEFAULTS, ...prev };
  if (!c || typeof c !== 'object') throw new FiscalError('INVALID_INPUT');
  if (c.vendor !== undefined) { if (c.vendor && !VENDORS[c.vendor]) throw new FiscalError('INVALID_INPUT', 'производител'); o.vendor = c.vendor || ''; }
  const V = VENDORS[o.vendor];
  if (c.model !== undefined) o.model = String(c.model || '').slice(0, 40);
  if (c.driver !== undefined) { if (c.driver && (!V || !V.drivers.includes(c.driver))) throw new FiscalError('INVALID_INPUT', 'начин на поврзување'); o.driver = c.driver || ''; }
  if (V && o.driver && !V.drivers.includes(o.driver)) o.driver = V.drivers[0];
  if (c.port !== undefined) { const p = String(c.port || '').toUpperCase(); if (p && !/^COM\d{1,3}$/.test(p)) throw new FiscalError('INVALID_INPUT', 'COM порта'); o.port = p; }
  if (c.baud !== undefined) { const b = Number(c.baud); if (![9600, 19200, 38400, 57600, 115200].includes(b)) throw new FiscalError('INVALID_INPUT', 'брзина'); o.baud = b; }
  if (c.host !== undefined) { const h = String(c.host || '').trim(); if (h && !isLanHost(h)) throw new FiscalError('INVALID_INPUT', 'IP адресата мора да е во локалната мрежа'); o.host = h; }
  if (c.tcpPort !== undefined) { const p = Number(c.tcpPort) || 0; if (p < 0 || p > 65535) throw new FiscalError('INVALID_INPUT', 'мрежна порта'); o.tcpPort = p; }
  if (c.op !== undefined) { const n = Number(c.op); if (!Number.isInteger(n) || n < 1 || n > 16) throw new FiscalError('INVALID_INPUT', 'оператор'); o.op = n; }
  if (c.pwd !== undefined) { const s = String(c.pwd || ''); if (!/^\d{4,6}$/.test(s)) throw new FiscalError('INVALID_INPUT', 'лозинка на операторот (4–6 цифри)'); o.pwd = s; }
  if (c.till !== undefined) { const n = Number(c.till); if (!Number.isInteger(n) || n < 1 || n > 99999) throw new FiscalError('INVALID_INPUT', 'број на каса'); o.till = n; }
  if (c.fault !== undefined) { const f = String(c.fault || ''); if (f && !['PAPER_OUT', 'NOT_CONNECTED', 'FM_FULL', 'COVER_OPEN'].includes(f)) throw new FiscalError('INVALID_INPUT'); o.fault = o.vendor === 'sim' ? f : ''; }
  return o;
}

/** The configuration as the page sees it (the operator password is not echoed back). */
const publicConfig = (c) => ({ ...c, pwd: c.pwd ? '••••' : '', exePath: c.exePath ? path.basename(c.exePath) : '' });

class FiscalService {
  /** @param {object} o dataDir (userData), driverFactory? (tests) */
  constructor(o) {
    this.dir = o.dataDir;
    this.cfgFile = path.join(this.dir, 'fiscal.json');
    this.factory = o.driverFactory || null;
    this.queue = Promise.resolve();
    this.cfg = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(this.cfgFile, 'utf8'));
      this.cfg = { ...cleanConfig(raw), folder: String(raw.folder || ''), exePath: String(raw.exePath || '') };
    } catch { /* not configured yet */ }
  }

  info() { return { vendors: VENDORS, drivers: DRIVERS, messages: MESSAGES }; }
  getConfig() { return { ok: true, config: publicConfig(this.cfg), configured: this.configured() }; }
  configured() {
    const c = this.cfg;
    if (!c.vendor || !c.driver) return false;
    if (c.driver === 'serial') return !!c.port;
    if (c.driver === 'tcp') return !!c.host && c.tcpPort > 0;
    if (c.driver === 'file') return !!c.folder;
    return c.driver === 'sim';
  }
  save() { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.cfgFile, JSON.stringify(this.cfg, null, 2)); }
  setConfig(c) {
    try {
      const next = cleanConfig(c, this.cfg);
      if (next.vendor === 'sim') next.driver = 'sim';
      this.cfg = next;
      this.save();
      return this.getConfig();
    } catch (e) { return errorResult(e); }
  }
  /** Paths come from the native folder / file dialog of the main process only. */
  setPaths({ folder, exePath }) {
    if (folder !== undefined) this.cfg.folder = String(folder || '');
    if (exePath !== undefined) this.cfg.exePath = String(exePath || '');
    this.save();
    return this.getConfig();
  }

  driver() {
    if (!this.configured()) throw new FiscalError('NOT_CONFIGURED');
    const c = this.cfg, V = VENDORS[c.vendor];
    if (this.factory) return this.factory(c);
    const common = { nameMax: V.nameMax, op: c.op, pwd: c.pwd, till: c.till };
    if (c.driver === 'sim') return new SimulatorDriver({ ...common, logFile: path.join(this.dir, 'fiscal-simulator.log'), stateFile: path.join(this.dir, 'fiscal-simulator.json'), fault: c.fault });
    if (c.driver === 'file') return new CommandFileDriver({ ...common, folder: c.folder, exePath: c.exePath, stateFile: path.join(this.dir, 'fiscal-file-seq.json') });
    const transport = c.driver === 'tcp' ? tcpTransport({ host: c.host, tcpPort: c.tcpPort }) : serialTransport({ port: c.port, baud: c.baud || V.baud });
    return new DatecsRawDriver({ ...common, transport });
  }

  /** Runs one job on a fresh driver; jobs never overlap (a second receipt waits for the first). */
  job(f) {
    const run = async () => {
      let d = null;
      try { d = this.driver(); return await f(d); } catch (e) { return errorResult(e); } finally { if (d) { try { await d.close(); } catch { /* ignore */ } } }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  device() { return { vendor: this.cfg.vendor, model: this.cfg.model, driver: this.cfg.driver }; }
  withDevice(r) { return r && r.ok ? { ...r, device: this.device() } : r; }

  async status() {
    if (!this.configured()) return { ok: false, available: true, configured: false, code: 'NOT_CONFIGURED', error: MESSAGES.NOT_CONFIGURED };
    const r = await this.job((d) => d.status());
    const errors = (r.errors || []).map((c) => MESSAGES[c] || c);
    return { ...r, errors, available: true, configured: true, device: this.device() };
  }
  printReceipt(receipt) { return this.job((d) => d.printReceipt(receipt)).then((r) => this.withDevice(r)); }
  printStorno(receipt) { return this.job((d) => d.printReceipt(receipt, { storno: true })).then((r) => this.withDevice(r)); }
  report(type) {
    if (type !== 'X' && type !== 'Z') return Promise.resolve(errorResult(new FiscalError('INVALID_INPUT')));
    return this.job((d) => d.report(type)).then((r) => this.withDevice(r));
  }
  cash(amount) { return this.job((d) => d.cash(amount)).then((r) => this.withDevice(r)); }
  lastReceipt() { return this.job((d) => d.lastReceipt()); }
  test() { return this.job((d) => d.testPrint()); }
  async listPorts() { try { return await listSerialPorts(); } catch (e) { return errorResult(e); } }
}

module.exports = { FiscalService, VENDORS, DRIVERS, cleanConfig, publicConfig };
