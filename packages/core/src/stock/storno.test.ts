import { describe, expect, it } from 'vitest';
import { moveIsIn, stockAtAll } from './average';
import type { StockContext, StockMove } from './types';

const mv = (id: string, qty: number, value: number, type: string): StockMove => ({ id, date: '2026-11-14', item: 'i', qty, value, type, src: 'stock_import-x', lines: [] } as StockMove);

describe('storno carried over from an old program', () => {
  it('a negative receipt stays in the in column', () => {
    expect(moveIsIn(mv('a', -1406, -3622.7, 'in'))).toBe(true);
    expect(moveIsIn({ qty: -5, type: 'in', src: 'purchase-1' })).toBe(false);
    const ctx: StockContext = { moves: [mv('a', -1406, -3622.7, 'in'), mv('b', -8100, 0, 'sale')] };
    const s = stockAtAll(ctx, { date: '2026-12-31' }).get('i')!;
    expect([s.qty, s.inQ, s.outQ, s.inV]).toEqual([-9506, -1406, 8100, -3622.7]);
  });
});
