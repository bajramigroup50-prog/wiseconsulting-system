import { describe, expect, it } from 'vitest';
import { postOut, reaverage, stock, stockAt, stockLinesBalanced } from '../../../src/stock';
import { loadLegacy, toPortLines, type LegacyFixture } from './legacy';
import { CODES, ITEMS, MOVES, PEND_MOVE, portCtx } from './fixtures';

const FX: LegacyFixture = { items: ITEMS, codes: CODES, moves: MOVES, firm: { ddv: true, sch: {} } };
const LOCS = [undefined, 'main', 'w2', 's1', 's2'];
const DATES = ['2026-01-01', '2026-01-05', '2026-01-09', '2026-01-10', '2026-01-12', '2026-01-21', '2026-02-01', '2026-12-31'];

describe('stock() — weighted average, receipts and issues across warehouses', () => {
  it('matches legacy stock(itemId, wh) for every item and location', () => {
    const L = loadLegacy(FX);
    const ctx = portCtx(FX);
    for (const it of ITEMS) for (const wh of LOCS) expect(stock(ctx, it.id, wh)).toEqual(L.fn.stock(it.id, wh));
  });

  it('ignores pending (client) moves, like legacy stock()', () => {
    const fx = { ...FX, moves: [...MOVES, PEND_MOVE] };
    const L = loadLegacy(fx);
    expect(stock(portCtx(fx), 'B', 'main')).toEqual(L.fn.stock('B', 'main'));
    expect(stock(portCtx(fx), 'B', 'main').qty).toBe(16.417);
  });
});

describe('stockAt() — stock at a date per item and location', () => {
  it('matches the legacy (id, date, wh) function the callers were written for, incl. in/out totals', () => {
    const L = loadLegacy(FX, 'intended');
    const ctx = portCtx(FX);
    for (const it of ITEMS)
      for (const wh of LOCS)
        for (const date of DATES) {
          const want = L.fn.stockAt(it.id, date, wh);
          const got = stockAt(ctx, { item: it.id, wh, date });
          // legacy 4914 returned avg 0 without stock; the port (like 13858 / stock()) falls back to item cost
          expect({ ...got, avg: want.qty > 0 ? got.avg : 0 }).toEqual(want);
        }
  });

  it('DELIBERATE FIX: the shipped legacy call stockAt(id, date, wh) returns 0 — the port returns the real stock', () => {
    const L = loadLegacy(FX, 'shipped');
    // what ~22 legacy callers actually execute: the date lands in `wh`, every move is skipped
    const shipped = L.fn.stockAt('A', '2026-01-12', 'main');
    expect(shipped.qty).toBe(0);
    expect(shipped.avg).toBe(50); // item.cost fallback
    expect(shipped.inQ).toBeUndefined(); // 13858 also lost the LAGER in/out totals
    // the 13858 body itself is right when called with its own argument order
    expect(L.fn.stockAt('A', 'main', '2026-01-12').qty).toBe(12);
    const got = stockAt(portCtx(FX), { item: 'A', wh: 'main', date: '2026-01-12' });
    expect(got).toEqual({ qty: 12, value: 744, avg: 62, inQ: 15, outQ: 3, inV: 930, outV: 186 });
  });

  it('`inclusive:false` = the 13858 `before` flag (balance at the start of the day)', () => {
    const L = loadLegacy(FX, 'shipped');
    const ctx = portCtx(FX);
    for (const it of ITEMS)
      for (const wh of LOCS)
        for (const date of DATES) {
          const want = L.fn.stockAt(it.id, wh, date, true);
          const got = stockAt(ctx, { item: it.id, wh, date, inclusive: false });
          expect({ qty: got.qty, value: got.value, avg: got.avg }).toEqual(want);
        }
  });

  it('DELIBERATE FIX: skips pending moves (legacy 4914 counted them)', () => {
    const fx = { ...FX, moves: [...MOVES, PEND_MOVE] };
    const L = loadLegacy(fx, 'intended');
    expect(L.fn.stockAt('B', '2026-01-31', 'main').qty).toBe(116.417);
    expect(stockAt(portCtx(fx), { item: 'B', wh: 'main', date: '2026-01-31' }).qty).toBe(16.417);
  });
});

describe('postOut() — issue at average cost', () => {
  const cases: [string, any[]][] = [
    ['sale from main (cost)', ['A', 4, '2026-02-10', 'sale', 'inv-9-0', 'Фактура 9', '7010', 'main']],
    ['sale of fractional qty', ['B', 2.75, '2026-02-10', 'sale', 'inv-9-1', 'Фактура 9', '7010', 'main']],
    ['write-off from second warehouse', ['A', 1, '2026-02-10', 'writeoff', 'mo-x-0', 'Отпис', '5700', 'w2']],
    ['return to supplier with partner extra', ['A', 2, '2026-02-10', 'return', 'mo-r-0', 'Повратница', '2200', 'main', { partner: 'p1' }]],
    ['no stock at location → average of all locations', ['A', 1, '2026-02-10', 'sale', 'inv-9-2', 'Фактура 9', '7010', 's2']],
    ['no stock anywhere → last purchase price', ['M', 60, '2026-02-10', 'prod-out', 'prod-1', 'Производство', '6000', 'main']],
    ['raw-material item booked to rawK', ['R', 7, '2026-02-10', 'prod-out', 'prod-1', 'Производство', '6000', 'main']],
    ['transfer out (no counter account → no lines)', ['A', 3, '2026-02-10', 'transfer', 'prn-2', 'Преносница', null, 'main']],
  ];
  for (const [name, args] of cases)
    it(`matches legacy: ${name}`, async () => {
      const fx = name.includes('no stock anywhere') ? { ...FX, moves: MOVES.filter((m) => m.item !== 'M').concat([{ ...MOVES.find((m) => m.item === 'M')!, qty: 50, value: 1250 }, { id: 'out-M', date: '2026-01-30', item: 'M', qty: -50, value: -1250, type: 'prod-out', src: 'prod-0', wh: 'main', lines: [] }]) } : FX;
      const L = loadLegacy(fx);
      const [itemId, qty, date, type, src, label, debitK, wh, extra] = args;
      const val = await L.fn.postOut(L.S.data.items.find((i: any) => i.id === itemId), qty, date, type, src, label, debitK, wh, extra);
      const legacyMove = L.saved.find(([c]) => c === 'moves')![1];
      const ctx = portCtx(fx);
      const res = postOut(ctx, { item: ITEMS.find((i) => i.id === itemId)!, qty, date, type, src, label, debitAccount: debitK, wh, extra });
      expect(res.value).toBe(val);
      expect(res.move).toEqual({ ...legacyMove, lines: toPortLines(legacyMove.lines) });
      expect(stockLinesBalanced(res.move.lines!)).toBe(true);
    });

  it('matches legacy at a store kept at retail value (cost / margin / VAT / retail stock)', async () => {
    const fx: LegacyFixture = {
      ...FX,
      firm: { ddv: true, sch: { retailMethod: true } },
      docs: [{ id: 'n1', type: 'nivel', number: '001/2026', date: '2026-01-20', wh: 's1', lines: [{ item: 'C', qty: 24, old: 75, new: 79 }] }],
    };
    for (const [wh, date] of [['s1', '2026-01-18'], ['s1', '2026-02-01'], ['s2', '2026-02-01']] as const) {
      const L = loadLegacy(fx);
      const val = await L.fn.postOut(L.S.data.items.find((i: any) => i.id === 'C'), 5, date, 'sale', 'pos-1', 'Каса', '7010', wh);
      const lm = L.saved[0]![1];
      const res = postOut(portCtx(fx), { item: ITEMS.find((i) => i.id === 'C')!, qty: 5, date, type: 'sale', src: 'pos-1', label: 'Каса', debitAccount: '7010', wh });
      expect(res.value).toBe(val);
      expect(res.move.lines).toEqual(toPortLines(lm.lines));
      expect(stockLinesBalanced(res.move.lines!)).toBe(true);
    }
  });
});

describe('reaverage() — re-run weighted average by date', () => {
  // issues booked at stale costs (and out of date order) get re-valued at the running average
  const STALE = [
    { id: 'i1', date: '2026-03-01', item: 'A', qty: 10, value: 1000, type: 'in', src: 'pur-a', wh: 'main', lines: [] },
    { id: 'o1', date: '2026-03-02', item: 'A', qty: -4, value: -300, type: 'sale', src: 'inv-a-0', wh: 'main', lines: [{ k: '7010', d: 300, p: 0 }, { k: '6600', d: 0, p: 300 }] },
    { id: 'i2', date: '2026-03-03', item: 'A', qty: 6, value: 780, type: 'in', src: 'pur-b', wh: 'main', lines: [] },
    { id: 'o2', date: '2026-03-03', item: 'A', qty: -3, value: -100, type: 'sale', src: 'inv-b-0', wh: 'main', lines: [{ k: '7010', d: 100, p: 0 }, { k: '6600', d: 0, p: 100 }] },
    { id: 'o3', date: '2026-03-05', item: 'A', qty: -1.5, value: -170, type: 'writeoff', src: 'mo-c-0', wh: 'main', lines: [{ k: '5700', d: 170, p: 0 }, { k: '6600', d: 0, p: 170 }] },
    { id: 'i3', date: '2026-03-01', item: 'B', qty: 3, value: 100, type: 'in', src: 'pur-c', wh: 'w2', lines: [] },
    { id: 'o4', date: '2026-03-04', item: 'B', qty: -1, value: -40, type: 'sale', src: 'inv-c-0', wh: 'w2', lines: [{ k: '7010', d: 40, p: 0 }, { k: '6600', d: 0, p: 40 }] },
  ];

  it('matches legacy values and lines for issues across items and locations', async () => {
    const fx: LegacyFixture = { ...FX, moves: STALE };
    const L = loadLegacy(fx);
    await L.fn.reaverage();
    const got = reaverage(portCtx(fx));
    for (const lm of L.S.data.moves) {
      const pm = got.moves.find((m) => m.id === lm.id)!;
      expect(pm.value).toBe(lm.value);
      expect(pm.lines).toEqual(toPortLines(lm.lines));
    }
    expect(got.changedMoves.sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(got.moves.find((m) => m.id === 'o2')!.value).toBe(-345); // 12 on hand at avg 115 (600 + 780) / 12
  });

  it('matches legacy for a single-item transfer (the paired transfer-in is re-valued)', async () => {
    const T = [
      { id: 'i1', date: '2026-03-01', item: 'A', qty: 10, value: 1000, type: 'in', src: 'pur-a', wh: 'main', lines: [] },
      { id: 'prn-9-A-transfer', date: '2026-03-02', item: 'A', qty: -4, value: -300, type: 'transfer', src: 'prn-9', wh: 'main', lines: [] },
      { id: 'prn-9-A-in', date: '2026-03-02', item: 'A', qty: 4, value: 300, type: 'transfer-in', src: 'prn-9', wh: 'w2', lines: [] },
    ];
    const fx: LegacyFixture = { ...FX, moves: T };
    const L = loadLegacy(fx);
    await L.fn.reaverage();
    const got = reaverage(portCtx(fx));
    for (const lm of L.S.data.moves) expect(got.moves.find((m) => m.id === lm.id)!.value).toBe(lm.value);
    expect(got.moves.find((m) => m.id === 'prn-9-A-in')!.value).toBe(400);
  });

  it('DELIBERATE FIX: multi-item transfer — each transfer-in keeps its own item (legacy overwrote the first)', async () => {
    const T = [
      { id: 'i1', date: '2026-03-01', item: 'A', qty: 10, value: 1000, type: 'in', src: 'pur-a', wh: 'main', lines: [] },
      { id: 'i2', date: '2026-03-01', item: 'B', qty: 10, value: 50, type: 'in', src: 'pur-a', wh: 'main', lines: [] },
      { id: 'prn-9-A-transfer', date: '2026-03-02', item: 'A', qty: -4, value: -300, type: 'transfer', src: 'prn-9', wh: 'main', lines: [] },
      { id: 'prn-9-A-in', date: '2026-03-02', item: 'A', qty: 4, value: 300, type: 'transfer-in', src: 'prn-9', wh: 'w2', lines: [] },
      { id: 'prn-9-B-transfer', date: '2026-03-02', item: 'B', qty: -2, value: -12, type: 'transfer', src: 'prn-9', wh: 'main', lines: [] },
      { id: 'prn-9-B-in', date: '2026-03-02', item: 'B', qty: 2, value: 12, type: 'transfer-in', src: 'prn-9', wh: 'w2', lines: [] },
    ];
    const fx: LegacyFixture = { ...FX, moves: T };
    const L = loadLegacy(fx);
    await L.fn.reaverage();
    const legacyAin = L.S.data.moves.find((m: any) => m.id === 'prn-9-A-in');
    expect(legacyAin.value).toBe(10); // legacy bug: item B's transfer value written onto item A's receipt
    const got = reaverage(portCtx(fx));
    expect(got.moves.find((m) => m.id === 'prn-9-A-in')!.value).toBe(400);
    expect(got.moves.find((m) => m.id === 'prn-9-B-in')!.value).toBe(10);
  });

  it('DELIBERATE FIX: retail-value issue lines stay balanced (legacy set all four lines to the new cost)', async () => {
    const fx: LegacyFixture = {
      ...FX,
      firm: { ddv: true, sch: { retailMethod: true } },
      moves: [
        { id: 'i1', date: '2026-03-01', item: 'C', qty: 10, value: 450, type: 'in', src: 'pur-a', wh: 's1', lines: [] },
        {
          id: 'o1', date: '2026-03-02', item: 'C', qty: -2, value: -80, type: 'sale', src: 'pos-1', wh: 's1',
          lines: [{ k: '7010', d: 80, p: 0 }, { k: '6694', d: 56, p: 0 }, { k: '6640', d: 14, p: 0 }, { k: '6630', d: 0, p: 150 }],
        },
      ],
    };
    const L = loadLegacy(fx);
    await L.fn.reaverage();
    const lo = L.S.data.moves.find((m: any) => m.id === 'o1');
    const sum = (ls: any[], s: 'd' | 'p') => ls.reduce((a, l) => a + l[s], 0);
    expect(sum(lo.lines, 'd')).not.toBe(sum(lo.lines, 'p')); // legacy: unbalanced
    const got = reaverage(portCtx(fx)).moves.find((m) => m.id === 'o1')!;
    expect(got.value).toBe(-90);
    expect(got.lines).toEqual([
      { account: '7010', debit: 90, credit: 0 },
      { account: '6694', debit: 46, credit: 0 },
      { account: '6640', debit: 14, credit: 0 },
      { account: '6630', debit: 0, credit: 150 },
    ]);
  });

  it('matches legacy production re-costing (product receipt = materials + labour)', async () => {
    const fx: LegacyFixture = {
      ...FX,
      moves: [
        { id: 'i1', date: '2026-03-01', item: 'M', qty: 100, value: 2500, type: 'in', src: 'pur-m', wh: 'main', lines: [] },
        { id: 'prod-1-M-prod-out', date: '2026-03-02', item: 'M', qty: -10, value: -200, type: 'prod-out', src: 'prod-1', wh: 'main', lines: [{ k: '6000', d: 200, p: 0 }, { k: '3100', d: 0, p: 200 }] },
        { id: 'prod-1-in', date: '2026-03-02', item: 'P', qty: 50, value: 260, type: 'prod-in', src: 'prod-1', wh: 'main', lines: [] },
        { id: 'o-P', date: '2026-03-03', item: 'P', qty: -20, value: -100, type: 'sale', src: 'inv-p-0', wh: 'main', lines: [{ k: '7000', d: 100, p: 0 }, { k: '6300', d: 0, p: 100 }] },
      ],
      production: [{ id: 'prod-1', date: '2026-03-02', product: 'P', qty: 50, mat: 200, lab: 60, unit: 5.2 }],
    };
    const L = loadLegacy(fx);
    await L.fn.reaverage();
    const got = reaverage(portCtx(fx), fx.production);
    for (const lm of L.S.data.moves) {
      const pm = got.moves.find((m) => m.id === lm.id)!;
      expect(pm.value).toBe(lm.value);
      expect(pm.lines).toEqual(toPortLines(lm.lines));
    }
    expect(got.production[0]).toEqual(L.S.data.production[0]);
    expect(got.moves.find((m) => m.id === 'o-P')!.value).toBe(-124);
  });
});
