import { describe, expect, it } from 'vitest';
import { allocAuto, allocCosts, calculationRows, costsOf, finalizeStockLines, roundPurchase, stockLineValue, type PurchaseLike } from '../../../src/stock';
import { loadLegacy } from './legacy';
import { CODES, ITEMS, portCtx } from './fixtures';

/** Import purchase with four stock lines, two customs tariffs and every kind of landed cost. */
const IMPORT: PurchaseLike = {
  imp: true,
  fx: 61.53,
  wh: 'main',
  stock: [
    { item: 'A', qty: 120, price: 1.85, rab: 5, cn: 0, sp: 129 },
    { item: 'B', qty: 250.5, price: 0.92, rab: 0, cn: 1 },
    { item: 'C', qty: 36, price: 3.1, rab: 2.5, cn: 0, sp: '' },
    { item: 'M', qty: 10, price: 12.4, rab: 0, cn: '' },
  ],
  cnames: [1830.4, 912.75],
  costs: {
    car: { amt: 2743.15, lines: [{ base: 23507, rate: 18, vat: 4231.26 }] },
    sped: { amt: 3500, lines: [{ base: 3500, rate: 18, vat: 630 }] },
    trans: { amt: 4200.5, byQty: true },
    dev: { amt: 85, fx: 61.53 },
    t1: { amt: 0, lines: [{ base: 666.67, rate: 18, vat: 120 }] },
    dr: { amt: 333.33 },
  },
  groups: [{ konto: '6600', rate: 0, base: 23507.4, vat: 0 }],
};

/** Domestic purchase, value-only allocation. */
const DOMESTIC: PurchaseLike = {
  wh: 's1',
  stock: [
    { item: 'A', qty: 7, price: 63.333, rab: 3 },
    { item: 'C', qty: 11, price: 41.17, rab: 0, sp: 74 },
    { item: 'B', qty: 3.75, price: 37.9, rab: 10 },
  ],
  costs: { trans: { amt: 455, lines: [{ base: 455, rate: 18, vat: 81.9 }] }, t2: { amt: 120.49 } },
  groups: [
    { konto: '6600', rate: 18, base: 1065.44, vat: 191.78 },
    { konto: '6600', rate: 5, base: 127.93, vat: 6.4 },
  ],
};

const purchases: [string, PurchaseLike][] = [
  ['import, by value', { ...IMPORT, distMode: 'val' }],
  ['import, customs by tariff', { ...IMPORT, distMode: 'cn' }],
  ['import, customs and VAT by tariff', { ...IMPORT, distMode: 'multi' }],
  ['import, transport by value', { ...IMPORT, costs: { ...IMPORT.costs, trans: { amt: 4200.5 } } }],
  ['import, tariff with no lines falls back to value', { ...IMPORT, distMode: 'cn', cnames: [1830.4, 912.75, 400] }],
  ['domestic', DOMESTIC],
  ['manual shares', { ...DOMESTIC, stock: DOMESTIC.stock!.map((s, i) => ({ ...s, dep: [100, 200.5, ''][i], cvat: [10, '', 5][i] })) }],
  ['art. 32-a', { ...DOMESTIC, art32: true }],
];

describe('landed costs over a multi-line purchase', () => {
  for (const [name, p] of purchases) {
    it(`matches legacy: ${name}`, () => {
      const L = loadLegacy({ items: ITEMS, codes: CODES });
      expect(costsOf(p).map(({ k, amt, vat }) => ({ k, amt, vat }))).toEqual(L.fn.costsOf(structuredClone(p)).map(({ k, amt, vat }: any) => ({ k, amt, vat })));
      expect(p.stock!.map((s) => stockLineValue(p, s))).toEqual(p.stock!.map((s) => L.fn.stVal(structuredClone(p), structuredClone(s))));
      for (const mode of ['val', 'cn', 'multi'] as const) expect(allocAuto(p, mode)).toEqual(L.fn.allocAuto(structuredClone(p), mode));
      expect(allocCosts(p)).toEqual(L.fn.allocCosts(structuredClone(p)));
      const rp = roundPurchase(p);
      expect(rp).toEqual(L.fn.purRound(structuredClone(p)));
      expect(finalizeStockLines(rp)).toEqual(L.fn.__purStock(L.fn.purRound(structuredClone(p))));
      expect(calculationRows(portCtx({ items: ITEMS }), rp)).toEqual(
        L.fn.calcRows(L.fn.purRound(structuredClone(p))).map((r: any, i: number) => ({ item: rp.stock!.filter((s) => +s.qty!)[i]!.item, ...r })),
      );
    });
  }

  it('whole-denar stock values add up to the rounded purchase value + landed cost', () => {
    const rp = roundPurchase({ ...IMPORT, distMode: 'multi' });
    const lines = finalizeStockLines(rp);
    const goods = rp.stock!.reduce((a, s) => a + stockLineValue(rp, s), 0);
    const landed = allocCosts(rp).by.reduce((a, b) => a + b, 0);
    expect(lines.reduce((a, l) => a + l.value, 0)).toBe(Math.round(goods + landed));
    for (const l of lines) expect(Number.isInteger(l.value)).toBe(true);
  });
});
