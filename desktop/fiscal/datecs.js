'use strict';
// Datecs-family fiscal printer protocol — used by ACCENT Synergy PF500 / PF550 / PF700 (manufactured by Datecs,
// "Control codes PF550 v1.36" / "Контролни кодови PF550 PF700 v1.40", accent.mk → Преземања) and, per the open-source
// driver tinodj/mk-fiscal-printer-driver, also by DAVID Expert SX (Daisy ISL, same framing and commands 48/49/53/56/69).
//
// Host → printer   <01><LEN><SEQ><CMD><DATA><05><BCC><03>
// Printer → host   <01><LEN><SEQ><CMD><DATA><04><STATUS×6><05><BCC><03>     or one byte NAK 15h / SYN 16h
//   LEN = bytes after <01> up to and including <05>, + 20h;  SEQ 20h–7Fh (a repeated SEQ makes the printer resend
//   its last answer instead of executing again);  BCC = 16-bit sum of the bytes after <01> up to <05> inclusive,
//   sent as 4 nibbles + 30h (1AE3h → 31 3A 3E 33).  RS232 9600 (or 19200) baud 8N1; answer within 60 ms, SYN every
//   60 ms while busy, host time-out 500 ms → resend with the same SEQ.
const cp = require('./cp1251');
const { FiscalError, r2 } = require('./receipt');

const SOH = 0x01, ENQ = 0x05, SEP = 0x04, ETX = 0x03, NAK = 0x15, SYN = 0x16;

/** Commands (decimal codes from the PF550/PF700 control-code tables). */
const CMD = Object.freeze({
  OPEN: 48, SALE: 49, SUBTOTAL: 51, TOTAL: 53, CLOSE: 56, OPEN_STORNO: 85, CLOSE_STORNO: 86,
  DATETIME: 62, DAILY_REPORT: 69, CASH: 70, DIAG_PRINT: 71, STATUS: 74, TRANSACTION: 76, DIAG: 90, VAT_RATES: 97, LAST_DOC: 113,
});

const bcc4 = (sum) => [12, 8, 4, 0].map((s) => ((sum >> s) & 0xF) + 0x30);

/** One host → printer frame. `data` = Buffer (already cp1251) or string. */
function buildFrame(seq, cmd, data) {
  const d = Buffer.isBuffer(data) ? data : cp.encode(data || '');
  if (d.length > 91) throw new FiscalError('INVALID_INPUT', 'премногу податоци за една команда');
  const len = 0x20 + 4 + d.length; // LEN SEQ CMD DATA… ENQ
  const body = Buffer.concat([Buffer.from([len, seq, cmd]), d, Buffer.from([ENQ])]);
  let sum = 0;
  for (const b of body) sum += b;
  return Buffer.concat([Buffer.from([SOH]), body, Buffer.from(bcc4(sum & 0xFFFF)), Buffer.from([ETX])]);
}

/**
 * Parses one printer → host frame from `buf` (starting at SOH). Returns null if incomplete,
 * { frame, rest } when complete; throws on a bad checksum.
 */
function parseFrame(buf) {
  const start = buf.indexOf(SOH);
  if (start < 0) return null;
  const end = buf.indexOf(ETX, start);
  if (end < 0) return null;
  const f = buf.subarray(start, end + 1);
  const enq = f.lastIndexOf(ENQ);
  const sep = f.indexOf(SEP);
  if (enq < 0 || f.length - enq !== 6) throw new FiscalError('DEVICE_ERROR', 'неважечка порака од апаратот');
  let sum = 0;
  for (let i = 1; i <= enq; i++) sum += f[i];
  const want = Buffer.from(bcc4(sum & 0xFFFF));
  if (!want.equals(f.subarray(enq + 1, enq + 5))) throw new FiscalError('DEVICE_ERROR', 'погрешна контролна сума');
  const seq = f[2], cmd = f[3];
  const data = sep > 0 ? f.subarray(4, sep) : f.subarray(4, enq);
  const status = sep > 0 ? [...f.subarray(sep + 1, enq)] : [];
  return { frame: { seq, cmd, data: cp.decode(data), status }, rest: buf.subarray(end + 1) };
}

/** Builds a printer → host answer (used by the device simulator in the tests). */
function buildAnswer(seq, cmd, data, status) {
  const d = Buffer.isBuffer(data) ? data : cp.encode(data || '');
  const st = Buffer.from(status || [0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
  const len = 0x20 + 4 + d.length + 1 + st.length;
  const body = Buffer.concat([Buffer.from([len, seq, cmd]), d, Buffer.from([SEP]), st, Buffer.from([ENQ])]);
  let sum = 0;
  for (const b of body) sum += b;
  return Buffer.concat([Buffer.from([SOH]), body, Buffer.from(bcc4(sum & 0xFFFF)), Buffer.from([ETX])]);
}

/**
 * The 6 status bytes → { errors: [code…], warnings: [text…], receiptOpen, fiscal }.
 * Bits marked „#“ / „*“ in the control-code table are errors (the command was rejected).
 */
function decodeStatus(s) {
  const b = (i, bit) => !!(s && s.length > i && (s[i] & (1 << bit)));
  const errors = [], warnings = [];
  if (b(2, 0)) errors.push('PAPER_OUT');
  if (b(1, 5)) errors.push('COVER_OPEN');
  if (b(0, 4)) errors.push('PRINTER_FAULT');
  if (b(4, 4)) errors.push('FM_FULL');
  if (b(4, 0) || b(5, 0)) errors.push('FM_ERROR');
  if (b(0, 2)) errors.push('CLOCK');
  if (b(1, 0)) errors.push('OVERFLOW');
  if (b(0, 1) || b(0, 0)) errors.push('SYNTAX');
  if (b(1, 1)) errors.push('NOT_ALLOWED');
  if (b(1, 4) || b(1, 2)) warnings.push('Работната меморија на апаратот беше избришана — проверете ги поставките.');
  if (b(2, 1) || b(2, 4)) warnings.push('Хартијата е при крај.');
  if (b(4, 3)) warnings.push('Фискалната меморија е речиси полна (под 50 записи).');
  const fiscal = b(5, 3);
  if (s && s.length >= 6 && !fiscal) warnings.push('Апаратот не е фискализиран (обука / тест режим).');
  return { errors, warnings, receiptOpen: b(2, 3) || b(2, 5), fiscal };
}

const money = (v) => r2(v).toFixed(2);
const qtyS = (v) => (Math.round(v * 1000) / 1000).toFixed(3);

/**
 * Commands of a fiscal (or storno) receipt from a normalised receipt (see receipt.js normalizeReceipt).
 * opts: { op = 1, pwd = '0000', till = 1, storno = false }.
 */
function receiptCommands(r, opts = {}) {
  const op = opts.op || 1, pwd = String(opts.pwd || '0000'), till = opts.till || 1;
  const L = [{ cmd: opts.storno ? CMD.OPEN_STORNO : CMD.OPEN, data: `${op},${pwd},${till}` }];
  r.items.forEach((it, i) => {
    // [L1][<LF>L2]<TAB>[@]<group><price>*<qty> — the storno reference goes into the 2nd text line of the first item
    const l2 = opts.storno && i === 0 && r.ref ? '\n' + `Сторно на бр. ${r.ref}`.slice(0, 25) : '';
    L.push({ cmd: CMD.SALE, data: `${it.name}${l2}\t${it.mk ? '@' : ''}${it.vat}${money(it.price)}*${qtyS(it.qty)}` });
  });
  if (r.discountPct > 0) L.push({ cmd: CMD.SUBTOTAL, data: `10,-${r.discountPct.toFixed(2)}` });
  if (r.payments.card > 0) L.push({ cmd: CMD.TOTAL, data: `\tD${money(r.payments.card)}` });
  L.push({ cmd: CMD.TOTAL, data: '\t' }); // the rest in cash („no data after <Tab>“ = pay everything in cash)
  L.push({ cmd: opts.storno ? CMD.CLOSE_STORNO : CMD.CLOSE, data: '' });
  return L;
}

/** Answer of 53 (TOTAL): <PaidCode><Amount>; F/E/I = error, D = still due, R = change. */
function parseTotal(data) {
  const code = String(data || '').charAt(0);
  const amount = Number(String(data || '').slice(1)) || 0;
  return { code, amount };
}
/** Answer of 48/56/85/86: two counters (Allreceipt,FiscReceipt — PF550; FiscReceipt,StorReceipt — PF700 v1.40). */
const parseCounters = (data) => String(data || '').split(',').map((x) => x.trim()).filter(Boolean);
/** Answer of 69 (daily report): Closure,FM_Total,TotalA,TotalB,TotalC,TotalD. */
function parseDaily(data) {
  const p = String(data || '').split(',');
  return { closure: (p[0] || '').trim(), total: Number(p[1]) || 0, groups: p.slice(2, 6).map((x) => Number(x) || 0) };
}
/**
 * Answer of 97 (current VAT rates, Datecs family — за проверка on PF550/PF700 and DAVID firmware): TaxA,TaxB,TaxC,TaxD
 * as percentages („18.00%,5.00%,10.00%,0.00%“; a disabled group may be „X“ / „-“). → { А, Б, В, Г } or null.
 */
function parseRates(data) {
  const p = String(data || '').split(',').map((x) => x.trim());
  if (p.length < 4) return null;
  const L = ['А', 'Б', 'В', 'Г'], out = {};
  p.slice(0, 4).forEach((x, i) => { const n = Number(x.replace('%', '')); if (x && Number.isFinite(n)) out[L[i]] = Math.round(n * 100) / 100; });
  return Object.keys(out).length ? out : null;
}
/** Answer of 62: DD-MM-YY HH:MM:SS → ISO local time string (YYYY-MM-DDTHH:MM:SS) or ''. */
function parseDateTime(data) {
  const m = /^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(data || '').trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}` : '';
}
/** Answer of 90 (diagnostics): FwRev FwDate FwTime,Chk,Sw,Country,Ser,FM → { firmware, serial, fm }. */
function parseDiag(data) {
  const p = String(data || '').split(',');
  return { firmware: (p[0] || '').trim(), serial: (p[4] || '').trim(), fm: (p[5] || '').trim() };
}

module.exports = {
  SOH, ENQ, SEP, ETX, NAK, SYN, CMD,
  buildFrame, parseFrame, buildAnswer, decodeStatus, receiptCommands,
  parseTotal, parseCounters, parseDaily, parseDateTime, parseDiag, parseRates, money,
};
