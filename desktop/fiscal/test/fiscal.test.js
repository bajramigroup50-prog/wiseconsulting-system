'use strict';
// node --test desktop/fiscal/test   (no Electron needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('../cp1251');
const P = require('../datecs');
const { normalizeReceipt, FiscalError } = require('../receipt');
const { DatecsRawDriver } = require('../drivers/datecs-raw');
const { CommandFileDriver, inFileText, parseErrFile } = require('../drivers/command-file');
const { SimulatorDriver } = require('../drivers/simulator');
const { FiscalService, cleanConfig } = require('../service');
const { isLanHost } = require('../transport');
const { fakeDevice } = require('./fake-device');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wise-fiscal-'));
const RECEIPT = {
  items: [{ name: 'Леб бел 500г', qty: 2, price: 35, vat: 'Б' }, { name: 'Сок; јаболко\tтест', qty: 1, price: 70.5, vat: 'А' }],
  payments: { card: 50 },
};

test('cp1251: Macedonian letters and VAT group bytes', () => {
  assert.deepEqual([...cp.encode('АБВГ')], [0xC0, 0xC1, 0xC2, 0xC3]);
  assert.deepEqual([...cp.encode('ЃЌЅЈЉЊЏѓќѕјљњџ')], [0x81, 0x8D, 0xBD, 0xA3, 0x8A, 0x8C, 0x8F, 0x83, 0x9D, 0xBE, 0xBC, 0x9A, 0x9C, 0x9F]);
  assert.equal(cp.decode(cp.encode('Шпагети „Барила“ №5 – €')), 'Шпагети „Барила“ №5 – €');
  assert.equal(cp.decode(cp.encode('日本')), '??');
});

test('Datecs frame: LEN, SEQ, checksum like the PF550 control-code example', () => {
  // command 48 "1,0000,1": LEN = 20h + 4 + 8
  const f = P.buildFrame(0x20, 48, '1,0000,1');
  assert.equal(f[0], 0x01); assert.equal(f[1], 0x20 + 4 + 8); assert.equal(f[2], 0x20); assert.equal(f[3], 48);
  assert.equal(f[f.length - 1], 0x03); assert.equal(f[f.length - 6], 0x05);
  let sum = 0; for (let i = 1; i < f.length - 5; i++) sum += f[i];
  const bcc = [...f.subarray(f.length - 5, f.length - 1)].map((b) => b - 0x30);
  assert.equal((bcc[0] << 12) | (bcc[1] << 8) | (bcc[2] << 4) | bcc[3], sum);
  // the doc's example: 1AE3h → 31 3A 3E 33
  const ans = P.buildAnswer(0x21, 56, '0014,0014');
  const r = P.parseFrame(Buffer.concat([Buffer.from([0x16]), ans, Buffer.from('xx')]));
  assert.equal(r.frame.cmd, 56); assert.equal(r.frame.data, '0014,0014'); assert.equal(r.frame.status.length, 6);
  const bad = Buffer.from(ans); bad[bad.length - 2] ^= 1;
  assert.throws(() => P.parseFrame(bad), FiscalError);
  assert.equal(P.parseFrame(ans.subarray(0, 10)), null);
});

test('status bytes → Macedonian error codes', () => {
  assert.deepEqual(P.decodeStatus([0x80, 0x80, 0x81, 0x80, 0x80, 0x88]).errors, ['PAPER_OUT']);
  assert.deepEqual(P.decodeStatus([0x80, 0x80, 0x80, 0x80, 0x90, 0x88]).errors, ['FM_FULL']);
  assert.ok(P.decodeStatus([0x80, 0x80, 0x88, 0x80, 0x80, 0x88]).receiptOpen);
  assert.ok(P.decodeStatus([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]).warnings.some((w) => /фискализиран/.test(w)));
  // Accent example pf500.err (tutorial mode, all fine): "128, 128, 154, 139, 128, 186"
  assert.deepEqual(P.decodeStatus([128, 128, 154, 139, 128, 186]).errors, []);
});

test('receipt validation and the command list (sale, discount, card + cash, storno reference)', () => {
  const r = normalizeReceipt({ ...RECEIPT, discountPct: 10 }, { nameMax: 25 });
  assert.equal(r.items[1].name, 'Сок јаболко тест');
  assert.equal(r.total, 126.45); // (70 + 70.5) × 0.9
  const L = P.receiptCommands(r, { op: 1, pwd: '0000', till: 1 });
  assert.deepEqual(L.map((c) => c.cmd), [48, 49, 49, 51, 53, 53, 56]);
  assert.equal(L[0].data, '1,0000,1');
  assert.equal(L[1].data, 'Леб бел 500г\tБ35.00*2.000');
  assert.equal(L[3].data, '10,-10.00');
  assert.equal(L[4].data, '\tD50.00');
  assert.equal(L[5].data, '\t');
  const s = P.receiptCommands(normalizeReceipt({ ...RECEIPT, ref: '0000123' }, { storno: true }), { storno: true });
  assert.equal(s[0].cmd, 85); assert.equal(s.at(-1).cmd, 86);
  assert.match(s[1].data, /^Леб бел 500г\nСторно на бр\. 0000123\tБ/);
  assert.throws(() => normalizeReceipt({ ...RECEIPT, ref: '' }, { storno: true }), /сторно/);
  assert.throws(() => normalizeReceipt({ items: [{ name: 'x', qty: 1, price: -5, vat: 'А' }] }), /цена/);
  assert.throws(() => normalizeReceipt({ items: [{ name: 'x', qty: 1, price: 5, vat: 'Ж' }] }), /даночна група/);
  assert.throws(() => normalizeReceipt({ items: [{ name: 'x', qty: 1, price: 5, vat: 'А' }], payments: { card: 6 } }), /картичка/);
  assert.equal(normalizeReceipt({ items: [{ name: 'x', qty: 1, price: 5, vat: 'C' }] }).items[0].vat, 'В');
});

test('raw driver on a simulated PF550: receipt number, time, total', async () => {
  const dev = fakeDevice();
  const d = new DatecsRawDriver({ transport: dev.transport, nameMax: 25, timeoutMs: 200 });
  const r = await d.printReceipt(RECEIPT);
  assert.equal(r.ok, true); assert.equal(r.number, '42'); assert.equal(r.time, '2026-10-12T13:45:07'); assert.equal(r.total, 140.5);
  assert.equal(dev.state.lines.length, 2); assert.equal(dev.state.lines[0].vat, 'Б');
  const z = await d.report('Z');
  assert.deepEqual([z.ok, z.number, z.total], [true, '8', 123.45]);
  const c = await d.cash(1000);
  assert.equal(c.cashSum, 1000);
  await assert.rejects(d.cash(-5000), (e) => e.code === 'NOT_ALLOWED');
  const s = await d.status();
  assert.equal(s.connected, true); assert.equal(s.serial, 'AC123456'); assert.equal(s.fiscal, true);
});

test('raw driver: NAK resend, SYN wait, paper out, open receipt, no device', async () => {
  const a = fakeDevice({ nakOnce: true });
  assert.equal((await new DatecsRawDriver({ transport: a.transport, timeoutMs: 200 }).printReceipt(RECEIPT)).ok, true);
  const b = fakeDevice({ synOnce: true });
  assert.equal((await new DatecsRawDriver({ transport: b.transport, timeoutMs: 200 }).report('Z')).ok, true);
  const p = fakeDevice({ paper: true });
  await assert.rejects(new DatecsRawDriver({ transport: p.transport, timeoutMs: 200 }).printReceipt(RECEIPT), (e) => e.code === 'PAPER_OUT' && /хартија/.test(e.message));
  const o = fakeDevice(); o.state.open = true;
  await assert.rejects(new DatecsRawDriver({ transport: o.transport, timeoutMs: 200 }).printReceipt(RECEIPT), (e) => e.code === 'RECEIPT_OPEN');
  const n = fakeDevice({ silent: true });
  await assert.rejects(new DatecsRawDriver({ transport: n.transport, timeoutMs: 40 }).status(), (e) => e.code === 'NOT_CONNECTED');
  const f = fakeDevice({ failCmd: 56 });
  await assert.rejects(new DatecsRawDriver({ transport: f.transport, timeoutMs: 200 }).printReceipt(RECEIPT), (e) => e.code === 'NOT_ALLOWED' && /отворена/.test(e.message));
});

test('Accent IN file format (Fiscal32.exe / PF500.IN) like the vendor examples', () => {
  const r = normalizeReceipt({ items: [{ name: 'Produkt 1', qty: 1, price: 25, vat: 'А' }, { name: 'Produkt 2', qty: 3, price: 10, vat: 'А' }] });
  const { text, lastSeq } = inFileText(P.receiptCommands(r, {}), 0x1F);
  const bytes = cp.encode(text);
  // " 01,0000,1" / "!1Produkt 1<TAB>А25.00*1.000" … one command per line, CRLF, group letter as byte C0h
  assert.equal(text.split('\r\n')[0], ' 01,0000,1');
  assert.equal(text.split('\r\n')[1], '!1Produkt 1\tА25.00*1.000');
  assert.equal(text.split('\r\n')[3], '#5\t');
  assert.equal(text.split('\r\n')[4], '$8');
  assert.ok(bytes.includes(0xC0)); assert.ok(text.endsWith('\r\n')); assert.equal(lastSeq, 0x24);
  // storno: the reference line (LF) cannot travel in a line-based file
  const s = inFileText(P.receiptCommands(normalizeReceipt({ ...RECEIPT, ref: '9' }, { storno: true }), { storno: true }), 0x20).text;
  assert.ok(!/Сторно на бр/.test(s)); assert.match(s.split('\r\n')[0], /^.U1,0000,1$/);
  assert.deepEqual(parseErrFile('128, 128, 154, 139, 128, 186\r\n128, 136, 154, 139, 128, 186\r\n'), [[128, 128, 154, 139, 128, 186], [128, 136, 154, 139, 128, 186]]);
});

test('command-file driver: answer files from the vendor program (watched folder)', async () => {
  const dir = tmp();
  const d = new CommandFileDriver({ folder: dir, timeoutMs: 3000, stateFile: path.join(dir, 'seq.json') });
  // a fake "vendor service": when PF500.IN appears, answer every line
  const ok = '128, 128, 128, 128, 128, 136';
  const answer = (outLines, errLines) => {
    const t = setInterval(() => {
      if (!fs.existsSync(path.join(dir, 'PF500.IN'))) return;
      clearInterval(t);
      const n = cp.decode(fs.readFileSync(path.join(dir, 'PF500.IN'))).split('\r\n').filter(Boolean).length;
      fs.writeFileSync(path.join(dir, 'pf500.out'), outLines(n).join('\r\n'));
      fs.writeFileSync(path.join(dir, 'pf500.err'), errLines(n).join('\r\n'));
    }, 20);
  };
  answer((n) => ['', '0013,0000', '', '', 'D+000000000', 'R+000000000', '0014,0014', '0000014', '12-10-26 10:00:00'].slice(0, n), (n) => Array(n).fill(ok));
  const r = await d.printReceipt(RECEIPT);
  assert.deepEqual([r.ok, r.number, r.time], [true, '14', '2026-10-12T10:00:00']);
  fs.unlinkSync(path.join(dir, 'PF500.IN'));
  answer((n) => Array(n).fill(''), (n) => Array(n).fill(ok).map((x, i) => (i === 2 ? '128, 128, 129, 128, 128, 136' : x)));
  await assert.rejects(d.printReceipt(RECEIPT), (e) => e.code === 'PAPER_OUT');
  fs.unlinkSync(path.join(dir, 'PF500.IN'));
  await assert.rejects(new CommandFileDriver({ folder: dir, timeoutMs: 300 }).report('X'), (e) => e.code === 'NO_ANSWER_FILE');
});

test('simulator driver logs receipts and counts like a device', async () => {
  const dir = tmp();
  const s = new SimulatorDriver({ logFile: path.join(dir, 'log'), stateFile: path.join(dir, 'st.json'), now: () => new Date(2026, 9, 12, 9, 5, 1) });
  const a = await s.printReceipt(RECEIPT);
  const b = await s.printReceipt({ ...RECEIPT, ref: a.number }, { storno: true });
  assert.deepEqual([a.number, b.number, a.time], ['1', '2', '2026-10-12T09:05:01']);
  const z = await s.report('Z');
  assert.deepEqual([z.number, z.total], ['1', 0]);
  const log = fs.readFileSync(path.join(dir, 'log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((x) => x.type), ['receipt', 'storno', 'Z']);
  assert.equal(new SimulatorDriver({ stateFile: path.join(dir, 'st.json') }).s.receipt, 2); // persisted
  await assert.rejects(new SimulatorDriver({ fault: 'PAPER_OUT' }).printReceipt(RECEIPT), (e) => e.code === 'PAPER_OUT');
});

test('service: configuration rules, queue, results with device, errors as {ok:false, code, error}', async () => {
  const dir = tmp();
  const svc = new FiscalService({ dataDir: dir });
  assert.equal((await svc.printReceipt(RECEIPT)).code, 'NOT_CONFIGURED');
  assert.equal((await svc.status()).configured, false);
  assert.equal(svc.setConfig({ vendor: 'accent', driver: 'tcp', host: '8.8.8.8', tcpPort: 9100 }).ok, false); // LAN only
  assert.equal(svc.setConfig({ vendor: 'accent', driver: 'serial', port: 'COM3; del' }).ok, false);
  assert.equal(svc.setConfig({ vendor: 'duna', driver: 'tcp' }).ok, false);
  assert.equal(svc.setConfig({ vendor: 'sim', model: 'SIM' }).config.driver, 'sim');
  const [a, b] = await Promise.all([svc.printReceipt(RECEIPT), svc.printReceipt(RECEIPT)]);
  assert.deepEqual([a.number, b.number], ['1', '2']); // serialised, never interleaved
  assert.deepEqual(a.device, { vendor: 'sim', model: 'SIM', driver: 'sim' });
  assert.equal((await svc.report('Q')).code, 'INVALID_INPUT');
  svc.setConfig({ fault: 'NOT_CONNECTED' });
  const s = await svc.status();
  assert.equal(s.ok, false); assert.equal(s.code, 'NOT_CONNECTED');
  assert.equal(new FiscalService({ dataDir: dir }).getConfig().config.vendor, 'sim'); // saved in userData/fiscal.json
  assert.throws(() => cleanConfig({ vendor: 'accent', pwd: '12' }), /лозинка/);
  assert.equal(svc.getConfig().config.pwd, '••••'); // never echoed to the page
});

test('service with the raw driver over a fake device (factory)', async () => {
  const dev = fakeDevice();
  const svc = new FiscalService({ dataDir: tmp(), driverFactory: () => new DatecsRawDriver({ transport: dev.transport, timeoutMs: 200 }) });
  svc.setConfig({ vendor: 'accent', model: 'PF550', driver: 'serial', port: 'COM3' });
  const r = await svc.printStorno({ ...RECEIPT, ref: '41' });
  assert.equal(r.ok, true); assert.equal(dev.state.storno, true); assert.equal(r.device.model, 'PF550');
  assert.ok(isLanHost('192.168.1.50') && isLanHost('10.0.0.7') && !isLanHost('172.32.0.1') && !isLanHost('app.example.com'));
});

test('VAT groups: legal default, per-device override validated and saved', () => {
  const VG = require('../vat-groups');
  assert.deepEqual({ ...VG.FISCAL_VAT_GROUPS }, { А: 18, Б: 5, В: 10, Г: 0 });
  assert.deepEqual({ ...cleanConfig({}).groups }, { А: 18, Б: 5, В: 10, Г: 0 });
  assert.deepEqual({ ...cleanConfig({ groups: { V: 0, G: '10%' } }).groups }, { А: 18, Б: 5, В: 0, Г: 10 });
  assert.throws(() => cleanConfig({ groups: { В: 0 } }), /иста стапка/);
  assert.throws(() => cleanConfig({ groups: { А: 20 } }), /18, 10, 5 или 0/);
  const dir = tmp();
  const svc = new FiscalService({ dataDir: dir });
  svc.setConfig({ vendor: 'sim', groups: { В: 0, Г: 10 } });
  assert.deepEqual(new FiscalService({ dataDir: dir }).getConfig().config.groups, { А: 18, Б: 5, В: 0, Г: 10 });
  assert.deepEqual(svc.info().vatGroups, VG.FISCAL_VAT_GROUPS);
  assert.deepEqual(P.parseRates('18.00%,5.00%,10.00%,0.00%'), { А: 18, Б: 5, В: 10, Г: 0 });
  assert.deepEqual(P.parseRates('18.00,X,10.00,0.00'), { А: 18, В: 10, Г: 0 });
  assert.equal(P.parseRates(''), null);
});

test('VAT groups: receipt letters remapped for a device with another programming; X report rates checked', async () => {
  const dev = fakeDevice({ rates: '18.00%,5.00%,0.00%,10.00%' }); // device still programmed В 0 %, Г 10 %
  const svc = new FiscalService({ dataDir: tmp(), driverFactory: () => new DatecsRawDriver({ transport: dev.transport, timeoutMs: 200 }) });
  svc.setConfig({ vendor: 'accent', model: 'PF550', driver: 'serial', port: 'COM3' });
  const R = { items: [{ name: 'Кафе', qty: 1, price: 60, vat: 'В' }, { name: 'Ослободено', qty: 1, price: 10, vat: 'Г' }, { name: 'Леб', qty: 1, price: 35, vat: 'Б' }], payments: {} };
  // legal settings: letters go out unchanged, and the X report warns that the device prints other rates
  assert.equal((await svc.printReceipt(R)).ok, true);
  assert.deepEqual(dev.state.lines.map((l) => l.vat), ['В', 'Г', 'Б']);
  const x = await svc.report('X');
  assert.equal(x.ok, true); assert.equal(x.vatMismatch, true);
  assert.deepEqual(x.rates, { А: 18, Б: 5, В: 0, Г: 10 });
  assert.ok(x.warnings.some((w) => /Група В: на извештајот 0 %, очекувано 10 %/.test(w)));
  assert.ok(x.warnings.some((w) => /Даночни групи на апаратот/.test(w)));
  assert.equal((await svc.status()).vatMismatch, true);
  // settings follow the device: 10 % goes to Г, exempt to В; no warning any more
  svc.setConfig({ groups: { В: 0, Г: 10 } });
  assert.equal((await svc.printReceipt(R)).ok, true);
  assert.deepEqual(dev.state.lines.map((l) => l.vat), ['Г', 'В', 'Б']);
  const x2 = await svc.report('X');
  assert.equal(x2.vatMismatch, undefined); assert.deepEqual(x2.rates, { А: 18, Б: 5, В: 0, Г: 10 });
  // Z report does not ask for rates; firmware without command 97 → no rates, no warning
  assert.equal((await svc.report('Z')).rates, undefined);
  const old = fakeDevice({ rates: null });
  const svc2 = new FiscalService({ dataDir: tmp(), driverFactory: () => new DatecsRawDriver({ transport: old.transport, timeoutMs: 200 }) });
  svc2.setConfig({ vendor: 'accent', model: 'PF550', driver: 'serial', port: 'COM3' });
  const x3 = await svc2.report('X');
  assert.equal(x3.ok, true); assert.equal(x3.rates, undefined);
});

test('VAT groups: simulator reports its programming', async () => {
  const svc = new FiscalService({ dataDir: tmp() });
  svc.setConfig({ vendor: 'sim' });
  const x = await svc.report('X');
  assert.deepEqual(x.rates, { А: 18, Б: 5, В: 10, Г: 0 }); assert.equal(x.vatMismatch, undefined);
});
