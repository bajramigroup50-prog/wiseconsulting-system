import { describe, expect, it } from 'vitest';
import { cardFromRead, compareCardsPeriod, supplierWarnings } from './finpar-cards';

describe('card comparison with period mode (legacy rfRun v432/v433)', () => {
  const A = [{ date: '2025-12-20', doc: '1', desc: 'ф-ра 1', debit: 100, credit: 0 }, { date: '2026-01-10', doc: '2', desc: 'ф-ра 2', debit: 200, credit: 0 }, { date: '2026-02-10', doc: '3', desc: 'ф-ра 3', debit: 50, credit: 0 }];
  const B = [{ date: '2026-01-10', doc: '2', desc: 'ф-ра 2', debit: 0, credit: 200 }];
  it('auto = common period, card 2 without opening → opening not compared', () => {
    const X = compareCardsPeriod(A, B)!;
    expect([X.from, X.to, X.mirror, X.cmpPre, X.difPer]).toEqual(['2026-01-10', '2026-01-10', true, false, 0]);
    expect(X.preA).toBe(100);
  });
  it('year mode puts earlier rows in the opening and compares the whole year', () => {
    const X = compareCardsPeriod(A, B, { mode: 'year', year: 2026 })!;
    expect([X.from, X.to, X.difPer, X.M.onlyO.length]).toEqual(['2026-01-01', '2026-12-31', 50, 1]);
    const all = compareCardsPeriod(A, B, { mode: 'all' })!;
    expect([all.from, all.cmpPre, all.difPer]).toEqual(['2025-12-20', false, 150]);
  });
});

describe('partner card read (legacy recParse AI branch)', () => {
  it('normalises dates and amounts, drops empty rows', () => {
    const X = cardFromRead({ opening: 100, rows: [{ date: '05.03.2026', doc: 'Ф-1', desc: 'фактура', debit: '1180', credit: 0 }, { date: '2026-03-06', debit: 0, credit: 0 }] });
    expect(X).toEqual({ opening: 100, rows: [{ date: '2026-03-05', doc: 'Ф-1', desc: 'фактура', debit: 1180, credit: 0 }] });
  });
});

const f = (n: number) => n.toFixed(2);
describe('supplier warnings (legacy supWarn 8485 + 8621)', () => {
  it('regular supplier without last month invoice, unlinked payments, debit balance', () => {
    const W = supplierWarnings({
      pid: 'p', name: 'ЕВН', today: '2026-06-15', year: '2026', purchaseMonths: ['2026-02', '2026-03', '2026-04'],
      unlinkedPays: [{ date: '2026-05-10', amount: -500 }, { date: '2026-06-01', amount: -300 }], openInvoices: 100, balance22: 5, fmt: f,
    });
    expect(W.map((w) => w.lvl)).toEqual(['bad', 'warn', 'warn']);
    expect(W[1]!.txt).toContain('за 05/2026 нема влезна фактура');
    expect(W[2]!.txt).toContain('2 плаќања (800.00 ден., последно 01.06.2026)');
  });
  it('quiet before the 10th and when invoices cover the payments', () => {
    expect(supplierWarnings({ pid: 'p', name: 'X', today: '2026-06-05', year: '2026', purchaseMonths: ['2026-02', '2026-03', '2026-04'], unlinkedPays: [{ date: '2026-05-10', amount: -50 }], openInvoices: 100, balance22: 0, fmt: f })).toEqual([]);
  });
});
