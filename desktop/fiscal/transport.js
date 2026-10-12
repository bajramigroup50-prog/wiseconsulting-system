'use strict';
// Byte transports for the raw protocol drivers: serial (COM / USB-serial / Bluetooth-mapped COM) and TCP (LAN).
// A transport: { open(): Promise, write(buf): Promise, onData(cb), close(): Promise, label }.
//
// Serial uses the optional native module `serialport` (N-API prebuilt binaries, no compiler needed on the client).
// It is required lazily so the app still starts when it is missing; the driver then answers SERIAL_MISSING.
const net = require('node:net');
const { FiscalError } = require('./receipt');

/** True for LAN addresses only (a fiscal printer is never on the internet). */
function isLanHost(h) {
  const s = String(h || '').trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function loadSerialPort() {
  try { return require('serialport'); } catch { return null; }
}

/** Lists the COM ports of this computer ([] when the serial module is missing). */
async function listSerialPorts() {
  const sp = loadSerialPort();
  if (!sp) return { ok: false, ports: [], code: 'SERIAL_MISSING' };
  const L = await sp.SerialPort.list();
  return { ok: true, ports: L.map((p) => ({ path: p.path, name: [p.manufacturer, p.friendlyName].filter(Boolean).join(' · ') })) };
}

function serialTransport({ port, baud = 9600 }) {
  const sp = loadSerialPort();
  if (!sp) throw new FiscalError('SERIAL_MISSING');
  if (!/^COM\d{1,3}$/i.test(String(port || '')) && !/^\/dev\/[\w.-]+$/.test(String(port || ''))) throw new FiscalError('NOT_CONFIGURED', 'COM порта');
  let dev = null;
  const listeners = [];
  return {
    label: `${port} @ ${baud}`,
    open: () => new Promise((res, rej) => {
      dev = new sp.SerialPort({ path: port, baudRate: Number(baud) || 9600, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false });
      dev.on('data', (d) => listeners.forEach((f) => f(d)));
      dev.open((e) => (e ? rej(new FiscalError(/access denied|busy|locked/i.test(e.message) ? 'PORT_BUSY' : 'NOT_CONNECTED', port)) : res()));
    }),
    write: (buf) => new Promise((res, rej) => dev.write(buf, (e) => (e ? rej(new FiscalError('NOT_CONNECTED', port)) : dev.drain(() => res())))),
    onData: (f) => listeners.push(f),
    close: () => new Promise((res) => { if (dev && dev.isOpen) dev.close(() => res()); else res(); }),
  };
}

function tcpTransport({ host, tcpPort }) {
  if (!isLanHost(host)) throw new FiscalError('NOT_CONFIGURED', 'IP адресата мора да биде во локалната мрежа');
  const p = Number(tcpPort);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new FiscalError('NOT_CONFIGURED', 'мрежна порта');
  let sock = null;
  const listeners = [];
  return {
    label: `${host}:${p}`,
    open: () => new Promise((res, rej) => {
      sock = net.createConnection({ host, port: p });
      sock.setNoDelay(true);
      const t = setTimeout(() => { sock.destroy(); rej(new FiscalError('NOT_CONNECTED', `${host}:${p}`)); }, 4000);
      sock.once('connect', () => { clearTimeout(t); res(); });
      sock.once('error', () => { clearTimeout(t); rej(new FiscalError('NOT_CONNECTED', `${host}:${p}`)); });
      sock.on('data', (d) => listeners.forEach((f) => f(d)));
    }),
    write: (buf) => new Promise((res, rej) => sock.write(buf, (e) => (e ? rej(new FiscalError('NOT_CONNECTED')) : res()))),
    onData: (f) => listeners.push(f),
    close: () => new Promise((res) => { if (sock) sock.end(() => res()); else res(); setTimeout(res, 500); }),
  };
}

module.exports = { isLanHost, listSerialPorts, serialTransport, tcpTransport, loadSerialPort };
