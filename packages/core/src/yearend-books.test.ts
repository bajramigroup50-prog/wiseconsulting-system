import { describe, expect, it } from 'vitest';
import { cashBook, npoDbRows, npoIncomeBook, npoSmall, tpBook, tpKps } from './yearend/books';
import type { LedgerLine } from './ledger';

const L: LedgerLine[] = [
  { account: '7150', debit: 0, credit: 1000, date: '2026-02-01', number: 'Ф-1', note: 'Услуга', partnerId: 'p1' },
  { account: '1010', debit: 1000, credit: 0, date: '2026-02-01', number: 'Б-1' },
  { account: '4400', debit: 300, credit: 0, date: '2026-01-15', number: 'Ф-2' },
  { account: '1010', debit: 0, credit: 300, date: '2026-01-15', number: 'Б-2' },
  { account: '7150', debit: 1000, credit: 0, date: '2026-12-31', kind: 'close' },
  { account: '1000', debit: 50, credit: 0, date: '2026-01-01', kind: 'open' },
];

describe('simple bookkeeping books', () => {
  it('ДБ-НП rows 01–04 by chart', () => {
    const B = { 7100: { d: 0, p: 200, s: -200 }, 7150: { d: 0, p: 1000, s: -1000 }, 7470: { d: 0, p: 50, s: -50 }, 7400: { d: 0, p: 10, s: -10 }, 7500: { d: 0, p: 5, s: -5 } };
    expect(npoDbRows(B, true).map((r) => r[2])).toEqual([210, 1000, 50, 0]);
    expect(npoDbRows(B, false).map((r) => r[2])).toEqual([200, 1000, 10, 5]);
  });
  it('income book and cash book', () => {
    const I = npoIncomeBook(L, { 4400: 'Трошоци' });
    expect(I.map((r) => [r.date, r.inc, r.exp, r.text])).toEqual([['2026-01-15', 0, 300, 'Трошоци'], ['2026-02-01', 1000, 0, 'Услуга']]);
    expect(cashBook(L).map((r) => r.bal)).toEqual([-300, 700]);
    expect(npoSmall(100000, 50000)).toBe(true);
    expect(npoSmall(200000, 0)).toBe(false);
  });
  it('КП / КТ / КПС', () => {
    expect(tpBook('kp', L, {}, { p1: 'Купувач' })).toEqual([{ no: 1, date: '2026-02-01', doc: 'Ф-1', who: 'Купувач · Услуга', konto: '7150', amt: 1000 }]);
    expect(tpBook('kt', L, {}).map((r) => r.amt)).toEqual([300]);
    expect(tpKps(L, {}).map((r) => [r.k, r.s])).toEqual([['1000', 50], ['1010', 700]]);
  });
});
