/**
 * Golden tests for the stock books (packages/core/src/stock-books.ts) and production (stock/production.ts) against the
 * legacy `lagerData`, `kartData`, `trgData`, `etData`, `metgData`, `moveDoc`, `unitCost` and `runProd`.
 */
import { describe, expect, it } from 'vitest';
import {
  LAGER,
  dailySalesTotals,
  etBook,
  itemCard,
  lagerColumnTotal,
  lagerRows,
  lagerSummary,
  legacyMoveDoc,
  metgCard,
  tradeBook,
  transferBookTotals,
  type LagerView,
} from '../../../src/stock-books';
import { bomCycle, productionNeeds, runProduction, unitCost, type StockMove } from '../../../src/stock';
import { loadLegacy, toPortLines, type LegacyFixture } from './legacy';
import { CODES, ITEMS, MOVES, PEND_MOVE, portCtx } from './fixtures';

const PARTNERS = [{ id: 'P1', name: 'Добавувач ДОО' }, { id: 'K1', name: 'Купувач ДООЕЛ' }];
const PURCHASES = [
  { id: '1', number: 'F-100', calcNo: '5', partner: 'P1', date: '2026-01-05', docDate: '2026-01-04', wh: 'main', stock: [{ item: 'A', qty: 10, price: 60 }, { item: 'B', qty: 12.5, price: 35 }, { item: 'M', qty: 50, price: 25 }] },
  { id: '5', number: 'F-7', partner: 'P1', date: '2026-01-15', wh: 's1', costs: { trans: { amt: 120 } }, stock: [{ item: 'C', qty: 24, price: 40, sp: 75 }] },
  { id: '6', number: 'F-8', calcNo: 'F-8', supplierName: 'Увоз ГмбХ', imp: true, fx: 61.5, date: '2026-01-16', wh: 's2', costs: { car: { amt: 30, lines: [{ base: 300, rate: 18, vat: 54 }] } }, stock: [{ item: 'C', qty: 6, price: 0.8 }] },
];
const INVOICES = [
  { id: '1', number: '1/2026', date: '2026-01-12', partner: 'K1', items: [{ qty: 3, price: 100, disc: 10 }] },
  { id: '2', number: '2/2026', date: '2026-01-21', partner: 'K1', items: [{ qty: 3.333, price: 40 }] },
];
const NIVEL = [
  { id: 'n1', type: 'nivel', number: '001/2026', date: '2026-01-20', wh: 's1', lines: [{ item: 'C', qty: 24, old: 75, new: 79 }, { item: 'A', qty: 2, old: 118, new: 112.5 }] },
  { id: 'n2', type: 'nivel', number: '002/2026', date: '2026-02-15', wh: 's1', lines: [{ item: 'C', qty: 20, old: 79, new: 72.9 }] },
  { id: 'n3', type: 'nivel', number: '003/2026', date: '2026-02-15', wh: 's2', lines: [{ item: 'C', qty: 6, old: 70, new: 71.35 }] },
];
const DOCS = [
  ...NIVEL,
  { id: 'prn-1', type: 'prenos', number: '0001/2026', date: '2026-02-01', from: 'main', to: 's1', src: 'prn-1', lines: [{ item: 'A', qty: 2, nabU: 62, sp: 120 }] },
  { id: 'd9', type: 'mout', t: 'otp', number: 'ОТ-001/26', date: '2026-02-10', wh: 's1' },
  { id: 'd10', type: 'mout', t: 'sale', number: 'ПР-001/26', date: '2026-02-11', wh: 's1' },
  { id: 'd11', type: 'mout', t: 'ret', number: 'ПВ-001/26', date: '2026-02-12', wh: 's1', partner: 'P1' },
];
const EXTRA_MOVES = [
  { id: 'mo-d9-0-C-writeoff', date: '2026-02-10', item: 'C', qty: -1, value: -45, type: 'writeoff', src: 'mo-d9-0', wh: 's1', label: 'Отпис ОТ-001/26', lines: [] },
  { id: 'mo-d10-0-C-sale', date: '2026-02-11', item: 'C', qty: -2, value: -90, type: 'sale', src: 'mo-d10-0', wh: 's1', label: 'Продажба ПР-001/26', lines: [] },
  { id: 'mo-d11-0-C-return', date: '2026-02-12', item: 'C', qty: -1, value: -45, type: 'return', src: 'mo-d11-0', wh: 's1', label: 'Повратница', lines: [] },
  { id: 'pos-77-C-sale', date: '2026-02-05', item: 'C', qty: -3, value: -135, type: 'sale', src: 'pos-77', wh: 's1', label: 'Каса', lines: [] },
  { id: 'isp-x-0-A-dispatch', date: '2026-01-25', item: 'A', qty: -1, value: -62, type: 'dispatch', src: 'isp-x-0', wh: 'main', label: 'Испратница', lines: [] },
  { id: 'op-1-A-in', date: '2025-12-31', item: 'A', qty: 1, value: 55, type: 'in', src: 'op-1', wh: 's1', label: 'Почетна', lines: [] },
  { id: 'pur-1-0-B-s1', date: '2026-01-07', item: 'B', qty: 4, value: 140, type: 'in', src: 'pur-1', wh: 's1', label: 'Влез', lines: [] },
];
const SALES = [
  { id: 'z-s1-2026-02-05', date: '2026-02-05', wh: 's1', total: 150, fisk: { z: '12' } },
  { id: 'zf-s1-2026-02-20', date: '2026-02-20', wh: 's1', total: 500, fisk: { sc: 'trg', from: '2026-02-16', to: '2026-02-20', z: '13' }, days: [{ date: '2026-02-16', z: '13', total: 200 }, { date: '2026-02-18', z: '14', total: 300, est: true }] },
  { id: 'z-s2-2026-01-30', date: '2026-01-30', wh: 's2', total: 99, fisk: { sc: 'usl' } },
  { id: 'mo-d10', date: '2026-02-11', wh: 's1', total: 160, moNo: 'ПР-001/26' },
  { id: 'z-s1-2026-01-02', date: '2026-01-02', wh: 's1', total: 40 },
];
const MOVES_ALL = [...MOVES.map((m) => ({ label: m.type === 'in' ? 'Влез' : undefined, ...m })), ...EXTRA_MOVES];

const FX: LegacyFixture = {
  items: ITEMS,
  codes: CODES,
  moves: MOVES_ALL,
  docs: DOCS,
  sales: SALES,
  invoices: INVOICES,
  purchases: PURCHASES,
  partners: PARTNERS,
  firm: { ddv: true, sch: {} },
};

const RANGES: [string, string][] = [['2026-01-10', '2026-02-28'], ['2026-01-01', '2026-12-31'], ['2026-02-01', '2026-02-15']];
const docOfFor = (fx: LegacyFixture) => {
  const ctx = portCtx(fx);
  return legacyMoveDoc(ctx, { invoices: fx.invoices, purchases: fx.purchases, docs: fx.docs, partners: fx.partners, locationName: (id) => String(id || 'main') });
};

describe('лагер листа (lagerRows / LAGER)', () => {
  const views = Object.keys(LAGER) as LagerView[];
  for (const v of views)
    it(`${v}: rows and every column match legacy lagerData (intended stockAt)`, () => {
      for (const wh of ['', 'main', 's1', 's2', 'w2'])
        for (const date of ['2026-01-09', '2026-01-21', '2026-12-31'])
          for (const zero of [false, true]) {
            const L = loadLegacy(FX, 'intended');
            Object.assign(L.S, { lagWh: wh, lagDate: date, lagZero: zero, lagType: '', lagQ: '' });
            const want = L.fn.lagerData(v);
            const rows = lagerRows(portCtx(FX), { date, wh, zero });
            expect(rows.map((r) => r.item.id)).toEqual(want.rows.map((r: any) => r.it.id));
            rows.forEach((r, i) => {
              const s = want.rows[i].s;
              expect({ q: r.s.qty, v: r.s.value, iq: r.s.inQ, oq: r.s.outQ, iv: r.s.inV, ov: r.s.outV }).toEqual({ q: s.qty, v: s.value, iq: s.inQ, oq: s.outQ, iv: s.inV, ov: s.outV });
              LAGER[v].cols.forEach((c, ci) => {
                if (c.label === 'Набавна цена' && !(s.qty > 0)) return; // legacy old stockAt: avg 0; port: item cost (as stock())
                expect(c.value(r.item, r.s, wh || undefined)).toEqual(want.def.cols[ci][1](r.item, s));
              });
            });
          }
    });

  it('filters by type and search text like legacy', () => {
    const L = loadLegacy(FX, 'intended');
    Object.assign(L.S, { lagWh: '', lagDate: '2026-12-31', lagZero: true, lagType: 'goods', lagQ: 'со' });
    const want = L.fn.lagerData('g_lager');
    expect(lagerRows(portCtx(FX), { date: '2026-12-31', type: 'goods', q: 'со', zero: true }).map((r) => r.item.id)).toEqual(want.rows.map((r: any) => r.it.id));
  });

  it('DELIBERATE FIX: the shipped legacy list shows zero stock (swapped stockAt arguments); the port does not', () => {
    const L = loadLegacy(FX, 'shipped');
    Object.assign(L.S, { lagWh: '', lagDate: '2026-12-31', lagZero: true });
    expect(L.fn.lagerData('m_lager').rows.every((r: any) => r.s.qty === 0)).toBe(true);
    expect(lagerRows(portCtx(FX), { date: '2026-12-31' }).some((r) => r.s.qty > 0)).toBe(true);
  });

  it('pending moves are ignored; totals and summary are cent-exact', () => {
    const fx = { ...FX, moves: [...MOVES_ALL, PEND_MOVE] };
    const rows = lagerRows(portCtx(fx), { date: '2026-12-31' });
    expect(rows.find((r) => r.item.id === 'B')!.s.qty).toBe(20.417);
    const sum = lagerSummary(rows);
    expect(sum.fin.st).toBe(lagerColumnTotal(rows, LAGER.g_lager.cols[6]!));
    expect(sum.q.p).toBe(lagerColumnTotal(rows, LAGER.g_lager.cols[2]!));
    expect(sum.fin.i - sum.fin.o).toBeCloseTo(sum.fin.st, 2);
  });
});

describe('картица (itemCard)', () => {
  it('matches legacy kartData at cost and at retail, every item / location / range', () => {
    for (const retail of [false, true])
      for (const it of ITEMS.filter((i) => i.type !== 'service'))
        for (const wh of ['', 'main', 's1'])
          for (const [from, to] of RANGES) {
            const L = loadLegacy(FX);
            Object.assign(L.S, { kartItem: it.id, kartWh: wh, kartFrom: from, kartTo: to });
            const want = L.fn.kartData(retail);
            const got = itemCard(portCtx(FX), { item: it as any, wh, from, to, retail });
            const norm = (r: any) => (r.open ? { open: true, q: r.q, v: r.v } : { move: r.m?.id ?? r.move.id, in: r.in, out: r.out, price: r.price, vin: r.vin, vout: r.vout, q: r.q, v: r.v });
            expect(got.rows.map(norm)).toEqual(want.rows.map(norm));
          }
  });
});

const legacySaleValue = (m: StockMove): number | '' => {
  const x = String(m.src || '').match(/^inv-(.+)-(\d+)$/);
  if (!x) return '';
  const inv = INVOICES.find((i) => i.id === x[1]);
  const l: any = inv?.items?.[+x[2]!];
  return l ? Math.round((+l.qty || 0) * (+l.price || 0) * (1 - (+l.disc || 0) / 100) * 100) / 100 : '';
};

describe('ЕТ / ЕТМ (tradeBook)', () => {
  for (const retail of [false, true])
    it(`${retail ? 'ЕТМ (retail)' : 'ЕТ (wholesale)'} matches legacy trgData`, () => {
      for (const wh of retail ? ['', 's1', 's2'] : ['', 'main', 'w2'])
        for (const [from, to] of RANGES) {
          const L = loadLegacy(FX);
          Object.assign(L.S, { trgWhM: wh, trgWhG: wh, trgFrom: from, trgTo: to });
          const want = L.fn.trgData(retail);
          const got = tradeBook(portCtx(FX), { retail, wh, from, to, sales: SALES, saleValue: legacySaleValue, locationName: (id) => String(id || 'main') });
          expect(got.open).toBe(want.open);
          expect(got.rows).toEqual(want.rows);
        }
    });
});

describe('ЕТ образец за мало (etBook) and moveDoc', () => {
  it('legacyMoveDoc matches legacy moveDoc for every move', () => {
    const L = loadLegacy(FX);
    const docOf = docOfFor(FX);
    for (const m of MOVES_ALL) {
      const { p, pr, ...want } = L.fn.moveDoc(m);
      const { inTotals, ...got } = docOf(m as any);
      expect(got).toEqual({ ...want, ...(want.mo ? { mo: true } : {}) });
      expect(!!inTotals).toBe(!!(p || pr));
    }
  });

  it('transferBookTotals matches legacy prTotals (calcRows of prPseudo)', () => {
    const L = loadLegacy(FX);
    const d: any = DOCS.find((x) => x.type === 'prenos');
    const R = L.fn.calcRows(L.fn.prPseudo(d));
    const sum = (k: string) => Math.round(R.reduce((a: number, r: any) => a + r[k], 0) * 100) / 100;
    expect(transferBookTotals(portCtx(FX), d)).toEqual({ nab: sum('nabV'), sp: sum('spV'), marg: sum('marg') });
  });

  it('matches legacy etData per store and for all stores', () => {
    for (const fiskSc of ['', 'usl'])
      for (const wh of ['', 's1', 's2'])
        for (const [from, to] of RANGES) {
          const fx = { ...FX, firm: { ddv: true, sch: {}, fiskOpt: { sc: fiskSc } } };
          const L = loadLegacy(fx);
          Object.assign(L.S, { trgWhM: wh, trgFrom: from, trgTo: to });
          const want = L.fn.etData();
          const got = etBook(portCtx(fx), { wh, from, to, sales: SALES, docOf: docOfFor(fx), firmFiskScheme: fiskSc, locationName: (id) => String(id || 'main') });
          expect(got.open).toBe(want.open);
          expect(got.rows).toEqual(want.rows);
        }
  });

  it('non-VAT firm: input VAT is part of the purchase value (col. 5)', () => {
    const fx = { ...FX, firm: { ddv: false, sch: {} } };
    const L = loadLegacy(fx);
    Object.assign(L.S, { trgWhM: 's1', trgFrom: '2026-01-01', trgTo: '2026-12-31' });
    const got = etBook(portCtx(fx), { wh: 's1', from: '2026-01-01', to: '2026-12-31', sales: SALES, docOf: docOfFor(fx) });
    expect(got.rows).toEqual(L.fn.etData().rows);
  });

  it('a store-less firm books every location', () => {
    const fx = { ...FX, codes: [] };
    const L = loadLegacy(fx);
    Object.assign(L.S, { trgWhM: '', trgFrom: '2026-01-01', trgTo: '2026-12-31' });
    const got = etBook(portCtx(fx), { from: '2026-01-01', to: '2026-12-31', sales: SALES, docOf: docOfFor(fx) });
    expect(got.rows).toEqual(L.fn.etData().rows);
    expect(got.totals.close).toBeCloseTo(got.rows[got.rows.length - 1]!.bal, 2);
  });
});

describe('МЕТГ (metgCard)', () => {
  it('matches legacy metgData', () => {
    const L = loadLegacy(FX);
    const docOf = docOfFor(FX);
    for (const it of ['A', 'B', 'C', 'M'])
      for (const wh of ['', 'main', 'w2'])
        for (const [from, to] of RANGES) {
          const want = L.fn.metgData(it, wh, from, to);
          const got = metgCard(portCtx(FX), { item: it, wh, from, to, docOf });
          expect(got.open).toBe(want.open);
          expect(got.rows).toEqual(want.rows);
        }
  });
});

/* ------------------------------------------------------------------ production */

const PROD_ITEMS = [
  ...ITEMS,
  { id: 'P2', name: 'Погача', code: '201', unit: 'ком', type: 'product', price: 60, rate: 5, labor: 3.5, bom: [{ item: 'M', qty: 0.5 }, { item: 'R', qty: 1 }] },
  { id: 'P3', name: 'Сендвич', code: '202', unit: 'ком', type: 'product', price: 120, rate: 5, labor: 1, bom: [{ item: 'P2', qty: 2 }, { item: 'A', qty: 0.1 }, { item: 'X', qty: 1 }] },
  { id: 'PX', name: 'Циклус 1', type: 'product', cost: 7, bom: [{ item: 'PY', qty: 1 }] },
  { id: 'PY', name: 'Циклус 2', type: 'product', labor: 2, bom: [{ item: 'PX', qty: 2 }] },
];
const PFX: LegacyFixture = { items: PROD_ITEMS, codes: CODES, moves: MOVES, firm: { ddv: true, sch: {} } };

describe('production (unitCost / runProduction)', () => {
  it('unitCost matches legacy for acyclic items', () => {
    const L = loadLegacy(PFX);
    const ctx = portCtx(PFX);
    for (const it of PROD_ITEMS.filter((i) => !['PX', 'PY'].includes(i.id))) expect(unitCost(ctx, it as any)).toBe(L.fn.unitCost(it));
  });

  it('DELIBERATE FIX: a cyclic BOM overflows legacy unitCost; the port stops at the cycle', () => {
    const L = loadLegacy(PFX);
    expect(() => L.fn.unitCost(PROD_ITEMS.find((i) => i.id === 'PX'))).toThrow(RangeError);
    const ctx = portCtx(PFX);
    // PX → PY (2 × PX at its stock cost 7 + labour 2 = 16) → PX = 1 × 16
    expect(unitCost(ctx, PROD_ITEMS.find((i) => i.id === 'PX') as any)).toBe(16);
    expect(bomCycle(ctx, 'PX')).toEqual(['PX', 'PY', 'PX']);
    expect(bomCycle(ctx, 'P3')).toBeNull();
    expect(bomCycle(ctx, 'P2', [{ item: 'P3', qty: 1 }])).toEqual(['P2', 'P3', 'P2']);
  });

  it('runProduction matches legacy runProd (moves, lines, production record)', async () => {
    for (const [prod, qty, wh] of [['P2', 4, 'main'], ['P2', 2.5, undefined], ['P3', 3, 'main']] as const) {
      const L = loadLegacy(PFX);
      L.S.draft = { kind: 'prod', product: prod, qty, date: '2026-03-01', wh };
      await L.fn.runProd();
      const ctx = portCtx(PFX);
      const r = runProduction(ctx, { id: 'prod-u1', product: PROD_ITEMS.find((i) => i.id === prod) as any, qty, date: '2026-03-01', wh });
      const wantMoves = L.saved.filter(([c]) => c === 'moves').map(([, m]) => ({ ...m, lines: toPortLines(m.lines) }));
      expect(r.moves).toEqual(wantMoves);
      expect(r.record).toEqual(L.saved.find(([c]) => c === 'production')![1]);
    }
  });

  it('productionNeeds flags shortages and costs the order', () => {
    const ctx = portCtx(PFX);
    const n = productionNeeds(ctx, PROD_ITEMS.find((i) => i.id === 'P2') as any, 200, 'main');
    expect(n.lines.map((l) => [l.item.id, l.need, l.short])).toEqual([['M', 100, true], ['R', 200, true]]);
    expect(n.lab).toBe(700);
  });

  it('runProduction uses the scheme accounts (DELIBERATE FIX: no hard-coded 6000/4900/6300)', () => {
    const ctx = { ...portCtx(PFX), scheme: { prodWip: '6010', prodLabour: '4901', product: '6310' } };
    const r = runProduction(ctx, { id: 'prod-1', product: PROD_ITEMS.find((i) => i.id === 'P2') as any, qty: 1, date: '2026-03-01' });
    expect(r.moves[0]!.lines!.map((l) => l.account)).toEqual(['6010', '3100']);
    expect(r.moves.at(-1)!.lines!.map((l) => l.account)).toEqual(['6010', '4901', '6310', '6010']);
  });
});

describe('dailySalesTotals (POS / парагон)', () => {
  it('groups by rate and revenue account, splits VAT out of gross, tracks Macedonian products', () => {
    const items = [{ id: 'A', type: 'goods', mk: true }, { id: 'S', type: 'service', konto: '7401' }];
    const rev = (it: any) => it?.konto || (it?.type === 'goods' ? '7411' : '7400');
    const t = dailySalesTotals({ items: items as any }, [
      { item: 'A', qty: 2, price: 59, rate: 18 },
      { item: 'A', qty: 1, price: 10.5, rate: 5 },
      { item: 'S', qty: 1, price: 118, rate: 18 },
      { item: 'A', qty: 1, price: 0.99, rate: 18 },
    ], rev);
    expect(t.total).toBe(247.49);
    expect(t.groups).toEqual([
      { rate: 18, konto: '7411', base: 100.84, vat: 18.15 },
      { rate: 5, konto: '7411', base: 10, vat: 0.5 },
      { rate: 18, konto: '7401', base: 100, vat: 18 },
    ]);
    expect(t.mk).toEqual({ 18: { g: 118.99, v: 18.15 }, 5: { g: 10.5, v: 0.5 } });
  });
});
