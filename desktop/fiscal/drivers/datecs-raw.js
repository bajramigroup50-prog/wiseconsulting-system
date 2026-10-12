'use strict';
// Raw-protocol driver (Datecs family: ACCENT Synergy PF500/PF550/PF700, DAVID Expert SX / Daisy ISL — see datecs.js).
// Talks to the device directly over a transport (COM or LAN). One command at a time; the caller serialises jobs.
const P = require('../datecs');
const { FiscalError, normalizeReceipt } = require('../receipt');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class DatecsRawDriver {
  /**
   * @param {object} o  transport (see transport.js), nameMax, op, pwd, till, timeoutMs (one answer, default 1000),
   *                     longMs (overall limit for long jobs while the device sends SYN, default 120 s)
   */
  constructor(o) {
    this.t = o.transport;
    this.nameMax = o.nameMax || 22;
    this.op = o.op || 1; this.pwd = o.pwd || '0000'; this.till = o.till || 1;
    this.timeoutMs = o.timeoutMs || 1000;
    this.longMs = o.longMs || 120000;
    this.seq = 0x20 + Math.floor(Math.random() * 0x5F);
    this.buf = Buffer.alloc(0);
    this.waiter = null;
    this.opened = false;
  }

  async open() {
    if (this.opened) return;
    this.t.onData((d) => { this.buf = Buffer.concat([this.buf, d]); if (this.waiter) this.waiter(); });
    await this.t.open();
    this.opened = true;
  }
  async close() { if (this.opened) { this.opened = false; await this.t.close(); } }

  nextSeq() { this.seq = this.seq >= 0x7F ? 0x20 : this.seq + 1; return this.seq; }

  /** Waits until the buffer holds a NAK, a SYN or a complete frame; resolves with what it found or null on time-out. */
  readAnswer(ms) {
    return new Promise((resolve) => {
      const check = () => {
        while (this.buf.length) {
          const b = this.buf[0];
          if (b === P.NAK || b === P.SYN) { this.buf = this.buf.subarray(1); done(b === P.NAK ? 'NAK' : 'SYN'); return; }
          if (b !== P.SOH) { this.buf = this.buf.subarray(1); continue; }
          let r;
          try { r = P.parseFrame(this.buf); } catch (e) { this.buf = Buffer.alloc(0); done({ bad: e }); return; }
          if (!r) return; // incomplete
          this.buf = Buffer.from(r.rest);
          done({ frame: r.frame });
          return;
        }
      };
      const timer = setTimeout(() => done(null), ms);
      const done = (v) => { clearTimeout(timer); this.waiter = null; resolve(v); };
      this.waiter = check;
      check();
    });
  }

  /** Sends one command, handles NAK / SYN / time-outs (resend with the same SEQ), checks the status bytes. */
  async cmd(cmd, data = '', { allowErrors = false } = {}) {
    await this.open();
    const seq = this.nextSeq();
    const frame = P.buildFrame(seq, cmd, data);
    const started = Date.now();
    let tries = 0;
    await this.t.write(frame);
    for (;;) {
      const a = await this.readAnswer(this.timeoutMs);
      if (a === 'SYN') { if (Date.now() - started > this.longMs) throw new FiscalError('NOT_CONNECTED', 'апаратот не заврши'); continue; }
      if (a === null || a === 'NAK' || (a && a.bad)) {
        if (++tries > 3) throw new FiscalError('NOT_CONNECTED');
        await wait(60);
        await this.t.write(frame); // same SEQ → the device repeats its last answer instead of executing twice
        continue;
      }
      const f = a.frame;
      if (f.seq !== seq || f.cmd !== cmd) continue; // stale answer of an earlier command
      const st = P.decodeStatus(f.status);
      if (st.errors.length && !allowErrors) throw new FiscalError(st.errors[0]);
      return { data: f.data, status: st };
    }
  }

  async status() {
    const s = await this.cmd(P.CMD.STATUS, 'X', { allowErrors: true });
    let diag = { firmware: '', serial: '', fm: '' };
    try { diag = P.parseDiag((await this.cmd(P.CMD.DIAG, '0', { allowErrors: true })).data); } catch { /* optional */ }
    // answer data of 74 = the status bytes themselves on some firmwares; the trailing status field is authoritative
    const st = s.status;
    return { ok: !st.errors.length, connected: true, fiscal: st.fiscal, receiptOpen: st.receiptOpen, errors: st.errors, warnings: st.warnings, ...diag };
  }

  async printReceipt(receipt, { storno = false } = {}) {
    const r = normalizeReceipt(receipt, { nameMax: this.nameMax, storno });
    const pre = await this.cmd(P.CMD.STATUS, 'X', { allowErrors: true });
    if (pre.status.receiptOpen) throw new FiscalError('RECEIPT_OPEN');
    if (pre.status.errors.length) throw new FiscalError(pre.status.errors[0]);
    const L = P.receiptCommands(r, { op: this.op, pwd: this.pwd, till: this.till, storno });
    let opened = false, counters = [];
    try {
      for (const c of L) {
        const a = await this.cmd(c.cmd, c.data);
        if (c.cmd === P.CMD.OPEN || c.cmd === P.CMD.OPEN_STORNO) opened = true;
        if (c.cmd === P.CMD.TOTAL) {
          const t = P.parseTotal(a.data);
          if (['F', 'E', 'I'].includes(t.code)) throw new FiscalError('DEVICE_ERROR', `плаќање (${t.code})`);
        }
        if (c.cmd === P.CMD.CLOSE || c.cmd === P.CMD.CLOSE_STORNO) counters = P.parseCounters(a.data);
      }
    } catch (e) {
      if (opened && e instanceof FiscalError) e.message += ' Сметката можеби остана отворена на апаратот.';
      throw e;
    }
    // the receipt is closed = fiscalised. Number: last printed document (113), else the counter from the close answer.
    let number = '';
    try { number = String((await this.cmd(P.CMD.LAST_DOC)).data || '').trim(); } catch { /* older firmware */ }
    if (!number) number = counters.find((x) => Number(x) > 0) || counters[0] || '';
    let time = '';
    try { time = P.parseDateTime((await this.cmd(P.CMD.DATETIME)).data); } catch { /* keep empty */ }
    return { ok: true, number: String(Number(number) || number), time, total: r.total, counters };
  }

  async report(type) {
    const a = await this.cmd(P.CMD.DAILY_REPORT, type === 'Z' ? '0' : '2');
    const d = P.parseDaily(a.data);
    return { ok: true, type, number: type === 'Z' ? String(Number(d.closure) || d.closure) : '', total: d.total };
  }

  async cash(amount) {
    const v = Number(amount);
    if (!Number.isFinite(v) || v === 0 || Math.abs(v) > 9999999) throw new FiscalError('INVALID_INPUT', 'износ');
    const a = await this.cmd(P.CMD.CASH, (v > 0 ? '+' : '-') + P.money(Math.abs(v)));
    const p = String(a.data || '').split(',');
    if (p[0] !== 'P') throw new FiscalError('NOT_ALLOWED', 'нема доволно готовина или има отворена сметка');
    return { ok: true, cashSum: Number(p[1]) || 0 };
  }

  async lastReceipt() {
    const a = await this.cmd(P.CMD.LAST_DOC);
    return { ok: true, number: String(Number(a.data) || a.data || '').trim() };
  }

  /** The VAT rates programmed in the device (command 97), or null when the firmware does not answer it. */
  async vatRates() {
    const a = await this.cmd(P.CMD.VAT_RATES);
    return P.parseRates(a.data);
  }

  async testPrint() { await this.cmd(P.CMD.DIAG_PRINT); return { ok: true }; }
}

module.exports = { DatecsRawDriver };
