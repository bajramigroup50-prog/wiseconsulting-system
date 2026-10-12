'use strict';
// SIMULATOR driver — for demos, training and tests: no device, every receipt / report is appended to a log file
// (JSON lines) and counted like a real device (receipt number, Z number, cash in the drawer).
// `fault` makes it behave like a broken device: 'PAPER_OUT' | 'NOT_CONNECTED' | 'FM_FULL' | 'COVER_OPEN' | ''.
const fs = require('node:fs');
const { FiscalError, normalizeReceipt, r2 } = require('../receipt');

class SimulatorDriver {
  /** @param {object} o logFile, stateFile, fault?, nameMax? , now?() */
  constructor(o) {
    this.o = { nameMax: 22, now: () => new Date(), ...o };
    this.s = { receipt: 0, z: 0, cash: 0, day: { sales: 0, storno: 0, count: 0 } };
    try { this.s = { ...this.s, ...JSON.parse(fs.readFileSync(this.o.stateFile, 'utf8')) }; } catch { /* first run */ }
  }
  time() { const d = this.o.now(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
  save() { if (this.o.stateFile) fs.writeFileSync(this.o.stateFile, JSON.stringify(this.s)); }
  log(e) { if (this.o.logFile) fs.appendFileSync(this.o.logFile, JSON.stringify({ at: this.time(), ...e }) + '\n'); }
  guard() { if (this.o.fault) throw new FiscalError(this.o.fault); }

  async status() {
    if (this.o.fault === 'NOT_CONNECTED') throw new FiscalError('NOT_CONNECTED');
    const errors = this.o.fault ? [this.o.fault] : [];
    return { ok: !errors.length, connected: true, fiscal: false, receiptOpen: false, errors, warnings: ['СИМУЛАТОР — не е вистински фискален апарат.'], firmware: 'SIM 1.0', serial: 'SIM00001', fm: 'SIM' };
  }

  async printReceipt(receipt, { storno = false } = {}) {
    this.guard();
    const r = normalizeReceipt(receipt, { nameMax: this.o.nameMax, storno });
    this.s.receipt += 1;
    const cash = r2(r.total - r.payments.card);
    this.s.cash = r2(this.s.cash + (storno ? -cash : cash));
    this.s.day.count += 1;
    if (storno) this.s.day.storno = r2(this.s.day.storno + r.total); else this.s.day.sales = r2(this.s.day.sales + r.total);
    const number = String(this.s.receipt);
    const time = this.time();
    this.save();
    this.log({ type: storno ? 'storno' : 'receipt', number, total: r.total, items: r.items, discountPct: r.discountPct, payments: { card: r.payments.card, cash }, ref: r.ref || undefined });
    return { ok: true, number, time, total: r.total, counters: [number] };
  }

  async report(type) {
    this.guard();
    const total = r2(this.s.day.sales - this.s.day.storno);
    let number = '';
    if (type === 'Z') { this.s.z += 1; number = String(this.s.z); this.s.day = { sales: 0, storno: 0, count: 0 }; this.save(); }
    this.log({ type, number, total });
    return { ok: true, type, number, total };
  }

  async cash(amount) {
    this.guard();
    const v = r2(Number(amount));
    if (!Number.isFinite(v) || v === 0) throw new FiscalError('INVALID_INPUT', 'износ');
    if (this.s.cash + v < 0) throw new FiscalError('NOT_ALLOWED', 'нема доволно готовина');
    this.s.cash = r2(this.s.cash + v);
    this.save();
    this.log({ type: v > 0 ? 'cashIn' : 'cashOut', amount: Math.abs(v) });
    return { ok: true, cashSum: this.s.cash };
  }

  async lastReceipt() { return { ok: true, number: String(this.s.receipt) }; }
  async testPrint() { this.guard(); this.log({ type: 'test' }); return { ok: true }; }
  async close() {}
}

module.exports = { SimulatorDriver };
