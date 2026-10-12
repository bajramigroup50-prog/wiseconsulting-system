'use strict';
// "Command file" driver: the vendor's own Windows program talks to the device; we hand it a command file and read its
// answer files. Format implemented: ACCENT „IN датотека“ (Fiscal32.exe / FISCAL.EXE for Synergy PF500 / PF550,
// accent.mk → Преземања „Примери за IN датотека“):
//
//   PF500.IN   one command per line: <SEQ char><CMD char><data>, cp1251, CRLF  (e.g. " 01,0000,1", "#1Леб\tБ35.00*2.000")
//   pf500.out  one answer line per command (data of the answer, e.g. "0014,0000" after the close)
//   pf500.err  one line per command: the 6 status bytes in decimal ("128, 128, 154, 139, 128, 186")
//
// The program reads its COM settings from fiskal.ini in its own folder. Two modes:
//   • exePath set  → we start the program (cwd = its folder) and wait until it exits;
//   • no exePath   → a vendor service watches the folder; we wait until fresh .out/.err files appear.
// A receipt counts as fiscalised only when the answer files show the close command without an error.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const cp = require('../cp1251');
const P = require('../datecs');
const { FiscalError, normalizeReceipt } = require('../receipt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The IN file text (Unicode; written as cp1251) for a list of { cmd, data } — LF inside data is not allowed here. */
function inFileText(cmds, firstSeq) {
  let s = firstSeq;
  const lines = cmds.map((c) => {
    s = s >= 0x7E ? 0x20 : s + 1;
    const data = String(c.data || '').replace(/\n[^\t]*/g, ''); // no 2nd text line in the line-based file
    return String.fromCharCode(s) + String.fromCharCode(c.cmd) + data;
  });
  return { text: lines.join('\r\n') + '\r\n', lastSeq: s };
}

/** pf500.err → array of status arrays. */
const parseErrFile = (txt) => String(txt || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((x) => Number(x.trim())).filter(Number.isFinite));
/** pf500.out → array of answer lines (kept 1:1 with the commands, blank lines included). */
const parseOutFile = (txt) => String(txt || '').replace(/\r/g, '').split('\n');

class CommandFileDriver {
  /** @param {object} o folder, exePath?, inName, outName, errName, timeoutMs, nameMax, op, pwd, till, stateFile? */
  constructor(o) {
    if (!o.folder) throw new FiscalError('NOT_CONFIGURED', 'папка на програмата на производителот');
    this.o = { inName: 'PF500.IN', outName: 'pf500.out', errName: 'pf500.err', timeoutMs: 30000, nameMax: 22, op: 1, pwd: '0000', till: 1, ...o };
    this.seq = 0x20;
    try { this.seq = Number(JSON.parse(fs.readFileSync(this.o.stateFile, 'utf8')).seq) || 0x20; } catch { /* first run */ }
  }

  file(n) { return path.join(this.o.folder, n); }

  /** Writes the command file, runs / waits for the vendor program, returns [{ data, status }] per command. */
  async run(cmds) {
    if (!fs.existsSync(this.o.folder)) throw new FiscalError('NOT_CONFIGURED', 'папката не постои');
    const out = this.file(this.o.outName), err = this.file(this.o.errName);
    for (const f of [out, err]) { try { fs.unlinkSync(f); } catch { /* none */ } }
    const { text, lastSeq } = inFileText(cmds, this.seq);
    fs.writeFileSync(this.file(this.o.inName), cp.encode(text));
    this.seq = lastSeq;
    if (this.o.stateFile) { try { fs.writeFileSync(this.o.stateFile, JSON.stringify({ seq: lastSeq })); } catch { /* not fatal */ } }
    const started = Date.now();
    if (this.o.exePath) {
      await new Promise((res, rej) => execFile(this.o.exePath, [], { cwd: path.dirname(this.o.exePath), timeout: this.o.timeoutMs, windowsHide: true },
        (e) => (e && e.killed ? rej(new FiscalError('NOT_CONNECTED', 'програмата на производителот не заврши')) : res())));
    }
    while (!(fs.existsSync(out) && fs.existsSync(err))) {
      if (Date.now() - started > this.o.timeoutMs) throw new FiscalError('NO_ANSWER_FILE');
      await sleep(200);
    }
    await sleep(300); // let the program finish writing
    const O = parseOutFile(cp.decode(fs.readFileSync(out)));
    const E = parseErrFile(cp.decode(fs.readFileSync(err)));
    return cmds.map((_, i) => ({ data: (O[i] || '').trim(), status: E[i] || null }));
  }

  /** First command with an error status → FiscalError (missing status for a command = not executed). */
  static check(cmds, answers, from = 0) {
    for (let i = from; i < cmds.length; i++) {
      const st = answers[i].status;
      if (!st || st.length < 6) throw new FiscalError('NO_ANSWER_FILE', `команда ${i + 1}`);
      const d = P.decodeStatus(st);
      if (d.errors.length) throw new FiscalError(d.errors[0]);
    }
  }

  async printReceipt(receipt, { storno = false } = {}) {
    const r = normalizeReceipt(receipt, { nameMax: this.o.nameMax, storno });
    const L = [
      { cmd: P.CMD.STATUS, data: 'X' },
      ...P.receiptCommands(r, { op: this.o.op, pwd: this.o.pwd, till: this.o.till, storno }),
      { cmd: P.CMD.LAST_DOC, data: '' }, { cmd: P.CMD.DATETIME, data: '' },
    ];
    const A = await this.run(L);
    const pre = A[0].status ? P.decodeStatus(A[0].status) : null;
    if (pre && pre.receiptOpen) throw new FiscalError('RECEIPT_OPEN');
    const closeAt = L.length - 3;
    CommandFileDriver.check(L.slice(0, closeAt + 1), A.slice(0, closeAt + 1));
    for (let i = 0; i <= closeAt; i++) {
      if (L[i].cmd === P.CMD.TOTAL && ['F', 'E', 'I'].includes(P.parseTotal(A[i].data).code)) throw new FiscalError('DEVICE_ERROR', 'плаќање');
    }
    const counters = P.parseCounters(A[closeAt].data);
    const last = String(A[closeAt + 1].data || '').trim();
    const number = last && Number(last) > 0 ? String(Number(last)) : String(Number(counters.find((x) => Number(x) > 0) || counters[0] || '') || '');
    return { ok: true, number, time: P.parseDateTime(A[closeAt + 2].data), total: r.total, counters };
  }

  async report(type) {
    const L = [{ cmd: P.CMD.DAILY_REPORT, data: type === 'Z' ? '0' : '2' }];
    const A = await this.run(L);
    CommandFileDriver.check(L, A);
    const d = P.parseDaily(A[0].data);
    return { ok: true, type, number: type === 'Z' ? String(Number(d.closure) || d.closure) : '', total: d.total };
  }

  async cash(amount) {
    const v = Number(amount);
    if (!Number.isFinite(v) || v === 0) throw new FiscalError('INVALID_INPUT', 'износ');
    const L = [{ cmd: P.CMD.CASH, data: (v > 0 ? '+' : '-') + P.money(Math.abs(v)) }];
    const A = await this.run(L);
    CommandFileDriver.check(L, A);
    const p = A[0].data.split(',');
    if (p[0] !== 'P') throw new FiscalError('NOT_ALLOWED');
    return { ok: true, cashSum: Number(p[1]) || 0 };
  }

  async status() {
    const L = [{ cmd: P.CMD.STATUS, data: 'X' }, { cmd: P.CMD.DIAG, data: '0' }];
    const A = await this.run(L);
    if (!A[0].status) throw new FiscalError('NO_ANSWER_FILE');
    const st = P.decodeStatus(A[0].status);
    return { ok: !st.errors.length, connected: true, fiscal: st.fiscal, receiptOpen: st.receiptOpen, errors: st.errors, warnings: st.warnings, ...P.parseDiag(A[1].data) };
  }

  async lastReceipt() {
    const L = [{ cmd: P.CMD.LAST_DOC, data: '' }];
    const A = await this.run(L);
    CommandFileDriver.check(L, A);
    return { ok: true, number: String(Number(A[0].data) || A[0].data) };
  }

  async testPrint() { const L = [{ cmd: P.CMD.DIAG_PRINT, data: '' }]; CommandFileDriver.check(L, await this.run(L)); return { ok: true }; }
  async close() {}
}

module.exports = { CommandFileDriver, inFileText, parseErrFile, parseOutFile };
