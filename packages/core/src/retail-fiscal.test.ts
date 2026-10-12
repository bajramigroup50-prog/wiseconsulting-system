import { describe, expect, it } from 'vitest';
import { fiscalConfirmed, fiscalName, fiscalTotal, toFiscalReceipt, vatGroup } from './retail/fiscal';
import { posDiscount, posDiscountLines } from './retail';

describe('fiscal receipt of a POS sale', () => {
  it('maps the Macedonian VAT rates to the device groups А/Б/В/Г', () => {
    expect([18, 5, 10, 0, 7].map(vatGroup)).toEqual(['А', 'Б', 'В', 'Г', 'Г']);
  });
  it('builds items, the discount as % of the subtotal and the card part', () => {
    const cart = [{ name: 'Леб', qty: 2, price: 35, rate: 5 }, { name: 'Сок;\tјаболко', qty: 1, price: 70.5, rate: 18 }];
    const r = toFiscalReceipt(cart, { discount: 14.05, card: 200 });
    expect(r.items).toEqual([{ name: 'Леб', qty: 2, price: 35, vat: 'Б' }, { name: 'Сок јаболко', qty: 1, price: 70.5, vat: 'А' }]);
    expect(r.discountPct).toBe(10);
    expect(fiscalTotal(r)).toBe(126.45);
    expect(r.payments).toEqual({ card: 126.45 }); // never more than the device total
    expect(toFiscalReceipt(cart).payments).toEqual({});
  });
  it('folds negative (legacy discount) lines into the discount and agrees with posDiscount', () => {
    const cart = [{ name: 'Кафе', qty: 1, price: 59, rate: 18 }, { name: 'Леб', qty: 1, price: 105, rate: 5 }];
    const D = posDiscount(164, { card: { id: 'c', no: '1', name: 'A', disc: 10, points: 0 }, coupon: null, usePts: false, rules: { per: 100, val: 1, min: 100 } });
    const lines = [...cart.map((c) => ({ ...c, itemId: 'x' })), ...posDiscountLines(cart.map((c) => ({ ...c, itemId: 'x' })), D.disc, D.parts).map((l) => ({ ...l, name: l.name ?? '' }))];
    const r = toFiscalReceipt(lines);
    expect(r.items).toHaveLength(2);
    expect(r.discountPct).toBe(10);
    expect(fiscalTotal(r)).toBe(D.pay);
  });
  it('refuses an empty receipt and a discount over 99 %', () => {
    expect(() => toFiscalReceipt([])).toThrow(/ставки/);
    expect(() => toFiscalReceipt([{ name: 'x', qty: 1, price: 10, rate: 18 }], { discount: 9.95 })).toThrow(/99/);
    expect(fiscalName('  ')).toBe('Артикл');
  });
  it('counts a device result as fiscalised only with ok + a receipt number', () => {
    expect(fiscalConfirmed({ ok: true, number: '42' })).toBe(true);
    expect(fiscalConfirmed({ ok: true, number: '' })).toBe(false);
    expect(fiscalConfirmed({ ok: true, number: '0' })).toBe(false);
    expect(fiscalConfirmed({ ok: false, number: '42', code: 'PAPER_OUT' })).toBe(false);
    expect(fiscalConfirmed({ ok: true, number: '<script>' })).toBe(false);
    expect(fiscalConfirmed(null)).toBe(false);
  });
});
