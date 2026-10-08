import { describe, expect, it } from 'vitest';
import {
  allocatePayment, autoMatch, bankPaid, bmSubset, feeFix, fxToMkd, learnOsnov, openAmount, orphanBankRows, pairConversions,
  SUBSET_MAX_ITEMS, supplierKonto, type BankAccount, type BankRow, type OpenDoc,
} from './bank-match';

const acc: BankAccount[] = [{ id: 'main', konto: '1000' }, { id: 'eur', konto: '1030', cur: 'EUR' }];
const doc = (id: string, total: number, o: Partial<OpenDoc> = {}): OpenDoc => ({ id, number: id, date: '2026-01-01', total, ...o });

describe('subset sum is bounded', () => {
  it('only the oldest 14 documents are tried, even with hundreds open', () => {
    const P = Array.from({ length: 400 }, (_, i) => ({ o: 1000 + i }));
    const t0 = Date.now();
    expect(bmSubset(P, 1000 + 1001)).toEqual([P[0], P[1]]);
    expect(bmSubset(P, 1000 + 1399)).toBeNull(); // 15th+ document never considered
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(SUBSET_MAX_ITEMS).toBe(14);
  });
  it('needs at least two documents', () => {
    expect(bmSubset([{ o: 5 }, { o: 7 }], 5)).toBeNull();
  });
});

describe('allocation and open amounts', () => {
  it('caps each document at its open amount (FIX #8)', () => {
    const r = allocatePayment(1500, [{ x: doc('a', 600), o: 600 }, { x: doc('b', 600), o: 600 }], 'invoice');
    expect(r.refs.map((x) => x.amt)).toEqual([600, 600]);
    expect(r.excess).toBe(300);
  });
  it('bankPaid counts settle, |amount| and refs', () => {
    const rows: BankRow[] = [
      { id: '1', date: '2026-01-02', amount: 500, ref: { type: 'invoice', id: 'a', label: 'a' } },
      { id: '2', date: '2026-01-02', amount: 800, ref: { type: 'invoice', id: 'a', label: 'a' }, settle: 700 },
      { id: '3', date: '2026-01-02', amount: 1000, ref: { type: 'invoice', id: 'b', label: 'b, a' }, refs: [{ type: 'invoice', id: 'b', label: 'b', amt: 600 }, { type: 'invoice', id: 'a', label: 'a', amt: 400 }] },
    ];
    expect(bankPaid(rows, 'invoice', 'a')).toBe(1600);
    expect(bankPaid(rows, 'invoice', 'b')).toBe(600);
    expect(openAmount(rows, 'invoice', doc('a', 2000, { paidOther: 100 }))).toBe(300);
    expect(openAmount([], 'purchase', doc('c', 900, { cash: true }))).toBe(0);
  });
  it('supplierKonto', () => {
    expect(supplierKonto(doc('a', 1))).toBe('2200');
    expect(supplierKonto(doc('a', 1, { imp: true }))).toBe('2210');
    expect(supplierKonto(doc('a', 1, { imp: true, supKonto: '2215' }))).toBe('2215');
  });
});

describe('rules and helpers', () => {
  it('feeFix moves fees off 2200/4400 (FIX #2)', () => {
    const rows: BankRow[] = [
      { id: '1', date: '2026-02-01', amount: -350, konto: '4400', desc: 'Надомест за одржување на сметка', ai: true },
      { id: '2', date: '2026-02-01', amount: -350, konto: '4400', desc: 'Кирија' },
      { id: '3', date: '2025-02-01', amount: -350, konto: '2200', desc: 'провизија' },
    ];
    expect(feeFix(rows, 2026)).toEqual([{ id: '1', date: '2026-02-01', amount: -350, konto: '4460', desc: 'Надомест за одржување на сметка' }]);
  });
  it('learnOsnov learns only user bookings off 12/22', () => {
    expect(learnOsnov({}, { id: '1', date: '', amount: -5, osnov: '930', konto: '4199' })).toEqual({ '930|out': '4199' });
    expect(learnOsnov({}, { id: '1', date: '', amount: -5, osnov: '930', konto: '2200' })).toBeNull();
    expect(learnOsnov({ '930|out': '4199' }, { id: '1', date: '', amount: -5, osnov: '930', konto: '4199' })).toBeNull();
  });
  it('fxToMkd prefers the bank counter-value', () => {
    expect(fxToMkd(100000, 61.55)).toBe(6155000);
    expect(fxToMkd(-100000, 61.55, 6150000)).toBe(-6150000);
  });
  it('orphan rows (FIX #9)', () => {
    expect(orphanBankRows([{ id: '1', acct: 'gone', date: '', amount: 1 }, { id: '2', date: '', amount: 1 }], acc).map((r) => r.id)).toEqual(['1']);
  });
  it('pairConversions marks the FX side neutral', () => {
    const rows: BankRow[] = [
      { id: 'm', acct: 'main', date: '2026-03-01', amount: -61500, konto: '1030', conv: true },
      { id: 'f', acct: 'eur', date: '2026-03-01', amount: 61400, amountCur: 100000, konto: '1039', own: true },
      { id: 'g', acct: 'eur', date: '2026-03-02', amount: 61400, konto: '1039', own: true },
    ];
    expect(pairConversions(rows, acc)).toEqual([{ ...rows[1], konto: '1030', conv: true, own: true }]);
  });
  it('rows already booked or linked are never touched', () => {
    const r = autoMatch({
      rows: [{ id: '1', date: '2026-01-05', amount: 1000, konto: '7400' }, { id: '2', date: '2026-01-05', amount: 1000, ref: { type: 'invoice', id: 'a', label: 'a' } }],
      accounts: acc, invoices: [doc('a', 1000)], purchases: [], partners: [], year: 2026,
    });
    expect(r.changes).toEqual([]);
  });
});
