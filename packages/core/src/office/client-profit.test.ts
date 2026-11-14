import { describe, expect, it } from 'vitest';
import { clientProfit, monthsOf, periodFee, profitTotals } from './client-profit';

describe('monthsOf', () => {
  it('lists months across the year end', () => {
    expect(monthsOf('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsOf('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(monthsOf('2026-05', '2026-03')).toEqual([]);
  });
});

describe('periodFee', () => {
  it('takes the invoiced net when there is a fee invoice, else the monthly fee', () => {
    expect(periodFee(['2026-01', '2026-02', '2026-03'], new Map([['2026-02', 4000]]), 3000)).toEqual({ fee: 10000, billedMonths: 1 });
    expect(periodFee(['2026-01'], new Map(), 0)).toEqual({ fee: 0, billedMonths: 0 });
  });
});

describe('clientProfit', () => {
  const R = clientProfit([
    { id: 'a', name: 'А', fee: 6000, minutes: 300 }, // 5 h × 500 = 2500 → +3500
    { id: 'b', name: 'Б', fee: 3000, minutes: 900 }, // 15 h × 500 = 7500 → −4500
    { id: 'c', name: 'В', fee: 2000, minutes: 0 },
  ], 500, 3);
  it('computes hours, revenue per hour, profit and sorts worst first', () => {
    expect(R.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(R[0]).toMatchObject({ hours: 15, perHour: 200, cost: 7500, profit: -4500, loss: true, margin: -150, suggest: 2500 });
    expect(R[1]).toMatchObject({ perHour: null, profit: 2000, loss: false, suggest: null });
    expect(R[2]).toMatchObject({ perHour: 1200, profit: 3500 });
  });
  it('totals', () => {
    expect(profitTotals(R)).toEqual({ fee: 11000, cost: 10000, profit: 1000, hours: 20, perHour: 550, loss: 1 });
  });
});
