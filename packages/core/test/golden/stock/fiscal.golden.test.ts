import { describe, expect, it } from 'vitest';
import { dfiControl, dfiDays, fkAlloc, fkIssuePlan, fkSpread, kdfiDay, kdfiRows } from '../../../src/stock';
import { loadLegacy, type LegacyFixture } from './legacy';
import { CODES, ITEMS, portCtx } from './fixtures';

const json = (x: unknown) => JSON.parse(JSON.stringify(x));

const FITEMS = [
  ...ITEMS,
  { id: 'D', name: 'Чоколади', code: '004', unit: 'пак', type: 'goods', price: 45, rate: 18 },
  { id: 'E', name: 'Сирење', code: '005', unit: 'кг', type: 'goods', price: 380, rate: 5 },
  { id: 'F', name: 'Без цена', code: '006', unit: 'ком', type: 'goods', price: 0, rate: 18 },
];
const FMOVES = [
  { id: 'a1', date: '2026-01-03', item: 'A', qty: 10, value: 600, type: 'in', src: 'pur-a1', wh: 's1' },
  { id: 'a2', date: '2026-02-01', item: 'A', qty: 5, value: 330, type: 'in', src: 'pur-a2', wh: 's1' },
  { id: 'a3', date: '2026-02-03', item: 'A', qty: -2, value: -124, type: 'sale', src: 'pos-x', wh: 's1' },
  { id: 'c1', date: '2026-01-15', item: 'C', qty: 24, value: 1080, type: 'in', src: 'pur-c1', wh: 's1' },
  { id: 'b1', date: '2026-01-10', item: 'B', qty: 12.5, value: 437.5, type: 'in', src: 'pur-b1', wh: 's1' },
  { id: 'd1', date: '2025-12-20', item: 'D', qty: 8, value: 280, type: 'in', src: 'pur-d1', wh: 's1' },
  { id: 'e1', date: '2026-01-25', item: 'E', qty: 3.456, value: 1036.8, type: 'in', src: 'pur-e1', wh: 's1' },
  { id: 'f1', date: '2026-01-25', item: 'F', qty: 3, value: 30, type: 'in', src: 'pur-f1', wh: 's1' },
  { id: 'a9', date: '2026-01-05', item: 'A', qty: 50, value: 3000, type: 'in', src: 'pur-a9', wh: 'main' },
  { id: 'late', date: '2026-03-01', item: 'D', qty: 100, value: 3500, type: 'in', src: 'pur-late', wh: 's1' },
];
const FDOCS = [{ id: 'n1', type: 'nivel', number: '001/2026', date: '2026-01-20', wh: 's1', lines: [{ item: 'C', qty: 24, old: 75, new: 79 }] }];
const FX: LegacyFixture = { items: FITEMS, codes: CODES, moves: FMOVES, docs: FDOCS, firm: { ddv: true, sch: {} } };

describe('fkAlloc — FIFO/LIFO goods selection for a fiscal turnover', () => {
  const cases: [number, number | null, string][] = [];
  for (const method of ['fifo', 'lifo', 'prop', 'none'])
    for (const [target, rate] of [[600, 18], [2500, 18], [95, 10], [140, 5], [1000, null], [99999, null], [0.3, 18]] as [number, number | null][])
      cases.push([target, rate, method]);

  for (const [target, rate, method] of cases)
    it(`matches legacy (intended stockAt): ${method}, target ${target}, rate ${rate}`, () => {
      const L = loadLegacy(FX, 'intended');
      const used0 = { A: 1 };
      const used = { ...used0 };
      const want = L.fn.fkAlloc(target, '2026-02-10', 's1', rate, method, used);
      const got = fkAlloc(portCtx(FX), { target, date: '2026-02-10', wh: 's1', rate, method, used: used0 });
      expect(got.lines).toEqual(want.lines);
      expect(got.rest).toBe(want.rest + 0);
      expect(got.used).toEqual(used);
      expect(used0).toEqual({ A: 1 }); // input not mutated
    });

  it('FIFO takes the oldest receipt first, LIFO the newest', () => {
    const ctx = portCtx(FX);
    expect(fkAlloc(ctx, { target: 300, date: '2026-02-10', wh: 's1', rate: 18, method: 'fifo' }).lines[0]!.item).toBe('D');
    expect(fkAlloc(ctx, { target: 300, date: '2026-02-10', wh: 's1', rate: 18, method: 'lifo' }).lines[0]!.item).toBe('A');
  });

  it('DELIBERATE FIX: the shipped legacy (swapped stockAt) never proposes goods; the port does', () => {
    const L = loadLegacy(FX, 'shipped');
    const want = L.fn.fkAlloc(600, '2026-02-10', 's1', 18, 'fifo', {});
    expect(want).toEqual({ lines: [], rest: 600 });
    expect(fkAlloc(portCtx(FX), { target: 600, date: '2026-02-10', wh: 's1', rate: 18, method: 'fifo' }).lines.length).toBeGreaterThan(0);
  });

  it('matches legacy fkIssuePlan over several report rows (used quantities carry over)', () => {
    const G = { 'А': 18, 'Б': 5, 'В': 0, 'Г': 10 };
    const rows = [
      { date: '2026-02-05', z: '7', total: 700, gross: { 'А': 500, 'Б': 100, 'Г': 100 } },
      { date: '2026-02-06', z: '8', total: 1200, gross: { 'А': 1100, 'Б': 0, 'Г': 100 } },
      { date: '2026-02-07', z: '9', total: 900, gross: { 'А': 900 } },
    ];
    for (const method of ['fifo', 'lifo', 'prop'])
      for (const nonVat of [false, true]) {
        const L = loadLegacy(FX, 'intended');
        // JSON round-trip: legacy can yield `-0` for an exactly covered remainder; the port normalises it to 0
        expect(json(fkIssuePlan(portCtx(FX), rows, G, 's1', method, nonVat))).toEqual(json(L.fn.fkIssuePlan(structuredClone(rows), G, 's1', method, nonVat)));
      }
  });

  it('matches legacy fkSpread', () => {
    const L = loadLegacy({});
    for (const [a, b, t] of [['2026-03-01', '2026-03-31', 123456.78], ['2026-02-02', '2026-02-02', 50], ['2026-03-01', '2026-03-01', 50], ['2026-01-01', '2026-01-10', 1000.01]] as const)
      expect(fkSpread(a, b, t)).toEqual(L.fn.fkSpread(a, b, t));
  });
});

const SALES = [
  {
    id: 'z-s1-2026-03-02', date: '2026-03-02', wh: 's1', total: 1500,
    groups: [{ rate: 18, base: 1000.004, vat: 180.006 }, { rate: 5, base: 300.1, vat: 15.01 }, { rate: 0, base: 5, vat: 0 }, { rate: 7, base: 9, vat: 1 }],
    mk: { 18: { g: 200, v: 30.51 }, 5: { g: 50.1, v: 2.39 }, 0: { g: 3 } },
  },
  {
    id: 'zf-s1-p1', date: '2026-03-10', wh: 's1', total: 1260.5,
    days: [
      { date: '2026-03-03', z: '12', total: 820.5, g: { 18: 600.5, 10: 220 }, v: { 18: 91.6, 10: 20 } },
      { date: '2026-03-04', z: '13', total: 0, g: { 18: 0 }, v: {} },
      { date: '2026-03-06', z: '15', total: 410, g: { 18: 410 }, v: { 18: 62.54 } },
      { date: '2026-03-06', z: '15', total: 10, g: { 5: 10 }, v: { 5: 0.48 } },
      { date: '2026-03-05', z: '16', total: 20, g: { 5: 20 }, v: { 5: 0.95 } },
    ],
    fisk: { from: '2026-03-03', to: '2026-03-06' },
  },
  { id: 'zf-s1-per', date: '2026-03-20', wh: 's1', total: 5000, fisk: { z: '20', from: '2026-03-16', to: '2026-03-20' } },
  { id: 'zf-s2-x', date: '2026-03-09', wh: 's2', total: 333, days: [{ date: '2026-03-09', z: '', total: 333, est: true }] },
  { id: 'mo-77', date: '2026-03-09', wh: 's1', total: 45, groups: [{ rate: 18, base: 38.14, vat: 6.86 }] },
  { id: 'z-s1-2026-03-09', date: '2026-03-09', wh: 's1', total: 99, groups: [{ rate: 18, base: 83.9, vat: 15.1 }], fisk: { z: '17' } },
  { id: 'zf-s1-9', date: '2026-03-09', wh: 's1', total: 10, fisk: { z: '18' } },
  { id: 'zf-s1-old', date: '2026-02-27', wh: 's1', total: 10, fisk: { z: '11' } },
];
const LEDGER = [
  { k: '1020', date: '2026-03-02', d: 1500, p: 0 },
  { k: '1020', date: '2026-03-03', d: 820.5, p: 0 },
  { k: '1020', date: '2026-03-04', d: 1200.25, p: 0 },
  { k: '1020', date: '2026-03-05', d: 0, p: 500 },
  { k: '1021', date: '2026-03-09', d: 300.1, p: 0 },
  { k: '1200001', date: '2026-03-03', d: 220.4, p: 0 },
  { k: '1200001', date: '2026-03-05', d: 0, p: 100 },
  { k: '1200001', date: '2026-04-05', d: 0, p: 100 },
  { k: '1020', date: '2026-04-10', d: 9999, p: 0 },
];

describe('КДФИ and DFI control', () => {
  it('matches legacy kdfiDay / kdfiRows for all and for one location', () => {
    for (const wh of ['', 's1', 's2']) {
      const L = loadLegacy({ sales: SALES });
      Object.assign(L.S, { kdfiWh: wh, kdfiFrom: '2026-03-01', kdfiTo: '2026-03-31' });
      const want = L.fn.kdfiRows();
      const got = kdfiRows(SALES, '2026-03-01', '2026-03-31', wh || undefined);
      // legacy left `mvt` (Macedonian-product VAT total) unrounded; the port rounds it to cents
      expect(got).toEqual(want.rows.map((r: any) => ({ ...r, mvt: Math.round(r.mvt * 100) / 100, mv: Object.fromEntries(Object.entries(r.mv).map(([k, v]: any) => [k, Math.round(v * 100) / 100])) })));
      expect(kdfiDay(SALES, '2026-03-02', wh || undefined).tot).toBe(L.fn.kdfiDay('2026-03-02').tot);
    }
  });

  it('matches legacy dfiDays and dfiControl findings', () => {
    const opts = [{}, { offDays: '0,6', cashMax: 2000, depDays: 2, cardK: '1200001' }, { cashMax: 500, depDays: 30 }];
    for (const O of opts)
      for (const wh of ['', 's1'])
        for (const [from, to, today] of [['2026-03-01', '2026-03-31', '2026-03-25'], ['2026-03-01', '2026-03-12', '2026-12-31'], ['2026-03-05', '2026-03-05', '2026-03-05']] as const) {
          const L = loadLegacy({ sales: SALES, ledger: LEDGER, today, firm: { ddv: true, fiskOpt: O } });
          const want = L.fn.dfiControl(wh, from, to);
          const got = dfiControl({
            sales: SALES, wh: wh || undefined, from, to, today, opts: O,
            ledger: LEDGER.map((l) => ({ account: l.k, date: l.date, debit: l.d, credit: l.p })),
          });
          expect(got.D).toEqual(want.D.map((d: any) => (d.pos === undefined ? d : d)));
          expect(got.miss).toEqual(want.miss);
          expect(got.F.map(({ sev, t }) => ({ sev, t }))).toEqual(want.F);
          expect(dfiDays(SALES, wh || undefined, from, to)).toEqual(L.fn.dfiDays(wh, from, to));
        }
  });

  it('flags duplicate, skipped and out-of-order Z numbers', () => {
    const r = dfiControl({ sales: SALES, wh: 's1', from: '2026-03-01', to: '2026-03-31', today: '2026-03-31', ledger: [] });
    expect(r.F.filter((f) => f.sev === 'bad').map((f) => f.code).sort()).toEqual(['zDuplicate', 'zGap', 'zGap', 'zOrder']);
  });
});
