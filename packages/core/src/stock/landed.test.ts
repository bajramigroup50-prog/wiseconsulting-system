import { describe, expect, it } from 'vitest';
import { allocAuto } from './landed';

describe('allocAuto – firm that is not a VAT payer', () => {
  it('the VAT of every cost is landed cost (no customs VAT column)', () => {
    const p = { imp: true, fx: 61.5, noVat: true, stock: [{ item: 'a', qty: 1, price: 100 }, { item: 'b', qty: 1, price: 300 }],
      costs: { car: { amt: 400, lines: [{ base: 25000, rate: 18, vat: 4500 }] }, sped: { amt: 2850, lines: [{ base: 2850, rate: 18, vat: 513 }] } } };
    const A = allocAuto(p);
    expect(A.tot).toBe(400 + 4500 + 2850 + 513);
    expect(A.by.reduce((a, b) => a + b, 0)).toBeCloseTo(8263, 2);
    expect(A.cvat).toEqual([0, 0]);
  });
});
