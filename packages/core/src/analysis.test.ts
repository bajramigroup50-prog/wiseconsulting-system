import { describe, expect, it } from 'vitest';
import {
  abc, aggBy, anDays, anRange, byMonth, byWeekday, cashForecast, cls, customerRisk, dashAgg, dashRange, ratios, salesLines,
  supplierRows, type AnInvoice,
} from './analysis';

const INV: AnInvoice[] = [
  { id: 'i1', date: '2026-03-02', credit: false, partner: 'p1', wh: 'main', fx: 1, lines: [{ item: 'a', name: 'A', qty: 2, price: 100, disc: 10 }, { item: 'a', name: 'A', qty: 2, price: 100, disc: 0 }] },
  { id: 'i2', date: '2026-03-05', credit: true, partner: 'p1', wh: 'main', fx: 1, lines: [{ item: null, name: 'Попуст', qty: 1, price: 50, disc: 0 }] },
  { id: 'i3', date: '2026-05-01', credit: false, partner: 'p2', wh: 's1', fx: 61.5, lines: [{ item: 'b', name: 'B', qty: 1, price: 10, disc: 0 }] },
];

describe('ranges', () => {
  it('dashRange / anRange like legacy', () => {
    expect(dashRange('q2', 2026, '2026-10-10')).toEqual({ from: '2026-04-01', to: '2026-06-30', lab: 'Т2 2026' });
    expect(anRange(undefined, 2026, '2026-10-10')).toEqual({ from: '2026-01-01', to: '2026-10-31', lab: 'од почеток на 2026' });
    expect(anRange('l30', 2026, '2026-10-10').from).toBe('2026-09-11');
    expect(dashRange('m', 2025, '2026-10-10')).toEqual({ from: '2025-12-01', to: '2025-12-31', lab: 'Дек 2025' });
    expect(anDays({ from: '2026-01-01', to: '2026-12-31' }, '2026-01-10')).toBe(10);
  });
});

describe('sales lines and aggregates', () => {
  const L = salesLines(INV, [{ date: '2026-03-07', item: 'a', name: 'A', qty: -1, value: -40, wh: 's1', rate: 18, retail: 118 }],
    (inv, it) => (inv === 'i1' && it === 'a' ? 160 : 0), '2026-01-01', '2026-12-31');
  it('nets invoices, credit notes, foreign currency and POS; splits move cost by quantity', () => {
    expect(L.map((l) => [l.net, l.cost])).toEqual([[180, 80], [200, 80], [-50, 0], [615, 0], [100, 40]]);
    expect(L[4]!.partner).toBe('__kasa');
  });
  it('aggBy, abc, months, weekdays', () => {
    const C = aggBy(L, (l) => l.partner, (_l, k) => k);
    expect(C[0]).toMatchObject({ k: 'p2', net: 615, mgp: 100 });
    expect(C.find((x) => x.k === 'p1')).toMatchObject({ net: 330, cost: 160, mg: 170, cnt: 3 });
    expect(abc(C).map((x) => x.cls)).toEqual(['A', 'B', 'C']);
    expect(byMonth(L)[2]).toBe(430);
    expect(byWeekday(L)[0]).toBe(380); // 2 Mar 2026 is a Monday
  });
  it('cls thresholds', () => {
    expect([cls(25, 20, 8), cls(10, 20, 8), cls(5, 20, 8), cls(null, 1, 2), cls(40, 45, 90, true), cls(95, 45, 90, true)]).toEqual(['good', 'warn', 'bad', '', 'good', 'bad']);
  });
});

describe('partners and forecast', () => {
  const T = '2026-06-01';
  it('customer risk by lateness', () => {
    const R = customerRisk([
      { id: 'x', partner: 'p1', date: '2026-01-01', due: '2026-01-15', total: 1000, paid: 0 },
      { id: 'y', partner: 'p2', date: '2026-05-01', due: '2026-05-20', total: 500, paid: 400 },
      { id: 'z', partner: 'p3', date: '2026-05-25', due: '2026-06-10', total: 300, paid: 0 },
    ], [], (p) => p.toUpperCase(), T);
    expect(R.map((r) => [r.n, r.risk, r.maxLate])).toEqual([['P1', 'bad', 137], ['P2', 'bad', 12], ['P3', 'good', 0]]);
  });
  it('suppliers due in 7 days', () => {
    const S = supplierRows([{ id: 'a', partner: 's', date: '2026-05-30', due: '2026-06-05', total: 200, paid: 50 }], (p) => p, { from: '2026-01-01', to: '2026-12-31' }, T);
    expect(S).toEqual([{ n: 's', inP: 200, open: 150, due7: 150 }]);
  });
  it('13-week forecast with VAT and payroll', () => {
    const F = cashForecast({
      today: T, start: 1000,
      invoices: [{ id: 'a', partner: 'p', date: '2026-05-01', due: '2026-06-09', total: 500, paid: 0 }, { id: 'b', partner: 'p', date: '2026-04-01', due: '2026-04-15', total: 70, paid: 0 }],
      purchases: [{ id: 'c', partner: 's', date: '2026-06-01', due: '2026-06-20', total: 300, paid: 100 }],
      vat: { amount: 120, due: '2026-07-25' }, payroll: 400,
    });
    expect(F.lateIn).toBe(70);
    expect(F.wk[1]).toMatchObject({ inn: 500, out: 400, bal: 1100 }); // 8–14 Jun: invoice + payroll on 10 Jun
    expect(F.wk[2]).toMatchObject({ out: 200 });
    expect(F.wk.at(-1)!.bal).toBe(1000 + 500 - 200 - 120 - 3 * 400);
  });
});

describe('ratios', () => {
  it('liquidity, margins, break-even', () => {
    const L = [
      { date: '2026-02-01', account: '7400', debit: 0, credit: 1000 },
      { date: '2026-02-01', account: '7000', debit: 600, credit: 0 },
      { date: '2026-02-01', account: '4200', debit: 200, credit: 0 },
    ];
    const agg = dashAgg(L, '2026-01-01', '2026-12-31');
    expect(agg).toEqual({ rev: 1000, exp: 800, res: 200, eg: { 70: 600, 42: 200 } });
    const R = ratios({ balance: { 1000: 500, 1200: 300, 6600: 200, 2200: -400 }, agg, purchases: 800, days: 100 });
    expect([R.cur, R.quick, R.cashR, R.gm, R.nm, R.be, R.dpo]).toEqual([2.5, 2, 1.25, 40, 20, 500, 50]);
  });
});
