import { describe, expect, it } from 'vitest';
import { kdBuckets, kdData, kdMonths, kdRange, kdRank } from './kldash';

describe('klDash (legacy kdRange / kdData / kdMon / kdRank)', () => {
  it('ranges', () => {
    expect(kdRange('pm', 2026, '2026-03-15')).toEqual(['2026-02-01', '2026-02-28', 'Претходен месец']);
    expect(kdRange('q', 2026, '2026-05-15')).toEqual(['2026-04-01', '2026-05-15', 'Тековен квартал']);
    expect(kdRange('7', 2026, '2026-05-15')[0]).toBe('2026-05-09');
    expect(kdRange(undefined, 2025, '2026-05-15')).toEqual(['2025-01-01', '2025-12-31', 'Од почеток на годината']);
    expect(kdRange('c', 2026, '2026-05-15', { from: '2026-02-01', to: 'x' })).toEqual(['2026-02-01', '2026-05-15', 'Избран период']);
  });
  const R = kdData({
    invoices: [{ date: '2026-01-10', total: 1180, partner: 'Купувач' }, { date: '2026-02-03', total: 590, partner: 'Купувач' }],
    kasa: [{ date: '2026-01-10', total: 300 }],
    purchases: [{ date: '2026-01-12', total: 500, partner: 'Добавувач' }],
    itemSales: [{ date: '2026-01-10', key: 'a', name: 'A', unit: 'kom', qty: 2, value: 200 }, { date: '2025-12-31', key: 'a', name: 'A', unit: 'kom', qty: 9, value: 900 }],
    ledger: [
      { date: '2026-01-31', account: '4200', debit: 400, credit: 0 }, { date: '2026-01-31', account: '4700', debit: 50, credit: 0 },
      { date: '2026-01-10', account: '1000', debit: 1000, credit: 0 }, { date: '2026-01-12', account: '2200', debit: 0, credit: 500 },
    ],
  }, '2026-01-01', '2026-12-31');
  it('totals, costs without 47/48, balances', () => {
    expect(R).toMatchObject({ sales: 2070, inv: 1770, kasa: 300, pur: 500, expT: 400, cash: 1000, pay: 500, nInv: 2, nPur: 1 });
    expect(R.items.a).toEqual({ n: 'A', q: 2, v: 200, u: 'kom' });
    expect(kdMonths(R)).toEqual([['2026-01', { s: 1480, p: 500, e: 400 }], ['2026-02', { s: 590, p: 0, e: 0 }]]);
  });
  it('chart buckets by day or month; rankings', () => {
    expect(kdBuckets(R, '2026-01-01', '2026-01-31')).toHaveLength(31);
    const M = kdBuckets(R, '2026-01-01', '2026-12-31');
    expect(M).toHaveLength(12);
    expect(M[0]).toEqual({ k: '2026-01', i: 1480, o: 500, byMonth: true });
    expect(kdRank({ x: 1, y: 5, z: 0.2 })).toEqual([{ n: 'y', v: 5 }, { n: 'x', v: 1 }]);
  });
});
