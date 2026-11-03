import { describe, expect, it } from 'vitest';
import { batchStatus, purchaseDraftFromScan, scanForeignCurrency } from './scan';

describe('foreign-currency purchase scan → import draft', () => {
  const o = { partners: [], items: [], accounts: { goods: '6600', material: '3100', other: '4490' }, today: '2026-05-01' } as unknown as Parameters<typeof purchaseDraftFromScan>[1];
  it('USD invoice: imp, every line, prices in USD, no denar selling price, never „ok“', () => {
    const d = purchaseDraftFromScan({ supplierName: 'SZ MZD TECHNOLOGY CO., LTD', number: '871208242687', date: '2026-04-29', currency: 'USD', total: 89,
      lines: [{ name: 'tubular', qty: 1, price: 89, amount: 89, rate: 0 }], groups: [{ rate: 0, base: 89, vat: 0, kind: 'other' }] }, o);
    expect(d).toMatchObject({ imp: true, currency: 'USD', fxAmt: 89, ptype: 'stock' });
    expect(d.stock).toHaveLength(1);
    expect(d.stock[0]).toMatchObject({ price: 89, sp: '' });
    expect(d.groups[0]!.base).toBe(0);
    expect(batchStatus(d, null, null, null).status).toBe('check');
  });
  it('denars stay a normal purchase', () => {
    expect(scanForeignCurrency({ currency: 'MKD' })).toBe('');
    expect(scanForeignCurrency({ currency: 'ден.' })).toBe('');
    expect(scanForeignCurrency({ currency: 'eur' })).toBe('EUR');
  });
});
