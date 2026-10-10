import { describe, expect, it } from 'vitest';
import { bomHint, lagerExportRows, parseQuickLines, pnbPlan, rnItems, transferFromCalc, transferMarginPrice } from './parity-stock';
import type { StockContext, StockItem, StockMove } from './stock';

const M1: StockItem = { id: 'm1', name: 'Брашно', unit: 'кг', type: 'material', price: 0, rate: 5 };
const M2: StockItem = { id: 'm2', name: 'Квасец', unit: 'кг', type: 'material', price: 0, rate: 5 };
const G: StockItem = { id: 'g', name: 'Сол', unit: 'кг', type: 'goods', price: 30, rate: 5, sp: { s1: 40 } };
const P: StockItem = { id: 'p', name: 'Леб', unit: 'ком', type: 'product', price: 50, rate: 5, bom: [{ item: 'm1', qty: 0.5 }, { item: 'm2', qty: 0.01 }] };
const mv = (id: string, item: string, qty: number, value: number, date = '2026-01-10', wh = 'main'): StockMove => ({ id, item, qty, value, date, wh, type: qty > 0 ? 'in' : 'sale', src: 'x-' + id });
const ctx: StockContext = {
  items: [M1, M2, G, P],
  locations: [{ id: 's1', kind: 'store' }],
  moves: [mv('a', 'm1', 100, 3000), mv('b', 'm2', 2, 400), mv('c', 'g', 10, 200), mv('d', 'g', -4, -80, '2026-02-01')],
};

describe('pnbPlan (legacy 13922)', () => {
  it('spreads qty × price × pct over the materials by stock value', () => {
    // total = 20 × 50 × 60% = 600; stock values: m1 3000, m2 400, g 120 → sv 3520
    const p = pnbPlan(ctx, P, 20, 'main', 60, rnItems(ctx.items!));
    expect(p.total).toBe(600);
    const m1 = p.lines.find((l) => l.itemId === 'm1')!;
    expect(m1.value).toBe(511.36); // r2(600 × 3000 / 3520)
    expect(m1.qty).toBe(17.0453); // r4(511.36 / 30)
    expect(p.lines.find((l) => l.itemId === 'm2')!.value).toBe(68.18);
    expect(p.lines.find((l) => l.itemId === 'g')!.value).toBe(20.45);
    expect(p.short).toBe(0.01);
  });
  it('never issues more than the stock value', () => {
    const p = pnbPlan(ctx, P, 1000, 'main', 100, rnItems(ctx.items!));
    expect(p.lines.find((l) => l.itemId === 'm1')!.value).toBe(3000);
    expect(p.short).toBe(r(50000 - 3000 - 400 - 120));
  });
});
const r = (x: number) => Math.round(x * 100) / 100;

describe('bomHint (legacy v439)', () => {
  it('enough-for per material and the maximum quantity', () => {
    const h = bomHint(ctx, P, 'main');
    expect(h.rows).toEqual([{ itemId: 'm1', perUnit: 0.5, have: 100, enough: 200 }, { itemId: 'm2', perUnit: 0.01, have: 2, enough: 200 }]);
    expect(h.max).toBe(200);
  });
});

describe('transferMarginPrice (legacy prMargin)', () => {
  it('avg × (1+m) × (1+vat), rounded to the step', () => {
    expect(transferMarginPrice(100, 18, 25, 1)).toBe(148); // 147.5 → 148
    expect(transferMarginPrice(100, 18, 25, 10)).toBe(150);
    expect(transferMarginPrice(3, 18, 20, 1)).toBe(4.25); // below 5 steps → 0.01
    expect(transferMarginPrice(0, 18, 20, 1)).toBe(0);
  });
});

describe('parseQuickLines (legacy pcQuickAdd)', () => {
  it('splits code and the last number', () => {
    expect(parseQuickLines('M01 65\nM02\t2,5\nБрашно тип 400  12\n\n')).toEqual([
      { code: 'M01', qty: '65' }, { code: 'M02', qty: '2,5' }, { code: 'Брашно тип 400', qty: '12' },
    ]);
  });
});

describe('transferFromCalc (legacy prAddCalc)', () => {
  it('limits to the stock at the source and prefers the store price', () => {
    const L = transferFromCalc(ctx, [{ item: 'g', qty: 10, sp: 45 }, { item: 'm1', qty: 5, sp: '' }, { item: null, qty: 1 }], 'main', 's1', '2026-03-01');
    expect(L).toEqual([{ itemId: 'g', qty: 6, sp: 40 }, { itemId: 'm1', qty: 5, sp: null }]);
  });
});

describe('lagerExportRows (legacy lagAoa)', () => {
  it('header with Баркод and Вид, blank columns empty', () => {
    const A = lagerExportRows([{ label: 'Количина', kind: 'q' }, { label: 'Пописна количина', kind: 'b' }], [{ code: '1', barcode: '389', name: 'Сол', unit: 'кг', type: 'goods', values: [6, ''] }]);
    expect(A).toEqual([['Р.б.', 'Шифра', 'Баркод', 'Назив', 'Ед.', 'Вид', 'Количина', 'Пописна количина'], [1, '1', '389', 'Сол', 'кг', 'Стока (трговија)', 6, '']]);
  });
});
