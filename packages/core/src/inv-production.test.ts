import { describe, expect, it } from 'vitest';
import { materialRows, parseQuickMaterial, perUnitBom, proposeMaterials, splitExtra } from './sales';

describe('production from a sales invoice', () => {
  it('proposes BOM × line quantity for products and marked items', () => {
    const P = proposeMaterials([
      { itemId: 'p1', qty: 3, type: 'product' },
      { itemId: 'g1', qty: 2, type: 'goods' },
      { itemId: 'g2', qty: 1, type: 'goods', produced: true },
      { itemId: 'p2', qty: 0, type: 'product' },
    ], { p1: { lines: [{ itemId: 'm1', qty: 0.5 }, { itemId: 'm2', qty: '2' }] } });
    expect(P).toEqual([
      { lineNo: 0, productId: 'p1', qty: 3, materials: [{ itemId: 'm1', qty: 1.5 }, { itemId: 'm2', qty: 6 }], fromBom: true },
      { lineNo: 2, productId: 'g2', qty: 1, materials: [], fromBom: false },
    ]);
  });
  it('shows stock, average cost and shortage (rows of one item add up)', () => {
    const S: Record<string, { qty: number; avg: number }> = { m1: { qty: 2, avg: 10 }, m2: { qty: 100, avg: 1.234 } };
    const R = materialRows([{ itemId: 'm1', qty: 1.5 }, { itemId: 'm2', qty: 6 }, { itemId: 'm1', qty: 1 }], (id) => S[id] ?? { qty: 0, avg: 0 });
    expect(R.rows.map((r) => [r.value, r.short])).toEqual([[15, true], [7.4, false], [10, true]]);
    expect(R.value).toBe(32.4);
  });
  it('builds the per-unit BOM and splits the extra costs', () => {
    expect(perUnitBom([{ itemId: 'm1', qty: 1.5 }, { itemId: 'm1', qty: 1.5 }, { itemId: 'm2', qty: 6 }], 3)).toEqual([{ item: 'm1', qty: 1 }, { item: 'm2', qty: 2 }]);
    expect(splitExtra(100, [30, 70])).toEqual([30, 70]);
    expect(splitExtra(10, [1, 1, 1])).toEqual([3.33, 3.33, 3.34]);
    expect(splitExtra(0, [5])).toEqual([0]);
  });
  it('parses the quick „шифра количина“ entry', () => {
    const f = (c: string) => (c === '1001' ? { id: 'm1' } : null);
    expect(parseQuickMaterial('1001 2,5', f)).toEqual({ itemId: 'm1', qty: 2.5 });
    expect(parseQuickMaterial('1001', f)).toEqual({ itemId: 'm1', qty: 1 });
    expect(parseQuickMaterial('9 1', f)).toBeNull();
  });
});
