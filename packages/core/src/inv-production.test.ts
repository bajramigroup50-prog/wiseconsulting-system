import { describe, expect, it } from 'vitest';
import {
  bomMaterials, lineProdCalc, materialRows, parseQuickMaterial, perUnitBom, plansFromSavedRun, prodSummary, proposeMaterials, searchStockMaterials, splitExtra,
} from './sales';

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

describe('per-line production on the sales invoice', () => {
  it('calculates cost, unit cost and margin of a produced line', () => {
    expect(lineProdCalc({ mat: 400, extra: '100', qty: 2, sale: 10000 })).toEqual({ mat: 400, extra: 100, cost: 500, unit: 250, sale: 10000, margin: 9500, pct: 95, below: false });
    const lo = lineProdCalc({ mat: 0.1 + 0.2, extra: 0, qty: 3, sale: 0.2 });
    expect(lo.cost).toBe(0.3);
    expect(lo.unit).toBe(0.1);
    expect(lo.margin).toBe(-0.1);
    expect(lo.below).toBe(true);
    expect(lineProdCalc({ mat: 0, qty: 0, sale: 0 })).toMatchObject({ unit: 0, pct: null, below: false });
  });
  it('sums the produced lines of the invoice', () => {
    const S = prodSummary([lineProdCalc({ mat: 400, extra: 100, qty: 2, sale: 1000 }), lineProdCalc({ mat: 300, qty: 1, sale: 200 })]);
    expect(S).toEqual({ cost: 800, sale: 1200, margin: 400, pct: 33.33, below: 1, lines: 2 });
    expect(prodSummary([])).toMatchObject({ cost: 0, pct: null, lines: 0 });
  });
  it('searches stock materials, the ones on hand first, never services or the product itself', () => {
    const I = [
      { id: 'a', code: '100', name: 'Штица', type: 'material', barcodes: [] },
      { id: 'b', code: '101', name: 'Шраф', type: 'material', barcodes: ['5310001'] },
      { id: 'c', code: '102', name: 'Монтажа', type: 'service', barcodes: [] },
      { id: 'p', code: '200', name: 'Маса', type: 'product', barcodes: [] },
    ];
    const S: Record<string, { qty: number; avg: number }> = { b: { qty: 50, avg: 2 } };
    const of = (id: string) => S[id] ?? { qty: 0, avg: 0 };
    expect(searchStockMaterials(I, '', of, 'p').map((x) => [x.id, x.have, x.avg])).toEqual([['b', 50, 2], ['a', 0, 0]]);
    expect(searchStockMaterials(I, '10', of, 'p').map((x) => x.id)).toEqual(['b', 'a']);
    expect(searchStockMaterials(I, '5310', of, null).map((x) => x.id)).toEqual(['b']);
    expect(searchStockMaterials(I, 'мас', of, null).map((x) => x.id)).toEqual(['p']);
  });
  it('BOM × quantity for one line', () => {
    expect(bomMaterials({ lines: [{ itemId: 'm1', qty: '0.5' }, { itemId: '', qty: 1 }] }, 3)).toEqual([{ itemId: 'm1', qty: 1.5 }]);
    expect(bomMaterials(undefined, 3)).toEqual([]);
  });
  it('reads back per-line runs and older invoice-level runs as marked lines', () => {
    const lines = [{ itemId: 'svc' }, { itemId: 'p1' }, { itemId: 'g1' }, { itemId: 'p2' }];
    // per-line run
    const a = plansFromSavedRun({ lines: [{ lineNo: 1, productId: 'p1', qty: 2, materials: [{ itemId: 'm1', qty: 4 }], wh: 'w1', extra: 50, saveBom: true }] }, lines);
    expect(a).toEqual([null, { wh: 'w1', extra: 50, saveBom: true, materials: [{ itemId: 'm1', qty: 4 }] }, null, null]);
    // older run: one warehouse / extra for the invoice; the extra comes back from the orders (their labour share)
    const old = { wh: 'w2', extra: 100, saveBom: false, lines: [{ lineNo: 1, productId: 'p1', qty: 2, materials: [{ itemId: 'm1', qty: 3 }] }, { lineNo: 3, productId: 'p2', qty: 1, materials: [{ itemId: 'm1', qty: 1 }] }],
      orders: [{ productId: 'p1', lineNo: 1, lab: 75 }, { productId: 'p2', lineNo: 3, lab: 25 }] };
    expect(plansFromSavedRun(old, lines).map((x) => x && [x.wh, x.extra])).toEqual([null, ['w2', 75], null, ['w2', 25]]);
    // a draft (no orders yet): the extra is split by the materials quantities
    expect(plansFromSavedRun({ ...old, orders: [] }, lines).map((x) => x?.extra ?? null)).toEqual([null, 75, null, 25]);
    // the saved line index moved (an empty row was dropped): matched by the product
    expect(plansFromSavedRun({ lines: [{ lineNo: 2, productId: 'p2', qty: 1, materials: [] }] }, lines).map((x) => !!x)).toEqual([false, false, false, true]);
    // the old flag without materials: product lines are marked too
    expect(plansFromSavedRun(null, lines, { legacyFlag: true, isProduct: (id) => id.startsWith('p') }).map((x) => !!x)).toEqual([false, true, false, true]);
  });
});
