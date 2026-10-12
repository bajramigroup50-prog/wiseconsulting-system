import { describe, expect, it } from 'vitest';
import {
  bomMaterials, dimArea, dimVolume, labourAmount, lineProdCalc, materialRows, parseQuickMaterial, perUnitBom, plansFromSavedRun, prodCostCalc, prodSummary, proposeMaterials, qtyFromSpec,
  searchStockMaterials, specText, specUnit, splitExtra, workOrderLabel, workOrderNumber,
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

describe('production invoice („🏭 Фактура од производство“)', () => {
  it('dimensions give the quantity: m² = Д × Ш, m³ = Д × Ш × В, m = Д, × pieces', () => {
    expect(dimArea(4, 3.25)).toBe(13);
    expect(dimVolume('2', '0.5', '0.3')).toBe(0.3);
    expect(qtyFromSpec({ mode: 'm2', l: 4, w: 3 })).toBe(12);
    expect(qtyFromSpec({ mode: 'm2', l: '4', w: '3', pcs: '2' })).toBe(24);
    expect(qtyFromSpec({ mode: 'm3', l: 2, w: 0.5, h: 0.3, pcs: 3 })).toBe(0.9);
    expect(qtyFromSpec({ mode: 'm', l: 7.35 })).toBe(7.35);
    expect(qtyFromSpec({ mode: '', l: 4, w: 3 })).toBeNull();
    expect(qtyFromSpec({ mode: 'm3', l: 4, w: 3 })).toBeNull(); // height missing
    expect(specUnit('m2')).toBe('m²');
    expect(specText({ text: 'Алуминиум, антрацит', mode: 'm2', l: 4, w: 3 })).toBe('Алуминиум, антрацит, 4 × 3 m = 12 m²');
    expect(specText({ mode: 'm3', l: 2, w: 0.5, h: 0.3, pcs: 3 })).toBe('3 × 2 × 0,5 × 0,3 m = 0,9 m³');
    expect(specText(null)).toBe('');
  });
  it('labour: hours × rate, or the typed amount', () => {
    expect(labourAmount({ hours: 12, rate: 450.5 })).toBe(5406);
    expect(labourAmount({ hours: 12, rate: 450, labour: '5000' })).toBe(5000);
    expect(labourAmount({ hours: '', rate: '', labour: '' })).toBe(0);
    expect(labourAmount(null)).toBe(0);
  });
  it('full cost: materials + labour + other direct + overhead % of the direct costs; margin and below-cost', () => {
    const c = prodCostCalc({ mat: 18_000, hours: 16, rate: 500, other: [{ label: 'Транспорт', amount: 1500 }, { label: 'Монтажа', amount: '2500' }, { label: 'Енергија', amount: '' }], ovhPct: 10, qty: 12, sale: 48_000 });
    expect(c).toMatchObject({ mat: 18_000, lab: 8000, other: 4000, direct: 30_000, ovhPct: 10, ovh: 3000, extra: 15_000, cost: 33_000, unit: 2750, sale: 48_000, margin: 15_000, pct: 31.25, below: false });
    const b = prodCostCalc({ mat: 1000.1, labour: 333.33, ovhPct: 7.5, qty: 3, sale: 1200 });
    expect(b.ovh).toBe(100.01); // 7.5% × 1333.43 = 100.007
    expect(b.cost).toBe(1433.44);
    expect(b.below).toBe(true);
    expect(b.margin).toBe(-233.44);
  });
  it('work order: its own number for the first order, then „број-2“…; label with the period', () => {
    expect(workOrderNumber('007/2026', ['001/2026'])).toBe('007/2026');
    expect(workOrderNumber('007/2026', ['007/2026', '007/2026-2'])).toBe('007/2026-3');
    expect(workOrderLabel({ number: '007/2026', from: '2026-03-01', to: '2026-03-31' })).toBe('Работен налог 007/2026 (01.03.2026 – 31.03.2026)');
    expect(workOrderLabel({ number: ' ' })).toBe('');
  });
  it('a saved main product comes back with its specification and cost elements', () => {
    const run = { lines: [{ lineNo: 0, productId: 'p1', qty: 12, materials: [{ itemId: 'm1', qty: 5 }], extra: 15_000, main: true, spec: { text: 'x', mode: 'm2' as const, l: 4, w: 3 }, calc: { hours: 16, rate: 500, ovhPct: 10 } }] };
    const [P] = plansFromSavedRun(run, [{ itemId: 'p1' }]);
    expect(P).toMatchObject({ main: true, extra: 15_000, spec: { mode: 'm2', l: 4 }, calc: { hours: 16 } });
  });
});
