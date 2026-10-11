import { describe, expect, it } from 'vitest';
import { cartScan, cartTotal, fiscalInpFile, itemByCode, posDiscount, posDiscountLines, zBaseVat } from './retail';

describe('POS till (legacy VIEWS.kasa / posSell wrapper / posFile)', () => {
  it('finds items by barcode first, then by code', () => {
    const I = [{ id: 'a', code: '100', barcodes: ['5310000000017'] }, { id: 'b', code: 'X1', barcodes: [] }, { id: 'c', code: 'old', active: false }];
    expect(itemByCode(I, '5310000000017')?.id).toBe('a');
    expect(itemByCode(I, 'x1')?.id).toBe('b');
    expect(itemByCode(I, 'old')).toBeNull();
    expect(itemByCode(I, ' ')).toBeNull();
  });
  it('a scanned item adds to its line', () => {
    const c = cartScan([{ itemId: 'a', qty: 1 }], { itemId: 'a', qty: 2 });
    expect(c).toEqual([{ itemId: 'a', qty: 3 }]);
    expect(cartScan(c, { itemId: 'b', qty: 1 })).toHaveLength(2);
  });
  it('splits the discount over VAT rates in ascending order, rest on the last (golden: legacy 9940)', () => {
    const cart = [{ qty: 2, price: 59, rate: 18 }, { qty: 1, price: 105, rate: 5 }];
    expect(cartTotal(cart)).toBe(223);
    const L = posDiscountLines(cart, 22.3, ['попуст 10% 22.30']);
    // legacy: by = {5: 105, 18: 118}; 5 → r2(22.3*105/223) = 10.5; 18 → 22.3 − 10.5 = 11.8
    expect(L).toEqual([
      { itemId: '', name: 'Попуст (попуст 10% 22.30)', qty: 1, price: -10.5, rate: 5 },
      { itemId: '', name: 'Попуст (попуст 10% 22.30)', qty: 1, price: -11.8, rate: 18 },
    ]);
    expect(cartTotal([...cart, ...L])).toBe(200.7);
    expect(posDiscountLines(cart, 0, [])).toEqual([]);
  });
  it('card discount + coupon + points → pay', () => {
    const x = posDiscount(223, { card: { id: 'c', no: '1', name: 'A', disc: 10, points: 150 }, coupon: { c: { id: 'k', code: 'K', kind: 'amt', val: 20 }, disc: 20 }, usePts: true, rules: { per: 100, val: 1, min: 100 } });
    expect(x.disc).toBe(192.3);
    expect(x.pay).toBe(30.7);
    expect(x.redPts).toBe(150);
  });
  it('writes the fiscal printer file (legacy posFile)', () => {
    expect(fiscalInpFile([{ name: 'Леб', qty: 2, price: 35, rate: 5 }, { name: 'Сок', qty: 1, price: 70.5, rate: 18 }])).toBe(
      'S,1,______,_,__;Леб;35.00;2.000;2;1;0;0;0\r\nS,1,______,_,__;Сок;70.50;1.000;1;1;0;0;0\r\nT,1,______,_,__;0;;;;;');
  });
  it('Z list base and VAT', () => {
    expect(zBaseVat([{ base: 100, vat: 18 }, { base: 100, vat: 5 }])).toEqual({ base: 200, vat: 23 });
  });
});
