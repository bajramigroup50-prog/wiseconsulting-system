/** Retail review fixes: transfers out of a store kept at retail value, the turnover clearing of 6630, `trgNoVat` cost. */
import { describe, expect, it } from 'vitest';
import {
  postTransfer, reaverage, retailClearLines, retailCostRatio, stockLinesBalanced, type StockContext, type StockItem, type StockMove,
} from './stock';
import { fiskEntries, type PostingContext } from './posting';

const A: StockItem = { id: 'A', name: 'A', unit: 'ком', type: 'goods', price: 100, rate: 18 };
const LOC = [
  { id: 's1', kind: 'store' as const },
  { id: 's2', kind: 'store' as const },
  { id: 'w2', kind: 'warehouse' as const, konto: '6601' },
];
const inMove = (date: string, qty: number, value: number, wh = 's1'): StockMove => ({ id: `in-${date}-${wh}`, date, item: 'A', qty, value, type: 'in', src: 'pur-' + date, wh, lines: [] });
const ctxOf = (moves: StockMove[]): StockContext => ({ moves, items: [A], locations: LOC, scheme: { retailMethod: true } });
const tl = (L: readonly { account: string; debit: number; credit: number }[]) => L.map((l) => [l.account, l.debit, l.credit]);
const by = (L: readonly { account: string; debit: number; credit: number }[], k: string) => Math.round(L.filter((l) => l.account === k).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

describe('transfer out of a store kept at retail value', () => {
  const ctx = ctxOf([inMove('2026-01-10', 10, 600)]);

  it('store → warehouse: the issue clears 6630 / 6694 / 6640, the cost goes to the warehouse stock', () => {
    const r = postTransfer(ctx, { item: A, qty: 4, date: '2026-02-01', from: 's1', to: 'w2', src: 'prn-1' });
    // 4 × 118 = 472 incl. VAT 72, cost 4 × 60 = 240, margin 160
    expect(tl(r.out.lines!)).toEqual([['6601', 240, 0], ['6694', 160, 0], ['6640', 72, 0], ['6630', 0, 472]]);
    expect(r.in.lines).toEqual([]);
    expect(stockLinesBalanced([...r.out.lines!, ...r.in.lines!])).toBe(true);
  });

  it('store → store: the sender is cleared, the receiver gets its own retail split, the cost passes through 6600', () => {
    const r = postTransfer(ctx, { item: A, qty: 4, date: '2026-02-01', from: 's1', to: 's2', src: 'prn-2', retailUnitPrice: 130 });
    expect(tl(r.out.lines!)).toEqual([['6600', 240, 0], ['6694', 160, 0], ['6640', 72, 0], ['6630', 0, 472]]);
    expect(tl(r.in.lines!)).toEqual([['6630', 520, 0], ['6600', 0, 240], ['6694', 0, 200.68], ['6640', 0, 79.32]]);
    const all = [...r.out.lines!, ...r.in.lines!];
    expect(stockLinesBalanced(all)).toBe(true);
    expect(by(all, '6600')).toBe(0);
    expect(by(all, '6630')).toBe(48);
  });

  it('a warehouse → store transfer is unchanged (no lines on the issue)', () => {
    const c = ctxOf([inMove('2026-01-10', 10, 600, 'main')]);
    const r = postTransfer(c, { item: A, qty: 4, date: '2026-02-01', from: 'main', to: 's1', src: 'prn-3', retailUnitPrice: 118 });
    expect(r.out.lines).toEqual([]);
    expect(tl(r.in.lines!)).toEqual([['6630', 472, 0], ['6600', 0, 240], ['6694', 0, 160], ['6640', 0, 72]]);
  });

  it('re-averaging re-values the issue and keeps it balanced (the margin absorbs the cost change)', () => {
    const r = postTransfer(ctx, { item: A, qty: 4, date: '2026-02-01', from: 's1', to: 'w2', src: 'prn-4' });
    const res = reaverage(ctxOf([inMove('2026-01-10', 10, 600), inMove('2026-01-15', 10, 800), r.out, r.in]));
    const out = res.moves.find((m) => m.id === r.out.id)!;
    expect(out.value).toBe(-280);
    expect(tl(out.lines!)).toEqual([['6601', 280, 0], ['6694', 120, 0], ['6640', 72, 0], ['6630', 0, 472]]);
  });
});

describe('daily turnover of a store kept at retail value', () => {
  it('cost share of the store stock: Σ cost / Σ retail value without VAT; 1 without stock', () => {
    const ctx = ctxOf([inMove('2026-01-10', 10, 600)]);
    expect(retailCostRatio(ctx, 's1', '2026-02-01')).toBe(0.6);
    expect(retailCostRatio(ctx, 's1', '2026-01-01')).toBe(1);
  });

  it('clears 6630 by the turnover: D 7010 cost / D 6694 realised margin / D 6640 VAT, C 6630', () => {
    const ctx = ctxOf([inMove('2026-01-10', 10, 600)]);
    const L = retailClearLines(ctx, { wh: 's1', date: '2026-02-01', gross: 236, vat: 36 });
    expect(tl(L)).toEqual([['7010', 120, 0], ['6694', 80, 0], ['6640', 36, 0], ['6630', 0, 236]]);
    // a negative correction posts the mirror image
    expect(tl(retailClearLines(ctx, { wh: 's1', date: '2026-02-01', gross: -118, vat: -18 }))).toEqual([['7010', 0, 60], ['6694', 0, 40], ['6640', 0, 18], ['6630', 118, 0]]);
    expect(retailClearLines(ctx, { wh: 's1', date: '2026-02-01', gross: 0, vat: 0 })).toEqual([]);
  });
});

describe('fiscal scheme trgNoVat', () => {
  const pc: PostingContext = { firm: {}, global: null };
  const z = { date: '2026-03-07', total: 500, groups: [{ rate: 0, base: 500, vat: 0 }], fisk: { sc: 'trgNoVat' as const } };

  it('the turnover leaves 6630 as cost of goods sold (7010) + realised margin (6694)', () => {
    const L = fiskEntries({ ...z, cogs: { account: '7010', ratio: 0.6 } }, pc);
    expect(L.filter((l) => ['7010', '6694', '6630'].includes(l.account)).map((l) => [l.account, l.debit, l.credit])).toEqual([['7010', 300, 0], ['6694', 200, 0], ['6630', 0, 500]]);
    expect(stockLinesBalanced(L)).toBe(true);
  });

  it('without cost information the legacy posting stays (the whole turnover D 6694)', () => {
    const L = fiskEntries(z, pc);
    expect(L.filter((l) => ['7010', '6694', '6630'].includes(l.account)).map((l) => [l.account, l.debit, l.credit])).toEqual([['6694', 500, 0], ['6630', 0, 500]]);
  });
});
