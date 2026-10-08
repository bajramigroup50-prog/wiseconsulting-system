import { describe, expect, it } from 'vitest';
import {
  levellingEntries,
  postIn,
  postOut,
  productionLines,
  retailAccount,
  retailBreakdown,
  retailPostingSplit,
  revalueLines,
  stockAccount,
  stockAt,
  stockLinesBalanced,
  stockScheme,
  transferLines,
  type StockContext,
  type StockItem,
  type StockMove,
} from './stock';
import { rnd } from './stock/num';

const A: StockItem = { id: 'A', name: 'A', unit: 'ком', type: 'goods', price: 100, rate: 18, cost: 50 };
const S: StockItem = { id: 'S', name: 'S', unit: 'кг', type: 'goods', price: 10, rate: 5 };
const LOC = [
  { id: 's1', kind: 'store' as const },
  { id: 'w2', kind: 'warehouse' as const, konto: '6601' },
];

describe('numeric helpers', () => {
  it('rounds half-up like Math.round, without float-noise surprises', () => {
    expect(rnd(1.005, 2)).toBe(1.01);
    expect(rnd(2.675, 2)).toBe(2.68);
    expect(rnd(-2.5, 0)).toBe(-2); // Math.round direction (towards +Infinity), as legacy
    expect(rnd(-0.001, 2)).toBe(0);
    expect(Object.is(rnd(-0.001, 2), -0)).toBe(false);
    expect(rnd(1234567.125, 2)).toBe(1234567.13);
  });

  it('sums thousands of fractional moves without drift', () => {
    const moves: StockMove[] = [];
    for (let i = 0; i < 3000; i++) moves.push({ id: 'm' + i, date: '2026-01-01', item: 'S', qty: 0.1, value: 0.07, type: 'in' });
    for (let i = 0; i < 1000; i++) moves.push({ id: 'o' + i, date: '2026-01-02', item: 'S', qty: -0.1, value: -0.07, type: 'sale' });
    const s = stockAt({ moves, items: [S] }, { item: 'S', date: '2026-12-31' });
    expect(s).toEqual({ qty: 200, value: 140, avg: 0.7, inQ: 300, outQ: 100, inV: 210, outV: 70 });
  });
});

describe('scheme and accounts', () => {
  it('defaults: legacy SCH0 stock keys, whStock typo fixed', () => {
    const s = stockScheme({});
    expect(s.whStock).toBe('6600');
    expect(s.retailMarg).toBe('6694');
    expect(stockScheme({ scheme: { stock: '', cogs: '7011' } })).toMatchObject({ stock: '6600', cogs: '7011' });
  });

  it('location overrides: stock account for goods only; retail accounts by kind', () => {
    const ctx: StockContext = { moves: [], locations: LOC, scheme: { whSaleMethod: true } };
    expect(stockAccount(ctx, 'w2', A)).toBe('6601');
    expect(stockAccount(ctx, 'w2', { type: 'material' })).toBe('3100');
    expect(stockAccount(ctx, 'main', { type: 'product' })).toBe('6300');
    expect(retailAccount(ctx, 's1', 'Marg')).toBe('6694');
    expect(retailAccount(ctx, 'main', 'Marg')).toBe('6690');
    expect(retailAccount(ctx, 'w2', 'Stock')).toBe('6601');
  });
});

describe('stock journal lines balance', () => {
  const moves: StockMove[] = [
    { id: 'i1', date: '2026-01-01', item: 'A', qty: 7, value: 433.33, type: 'in', wh: 's1' },
    { id: 'i2', date: '2026-01-01', item: 'S', qty: 3.333, value: 21.11, type: 'in', wh: 's1' },
  ];
  for (const retailMethod of [false, true])
    for (const vatRegistered of [true, false])
      it(`issues, receipts, transfers and levelling (retailMethod=${retailMethod}, VAT=${vatRegistered})`, () => {
        const ctx: StockContext = { moves, items: [A, S], locations: LOC, scheme: { retailMethod }, vatRegistered };
        for (const it of [A, S])
          for (const qty of [1, 2.5, 0.333]) {
            const o = postOut(ctx, { item: it, qty, date: '2026-01-05', type: 'sale', src: 'x', label: 'x', debitAccount: '7010', wh: 's1' });
            expect(stockLinesBalanced(o.move.lines!)).toBe(true);
            expect(o.move.lines!.every((l) => l.debit >= 0 && l.credit >= 0)).toBe(true);
            const r = postIn(ctx, { item: it, qty, date: '2026-01-05', src: 'p', label: 'вишок', creditAccount: '7690', wh: 's1' });
            expect(stockLinesBalanced(r.move.lines!)).toBe(true);
            const t = transferLines(ctx, { item: it, qty, retailUnitPrice: 123.45, cost: o.value, from: 'w2', to: 's1' });
            expect(stockLinesBalanced(t)).toBe(true);
          }
        const lv = levellingEntries(ctx, { date: '2026-01-06', wh: 's1', lines: [{ item: 'A', qty: 7, old: 118, new: 109.99 }, { item: 'S', qty: 3.333, old: 10.5, new: 11.37 }] });
        expect(stockLinesBalanced(lv)).toBe(true);
        expect(lv.length > 0).toBe(retailMethod);
      });

  it('non-VAT firm: retail issue split has no VAT line', () => {
    const ctx: StockContext = { moves, items: [A], locations: LOC, scheme: { retailMethod: true }, vatRegistered: false };
    const o = postOut(ctx, { item: A, qty: 2, date: '2026-01-05', type: 'sale', src: 'x', label: 'x', debitAccount: '7010', wh: 's1' });
    expect(o.move.lines!.map((l) => l.account)).toEqual(['7010', '6694', '6630']);
  });

  it('revalueLines keeps a 4-line retail entry balanced and adds a margin line when missing', () => {
    const L = [
      { account: '7010', debit: 100, credit: 0 },
      { account: '6640', debit: 18, credit: 0 },
      { account: '6630', debit: 0, credit: 118 },
    ];
    const r = revalueLines(L, 100, 90, '6694');
    expect(r).toEqual([...L.slice(0, 1).map((l) => ({ ...l, debit: 90 })), L[1], L[2], { account: '6694', debit: 10, credit: 0 }]);
    expect(stockLinesBalanced(r)).toBe(true);
  });

  it('production lines: labour first, then product receipt', () => {
    const l = productionLines(stockScheme({}), 260, 60);
    expect(l.map((x) => [x.account, x.debit, x.credit])).toEqual([
      ['6000', 60, 0],
      ['4900', 0, 60],
      ['6300', 260, 0],
      ['6000', 0, 260],
    ]);
    expect(stockLinesBalanced(l)).toBe(true);
  });
});

describe('retail breakdown (ЕТ / ЕТМ / МЕТГ / calculations)', () => {
  it('net-first split (calculations)', () => {
    expect(retailBreakdown(944, 18, 600)).toEqual({ gross: 944, net: 800, vat: 144, margin: 200 });
    expect(retailBreakdown(100, 5, 80.1)).toEqual({ gross: 100, net: 95.24, vat: 4.76, margin: 15.14 });
  });
  it('VAT-first split (postings), whole denars for issues', () => {
    expect(retailPostingSplit(1179, 18, 700, 0)).toEqual({ gross: 1179, net: 999, vat: 180, margin: 299 });
    expect(retailPostingSplit(100, 0, 60)).toEqual({ gross: 100, net: 100, vat: 0, margin: 40 });
  });
});

describe('postOut fallbacks', () => {
  it('warns and uses the last purchase price when there is no stock', () => {
    const moves: StockMove[] = [
      { id: 'a', date: '2026-01-01', item: 'A', qty: 2, value: 120, type: 'in' },
      { id: 'b', date: '2026-01-03', item: 'A', qty: 1, value: 70, type: 'in' },
      { id: 'c', date: '2026-01-04', item: 'A', qty: -3, value: -190, type: 'sale' },
    ];
    const r = postOut({ moves, items: [{ ...A, cost: 0 }] }, { item: { ...A, cost: 0 }, qty: 2, date: '2026-01-05', type: 'sale', src: 's', label: 'l', debitAccount: '7010' });
    expect(r.value).toBe(140);
    expect(r.warning).toEqual({ code: 'lastPrice', price: 70 });
    const n = postOut({ moves: [] }, { item: { id: 'Z', type: 'goods' }, qty: 2, date: '2026-01-05', type: 'sale', src: 's', label: 'l', debitAccount: '7010' });
    expect(n).toMatchObject({ value: 0, warning: { code: 'noCost' } });
    expect(n.move.lines).toEqual([]);
  });
});
