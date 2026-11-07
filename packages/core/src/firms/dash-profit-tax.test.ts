import { describe, expect, it } from 'vitest';
import { dashProfitTax } from './dash';

const L = (rows: [string, number, number][]) => rows.map(([account, month, credit]) => ({ account, month, debit: 0, credit }));

describe('dashProfitTax', () => {
  it('turnover up to 6 million → 1% of the turnover, without the written-off invoices 7699', () => {
    const r = dashProfitTax(L([['7414', 1, 2_000_000], ['7400', 2, 3_000_000], ['7699', 3, 2_000_000]]), 0, 11, 1_500_000);
    expect(r).toEqual({ kind: 'vp', turnover: 5_000_000, base: 5_000_000, tax: 50_000 });
  });
  it('above 6 million → 10% of the profit', () => {
    const r = dashProfitTax(L([['7414', 1, 7_000_000]]), 0, 11, 1_544_211);
    expect(r.kind).toBe('db');
    expect(r.tax).toBe(154_421.1);
  });
});
