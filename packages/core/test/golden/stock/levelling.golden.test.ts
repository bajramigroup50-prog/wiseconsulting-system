import { describe, expect, it } from 'vitest';
import {
  levellingDiff,
  levellingEntries,
  levellingLines,
  levellingReversal,
  nextYearNumber,
  postTransfer,
  priceAt,
  promotionLevellingLines,
  promotionPrice,
  retailPrice,
  stockLinesBalanced,
  transferLines,
} from '../../../src/stock';
import { loadLegacy, toPortLines, type LegacyFixture } from './legacy';
import { CODES, ITEMS, MOVES, portCtx } from './fixtures';

const NIVEL = [
  { id: 'n1', type: 'nivel', number: '001/2026', date: '2026-01-20', wh: 's1', lines: [{ item: 'C', qty: 24, old: 75, new: 79 }, { item: 'A', qty: 2, old: 118, new: 112.5 }] },
  { id: 'n2', type: 'nivel', number: '002/2026', date: '2026-02-15', wh: 's1', lines: [{ item: 'C', qty: 20, old: 79, new: 72.9 }] },
  { id: 'n3', type: 'nivel', number: '003/2026', date: '2026-02-15', wh: 's2', lines: [{ item: 'C', qty: 6, old: 70, new: 71.35 }, { item: 'B', qty: 1.5, old: 42, new: 44 }] },
  { id: 'n4', type: 'nivel', number: '004/2026', date: '2026-03-01', wh: 'main', lines: [{ item: 'A', qty: 9.5, old: 118, new: 121.33 }] },
];
const RETAIL: LegacyFixture = { items: ITEMS, codes: CODES, moves: MOVES, docs: NIVEL, firm: { ddv: true, sch: { retailMethod: true, retailMarg: '6694' } } };

describe('levelling (нивелација)', () => {
  it('priceAt matches legacy for every item, location and date', () => {
    const L = loadLegacy(RETAIL);
    const ctx = portCtx(RETAIL);
    for (const it of ITEMS)
      for (const wh of ['main', 's1', 's2', 'w2', undefined])
        for (const d of ['2026-01-01', '2026-01-20', '2026-02-14', '2026-02-15', '2026-12-31'])
          expect(priceAt(ctx, it as any, wh, d)).toBe(L.fn.priceAt(it, wh, d));
  });

  it('retailPrice matches legacy retailP', () => {
    const L = loadLegacy(RETAIL);
    for (const it of ITEMS) for (const wh of ['s1', 's2', undefined]) expect(retailPrice(it as any, wh)).toBe(L.fn.retailP(it, wh));
  });

  it('journal lines match the legacy ledger posting at stores kept at retail value', () => {
    for (const ddv of [true, false]) {
      const fx = { ...RETAIL, firm: { ...RETAIL.firm, ddv } };
      const L = loadLegacy(fx);
      const posted: any[] = [];
      L.fn.__nivLedger((_k: string, doc: any) => posted.push(doc));
      const ctx = portCtx(fx);
      for (const n of NIVEL.filter((x) => x.wh !== 'main')) {
        const want = posted.find((p) => p.id === n.id);
        const got = levellingEntries(ctx, n);
        expect(got).toEqual(toPortLines(want.lines));
        expect(stockLinesBalanced(got)).toBe(true);
      }
    }
  });

  it('DELIBERATE FIX: a store kept at cost gets no levelling posting (legacy posted 6630/6690 there)', () => {
    const fx: LegacyFixture = { ...RETAIL, firm: { ddv: true, sch: {} } };
    const L = loadLegacy(fx);
    const posted: any[] = [];
    L.fn.__nivLedger((_k: string, doc: any) => posted.push(doc));
    expect(posted.find((p) => p.id === 'n1').lines.map((l: any) => l.k)).toEqual(['6630', '6690', '6640']);
    expect(levellingEntries(portCtx(fx), NIVEL[0]!)).toEqual([]);
  });

  it('DELIBERATE FIX: levelling uses the same margin account as sales (6694), legacy defaulted to 6690', () => {
    const fx: LegacyFixture = { ...RETAIL, firm: { ddv: true, sch: { retailMethod: true } } };
    const L = loadLegacy(fx);
    const posted: any[] = [];
    L.fn.__nivLedger((_k: string, doc: any) => posted.push(doc));
    expect(posted.find((p) => p.id === 'n1').lines[1].k).toBe('6690');
    expect(L.fn.rk('s1', 'Marg')).toBe('6694'); // what postOut uses for the same store
    expect(levellingEntries(portCtx(fx), NIVEL[0]!)[1]!.account).toBe('6694');
  });

  it('levelling lines take the quantity from stock at the date (corrected stockAt)', () => {
    const Li = loadLegacy(RETAIL, 'intended');
    const Ls = loadLegacy(RETAIL, 'shipped');
    const ctx = portCtx(RETAIL);
    const draft = { wh: 's1', prices: { A: 115, C: 81.4, B: '', M: null, X: 5 }, old: {}, qty: {} as Record<string, number> };
    const got = levellingLines(ctx, draft, '2026-02-20');
    expect(got.map((l) => l.item)).toEqual(['A', 'C']);
    for (const l of got) {
      const it = ITEMS.find((i) => i.id === l.item)!;
      expect(l.qty).toBe(Li.fn.stockAt(l.item, '2026-02-20', 's1').qty);
      expect(l.old).toBe(Li.fn.retailP(it, 's1'));
      // the shipped app: swapped arguments → quantity 0 → no value in ЕТМ, no posting
      expect(Ls.fn.stockAt(l.item, '2026-02-20', 's1').qty).toBe(0);
    }
    expect(got.find((l) => l.item === 'C')!.qty).toBe(24);
    // imported quantity / old price win; an unchanged price is skipped
    const imp = levellingLines(ctx, { wh: 's1', prices: { C: 80, A: 118 }, old: { C: 77 }, qty: { C: 3 } }, '2026-02-20');
    expect(imp).toEqual([{ item: 'C', qty: 3, old: 77, new: 80, qtyImp: true }]);
    expect(levellingDiff(imp)).toBe(9);
  });

  it('promotion prices match legacy akNewPrice', () => {
    const L = loadLegacy({});
    const cases: [number, any, any][] = [
      [118, {}, { pct: 20 }],
      [118, { pct: 15 }, { pct: 20, rnd: 1 }],
      [118, { price: '99.999' }, { pct: 20 }],
      [79.9, {}, { pct: 12.5, rnd: 10 }],
      [79.9, { pct: '' }, { pct: 33, rnd: 0 }],
    ];
    for (const [old, x, d] of cases) expect(promotionPrice(old, x, d)).toBe(L.fn.akNewPrice(old, x, d));
    // DELIBERATE FIX (float drift): 1.005 × 100 = 100.49999999999999 in floats, so legacy rounds a half cent down
    expect(L.fn.akNewPrice(1.005, {}, { pct: 0 })).toBe(1);
    expect(promotionPrice(1.005, {}, { pct: 0 })).toBe(1.01);
  });

  it('promotion start/end levellings and the automatic price-back levelling', () => {
    const ctx = portCtx(RETAIL);
    const promo = { wh: 's1', from: '2026-02-20', to: '2026-02-28', lines: [{ item: 'C', old: 72.9, new: 65 }, { item: 'ZZ', old: 1, new: 1 }] };
    expect(promotionLevellingLines(ctx, promo, '2026-02-20', false)).toEqual([{ item: 'C', qty: 24, old: 72.9, new: 65 }]);
    expect(promotionLevellingLines(ctx, promo, '2026-03-01', true)).toEqual([{ item: 'C', qty: 24, old: 65, new: 72.9 }]);
    const doc = { number: '005/2026', date: '2026-02-20', wh: 's1', lines: [{ item: 'C', qty: 24, old: 72.9, new: 65 }] };
    expect(levellingReversal(doc, '2026-02-28')).toEqual({
      date: '2026-03-01', wh: 's1', lines: [{ item: 'C', qty: 24, old: 65, new: 72.9 }],
      note: 'Враќање на цените по акција (005/2026)', akBack: '005/2026',
    });
    expect(levellingReversal(doc, '2026-02-19')).toBeNull();
  });

  it('DELIBERATE FIX: numbering is max+1, not count+1 (no repeat after a delete)', () => {
    const docs = [{ number: '001/2026', date: '2026-01-02' }, { number: '003/2026', date: '2026-02-02' }, { number: '009/2025', date: '2025-12-02' }];
    expect(nextYearNumber(docs, 2026)).toBe('004/2026'); // legacy: count+1 = 003/2026 (duplicate)
    expect(nextYearNumber([], '2027')).toBe('001/2027');
  });
});

describe('transfers (преносници)', () => {
  const C = ITEMS.find((i) => i.id === 'C')!;
  const A = ITEMS.find((i) => i.id === 'A')!;

  it('receiving lines match legacy prnLines for stores kept at retail value', () => {
    for (const ddv of [true, false]) {
      const fx = { ...RETAIL, firm: { ...RETAIL.firm, ddv } };
      const L = loadLegacy(fx);
      const ctx = portCtx(fx);
      for (const [it, q, sp, val, to] of [[C, 6, 79, 270, 's1'], [A, 3, 118, 186, 's2'], [C, 2.5, 74.99, 112.51, 's1']] as const) {
        const want = L.fn.prnLines(it, q, sp, val, to, 'main');
        const got = transferLines(ctx, { item: it as any, qty: q, retailUnitPrice: sp, cost: val, from: 'main', to });
        expect(got).toEqual(toPortLines(want));
        expect(stockLinesBalanced(got)).toBe(true);
      }
    }
  });

  it('DELIBERATE FIX: a store kept at cost — no retail lines; different stock accounts post at cost', () => {
    const fx: LegacyFixture = { ...RETAIL, firm: { ddv: true, sch: {} } };
    const L = loadLegacy(fx);
    expect(L.fn.prnLines(C, 6, 79, 270, 's1', 'main').map((l: any) => l.k)).toEqual(['6630', '6600', '6690', '6640']);
    const ctx = portCtx(fx);
    expect(transferLines(ctx, { item: C as any, qty: 6, retailUnitPrice: 79, cost: 270, from: 'main', to: 's1' })).toEqual([]);
    expect(transferLines(ctx, { item: C as any, qty: 6, retailUnitPrice: 79, cost: 270, from: 'main', to: 's2' })).toEqual([
      { account: '6631', debit: 270, credit: 0 },
      { account: '6600', debit: 0, credit: 270 },
    ]);
  });

  it('postTransfer issues at average cost and receives with balanced lines', () => {
    const ctx = portCtx(RETAIL);
    const r = postTransfer(ctx, { item: A as any, qty: 4, date: '2026-02-10', from: 'main', to: 's1', src: 'prn-7', outLabel: 'Преносница 0007/2026 → s1', inLabel: 'Преносница 0007/2026 од main' });
    expect(r.cost).toBe(248);
    expect(r.out).toMatchObject({ id: 'prn-7-A-transfer', qty: -4, value: -248, wh: 'main', lines: [] });
    expect(r.in).toMatchObject({ id: 'prn-7-A-in', qty: 4, value: 248, wh: 's1', type: 'transfer-in' });
    expect(r.in.lines).toEqual([
      { account: '6630', debit: 472, credit: 0 },
      { account: '6600', debit: 0, credit: 248 },
      { account: '6694', debit: 0, credit: 152 },
      { account: '6640', debit: 0, credit: 72 },
    ]);
    expect(r.unitCost).toBe(62);
  });
});
