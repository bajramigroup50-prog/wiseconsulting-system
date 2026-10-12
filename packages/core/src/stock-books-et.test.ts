/**
 * ЕТ образец за мало (etBook): a receipt document (ПЛТ / преносница) is booked per store with only that store's part.
 * Production bug: a foreign-currency ПЛТ whose lines went to several stores showed the WHOLE document total in every
 * store (and N × the total for „сите продавници“).
 */
import { describe, expect, it } from 'vitest';
import { etBook, receiptShares, type MoveDocResolver } from './stock-books';
import type { StockContext, StockMove } from './stock';

const LOC = [
  { id: 'T', kind: 'store' as const, name: 'TETOVO' },
  { id: 'S', kind: 'store' as const, name: 'STRUGA' },
  { id: 'G', kind: 'store' as const, name: 'GOSTIVAR' },
];
const ITEMS = [
  { id: 'A', type: 'goods' as const, rate: 18, price: 100, sp: { T: 200, S: 200, G: 200 } },
  { id: 'B', type: 'goods' as const, rate: 18, price: 50, sp: { T: 90, S: 90, G: 90 } },
];
const mv = (id: string, src: string, wh: string, item: string, qty: number, value: number, date = '2026-03-01'): StockMove =>
  ({ id, src, wh, item, qty, value, date, type: qty > 0 ? 'in' : 'sale', label: '', lines: [] }) as unknown as StockMove;

/** ПЛТ 0001: A 10 × 100 → TETOVO, B 20 × 30 → STRUGA (nab 1000 + 600 = 1600; sp 2000 + 1800 = 3800). */
const PLT = { nab: 1600, sp: 3800 };
const docOf: MoveDocResolver = (m) =>
  String(m.src).startsWith('pur-')
    ? { key: String(m.src), no: 'Од ПЛТ бр. 0001', name: 'FULLAMODA TURKEY', ddate: '2026-03-01', inTotals: PLT }
    : { key: String(m.src), no: String(m.src), name: '', ddate: m.date };

const ctxOf = (moves: StockMove[]): StockContext => ({ moves, items: ITEMS, locations: LOC });
const book = (ctx: StockContext, wh = '') => etBook(ctx, { wh, from: '2026-01-01', to: '2026-12-31', docOf, locationName: (id) => LOC.find((l) => l.id === id)?.name ?? id });

describe('etBook: receipt documents split per store', () => {
  const split = ctxOf([mv('1', 'pur-1', 'T', 'A', 10, 1000), mv('2', 'pur-1', 'S', 'B', 20, 600)]);

  it('a ПЛТ with lines in 2 stores: each store shows only its own part', () => {
    const t = book(split, 'T');
    expect(t.rows.map((r) => [r.no, r.nab, r.sp, r.wh])).toEqual([['Од ПЛТ бр. 0001', 1000, 2000, 'T']]);
    const s = book(split, 'S');
    expect(s.rows.map((r) => [r.no, r.nab, r.sp, r.wh])).toEqual([['Од ПЛТ бр. 0001', 600, 1800, 'S']]);
    expect(book(split, 'G').rows).toEqual([]);
  });

  it('„сите продавници“: one row per store, totals equal the whole document', () => {
    const all = book(split);
    expect(all.rows.map((r) => r.wh).sort()).toEqual(['S', 'T']);
    expect(all.totals.nab).toBe(PLT.nab);
    expect(all.totals.sp).toBe(PLT.sp);
    expect(all.totals.nab).toBe(book(split, 'T').totals.nab + book(split, 'S').totals.nab);
  });

  it('parts are allocated in cents and always add up to the whole document', () => {
    const odd = ctxOf([mv('1', 'pur-1', 'T', 'A', 1, 1), mv('2', 'pur-1', 'S', 'A', 1, 1), mv('3', 'pur-1', 'G', 'A', 1, 1)]);
    const P = receiptShares(odd, (m) => ({ ...docOf(m), inTotals: { nab: 100, sp: 100 } })).get('pur-1')!;
    const parts = [...P.values()];
    expect(parts.reduce((s, p) => s + Math.round(p.nab * 100), 0)).toBe(10000);
    expect(parts.reduce((s, p) => s + Math.round(p.sp * 100), 0)).toBe(10000);
  });

  it('a ПЛТ into one store appears only there, with its whole value', () => {
    const one = ctxOf([mv('1', 'pur-1', 'T', 'A', 10, 1000), mv('2', 'pur-1', 'T', 'B', 20, 600)]);
    expect(book(one, 'T').rows.map((r) => [r.nab, r.sp])).toEqual([[PLT.nab, PLT.sp]]);
    expect(book(one, 'S').rows).toEqual([]);
    expect(book(one).rows.map((r) => r.wh)).toEqual(['T']);
    expect(receiptShares(one, docOf).has('pur-1')).toBe(false);
  });

  it('a ПЛТ into the main warehouse does not appear in the stores', () => {
    const main = ctxOf([mv('1', 'pur-1', 'main', 'A', 10, 1000), mv('2', 'pur-1', 'main', 'B', 20, 600)]);
    expect(book(main).rows).toEqual([]);
    expect(book(main, 'T').rows).toEqual([]);
  });
});
