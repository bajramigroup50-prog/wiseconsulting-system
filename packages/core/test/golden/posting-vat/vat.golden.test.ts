/**
 * Golden tests: new `vat.ts` vs legacy `ddvFor` (with the travel-margin patch), `ddv04`, `dkOut`, `dkIn`
 * over one full VAT quarter (Q1 2026) and one month.
 */
import { describe, expect, it } from 'vitest';
import {
  blgCalc, calcLines, ddv04, ddvFor, scrCalc, travelMarginFor, vatBookIn, vatBookOut, vatBookSum,
  type TravelArrangementTotals, type VatDocuments,
} from '../../../src/vat';
import { ctxOf, invOf, legacyState, PARTNERS, purOf } from './fixtures';
import { loadLegacy, plain } from './legacy';

const legacy = loadLegacy();
const TA_OWN = 'Сопствена услуга на агенцијата (не е претходна)';

const ADV = { id: 'ADV', number: '1/2026', date: '2026-01-05', partner: 'P1', advance: true, items: [{ qty: 1, price: 10000, rate: 18, konto: '7400' }] };
const INVOICES = [
  ADV,
  { id: 'I1', number: '2/2026', date: '2026-01-10', partner: 'P1', items: [{ qty: 3, price: 1250.5, disc: 10, rate: 18, konto: '7400' }, { qty: 7, price: 12.49, disc: 3, rate: 5, konto: '7410' }, { qty: 4, price: 33.33, rate: 10, konto: '7410' }] },
  { id: 'I2', number: '3/2026', date: '2026-02-11', partner: 'P1', credit: true, refInv: 'I1', items: [{ qty: 1, price: 1250.5, rate: 18, konto: '7400' }] },
  { id: 'I3', number: '4/2026', date: '2026-02-20', partner: 'P1', advances: { ADV: 6000 }, items: [{ qty: 1, price: 25000, rate: 18, konto: '7400' }] },
  { id: 'I4', number: '5/2026', date: '2026-03-01', partner: 'P4', export: true, items: [{ qty: 5, price: 6150, rate: 0, konto: '7460' }] },
  { id: 'I5', number: '6/2026', date: '2026-03-02', partner: 'P1', items: [{ qty: 1, price: 700, rate: 0, konto: '7400' }] },
  { id: 'I6', number: '7/2026', date: '2026-03-03', partner: 'P1', items: [{ qty: 1, price: 900, rate: 18, konto: '7400' }, { qty: 1, price: 5000, rate: 0, konto: '2290' }] },
  { id: 'I7', number: '8/2026', date: '2026-03-04', partner: 'P1', art32: true, items: [{ qty: 10, price: 4500, rate: 18, konto: '7400' }] },
  { id: 'I8', number: '9/2026', date: '2026-03-05', partner: 'P1', pend: true, items: [{ qty: 1, price: 99999, rate: 18, konto: '7400' }] },
  { id: 'I9', number: '10/2026', date: '2026-04-01', partner: 'P1', items: [{ qty: 1, price: 88888, rate: 18, konto: '7400' }] },
  // travel margin scheme (чл. 38)
  { id: 'T1', number: '11/2026', date: '2026-02-01', partner: 'P1', tourM: true, tbookId: 'B1', items: [{ qty: 1, price: 60000, rate: 0, konto: '7400' }] },
  { id: 'T2', number: '12/2026', date: '2026-03-10', partner: 'P1', tourM: true, credit: true, refInv: 'T1', items: [{ qty: 1, price: 5000, rate: 0, konto: '7400' }] },
  { id: 'T3', number: '13/2026', date: '2026-03-12', partner: 'P1', tourM: true, tbookId: 'B2', items: [{ qty: 1, price: 20000, rate: 0, konto: '7400' }] },
];
const SALES = [
  { id: 'z-2026-01-31', date: '2026-01-31', total: 12485, groups: [{ rate: 18, konto: '7411', base: 10000, vat: 1800 }, { rate: 5, konto: '7411', base: 461.9, vat: 23.1 }, { rate: 0, konto: '7411', base: 200, vat: 0 }] },
  { id: 'z-2026-02-01', date: '2026-02-01', pend: true, total: 118, groups: [{ rate: 18, base: 100, vat: 18 }] },
];
const PURCHASES = [
  { id: 'U1', date: '2026-01-15', number: 'Ф-1', partner: 'P2', groups: [{ konto: '4190', rate: 18, base: 1234.56, vat: 222.22 }, { konto: '4010', rate: 10, base: 500, vat: 50 }, { konto: '4010', rate: 5, base: 99.5, vat: 4.98 }] },
  { id: 'U2', date: '2026-02-03', number: 'INV-77', partner: 'P4', imp: true, supKonto: '2210', fx: 61.5, groups: [{ konto: '6600', rate: 0, base: 61500, vat: 0 }],
    costs: { car: { amt: 3075, partner: 'P3', lines: [{ base: 64575, rate: 18, vat: 11623.5 }] }, sped: { amt: 2500, partner: 'P3', lines: [{ base: 2500, rate: 18, vat: 450 }] } } },
  { id: 'U3', date: '2026-02-04', number: 'Ф-32', partner: 'P2', art32: true, groups: [{ konto: '4190', rate: 18, base: 50000, vat: 0 }] },
  { id: 'U4', date: '2026-03-04', number: '000123', partner: 'P2', cash: true, groups: [{ konto: '4011', rate: 18, base: 847.46, vat: 152.54 }, { konto: '4011', rate: 0, base: 100, vat: 0 }] },
  { id: 'U5', date: '2026-02-02', number: 'Х-1', partner: 'P2', noDed: true, tarr: 'A1', groups: [{ konto: '4190', rate: 18, base: 20000, vat: 3600 }] },
  { id: 'U6', date: '2026-02-05', number: 'Х-2', partner: 'P2', noDed: true, tarr: 'A2', groups: [{ konto: '4190', rate: 18, base: 25000, vat: 4500 }] },
  { id: 'U7', date: '2026-03-06', number: 'Ф-99', partner: 'P2', pend: true, groups: [{ konto: '4190', rate: 18, base: 9999, vat: 1799.82 }] },
];
const DOCS = [
  { id: 'B-1', type: 'blg', kind: 'out', reg: '1020', date: '2026-01-20', cur: 'MKD', amt: 3540, rate: 18, cat: 'fuel', merchant: 'Макпетрол', country: 'MK', docNo: 'ФС-1' },
  { id: 'B-2', type: 'blg', kind: 'out', reg: '1051', date: '2026-02-20', cur: 'EUR', fx: 61.53, amt: 120.5, rate: 18, cat: 'accommodation', merchant: 'Hotel', country: 'GR' },
  { id: 'B-3', type: 'blg', kind: 'out', reg: '1020', date: '2026-03-21', cur: 'MKD', amt: 1100, rate: 10, vat: 100, merchant: 'Ресторан' },
  { id: 'C-1', type: 'supcr', kind: 'ret', date: '2026-03-05', number: 'П-1', partner: 'P2', rows: [{ item: 'I1', qty: 3, price: 100.4, rate: 18 }, { item: 'I3', qty: 2, price: 80.6, rate: 5 }] },
  { id: 'C-2', type: 'supcr', kind: 'disc', date: '2026-03-06', number: 'П-2', supNo: 'ОД-7', partner: 'P2', rows: [{ qty: 1, price: 1500, rate: 18 }] },
  { id: 'A1', type: 'tarr', kind: 'own', price: 30000, costs: [{ cat: TA_OWN, amt: 2000 }] },
  { id: 'A2', type: 'tarr', kind: 'own', price: 20000, costs: [] },
  { id: 'B1', type: 'tbook', arr: 'A1', adults: 2 },
  { id: 'B2', type: 'tbook', arr: 'A2', adults: 1 },
];
const DATA = { invoices: INVOICES, sales: SALES, purchases: PURCHASES, docs: DOCS };

/** Legacy data → new `VatDocuments` + arrangement totals (taCalc from legacy, as the travel module will supply). */
function mine(st: ReturnType<typeof legacyState>) {
  const arrangements = legacy.run(st, (L) => {
    const o: Record<string, TravelArrangementTotals> = {};
    for (const a of DOCS.filter((d) => d.type === 'tarr')) {
      const c = L.taCalc!(a);
      o[a.id] = { rev: c.rev, cost: c.cost, own: c.own };
    }
    return o;
  });
  const arrOf = (inv: any): string | undefined => {
    const tb = inv.tbookId ?? INVOICES.find((i: any) => i.id === inv.refInv)?.tbookId;
    return (DOCS.find((d) => d.id === tb) as any)?.arr;
  };
  const docs: VatDocuments = {
    invoices: INVOICES.map((i: any) => ({ ...invOf(i, INVOICES), ...(i.tourM ? { arrangementId: arrOf(i) } : {}) })),
    sales: SALES,
    purchases: PURCHASES.map((p) => purOf(p)),
    cashVouchers: DOCS.filter((d) => d.type === 'blg') as any,
    supplierCredits: DOCS.filter((d) => d.type === 'supcr') as any,
  };
  return { docs, arrangements };
}

const PARTNER_MAP = Object.fromEntries(PARTNERS.map((p) => [p.id, { name: p.name, edb: p.edb }]));
const PICK = ['out', 'in', 'outBase0', 'exportBase', 'art32Out', 'art32InBase', 'art32InVat', 'impB', 'impV'] as const;
const pick = (R: any) => plain(Object.fromEntries(PICK.map((k) => [k, R[k] ?? 0])));

/**
 * ДДВ-04 comparison. FIX (documented in `ddv04FromResult`): legacy computes the totals 20, 29 and 31
 * from *unrounded* amounts and rounds afterwards, so its printed 20/29 can differ by a denar or two
 * from the sum of its printed fields. Amount fields must be identical; totals must be exact sums of
 * the printed fields and stay within the rounding distance of legacy.
 */
function expectDdv04(F: Record<string, number>, LF: Record<string, number>) {
  const TOT = new Set(['20', '29', '31']);
  for (const k of Object.keys(LF)) if (!TOT.has(k)) expect([k, F[k]]).toEqual([k, LF[k]]);
  const s = (ks: string[]) => ks.reduce((a, k) => a + F[k]!, 0);
  expect(F['20']).toBe(s(['02', '04', '06', '13', '15', '17', '19']));
  expect(F['29']).toBe(s(['22', '24', '26', '28']));
  expect(F['31']).toBe(F['20']! - F['29']! - F['30']!);
  expect(Math.abs(F['20']! - LF['20']!)).toBeLessThanOrEqual(3);
  expect(Math.abs(F['29']! - LF['29']!)).toBeLessThanOrEqual(3);
  expect(Math.abs(F['31']! - LF['31']!)).toBeLessThanOrEqual(6);
}

describe('ДДВ-04 for a full quarter (2026-Т1)', () => {
  for (const agg of ['period', 'arr'] as const) {
    describe(`travel margin basis: ${agg}`, () => {
      const st = legacyState({ firm: { tour: { agg } }, data: DATA });
      const { docs, arrangements } = mine(st);
      const ctx = ctxOf(st);
      const L = legacy.run(st, (F) => ({ R: F.ddvFor!('2026-Т1', 'quarter'), F: F.ddv04!('2026-Т1', 'quarter') }));
      const R = ddvFor(docs, '2026-Т1', 'quarter', ctx, { travel: { arrangements, agg } });

      it('ddvFor totals equal legacy (incl. travel margin in 18%)', () => {
        expect(pick(R)).toEqual(pick(L.R));
        expect(Object.keys(R.out).length).toBeGreaterThan(0);
        expect(R.out[18]!.v).toBeGreaterThan(0);
      });
      it('travel margin equals legacy tuMarginFor', () => {
        const T = L.R.tourM;
        expect(plain({ m: R.tourM!.m, mt: R.tourM!.mt, base: R.tourM!.base, vat: R.tourM!.vat, own: R.tourM!.own, ownBase: R.tourM!.ownBase, ownVat: R.tourM!.ownVat }))
          .toEqual(plain({ m: T.m, mt: T.mt, base: T.base, vat: T.vat, own: T.own, ownBase: T.ownBase, ownVat: T.ownVat }));
        expect(R.tourM!.L.map((x) => x.mg)).toEqual(T.L.map((x: any) => x.mg));
      });
      it('FIX: outV / net include the travel margin (legacy computed them before adding it)', () => {
        const mv = R.tourM!.vat + R.tourM!.ownVat;
        expect(mv).toBeGreaterThan(0);
        expect(R.outV).toBeCloseTo(L.R.outV + mv, 2);
        expect(R.net).toBeCloseTo(L.R.net + mv, 2);
        expect(R.inV).toBeCloseTo(L.R.inV, 2);
      });
      it('ДДВ-04 amount fields equal legacy; totals 20/29/31 are sums of the printed fields', () => {
        const F = ddv04(docs, '2026-Т1', 'quarter', ctx, { travel: { arrangements, agg } });
        expectDdv04(F, L.F);
        expect(F['01']).toBeGreaterThan(0);
      });
      it('FIX: legacy totals 20/29 do not add up from its own printed fields', () => {
        const LF = L.F as Record<string, number>;
        const s = (ks: string[]) => ks.reduce((a, k) => a + LF[k]!, 0);
        // Legacy rounds 20 = round(Σ unrounded 02,04,…) — the printed form does not add up.
        expect(LF['20'] !== s(['02', '04', '06', '13', '15', '17', '19']) || LF['29'] !== s(['22', '24', '26', '28'])).toBe(true);
      });
    });
  }

  it('month period (2026-02)', () => {
    const st = legacyState({ firm: { per: 'month' }, data: DATA });
    const { docs, arrangements } = mine(st);
    const L = legacy.run(st, (F) => ({ R: F.ddvFor!('2026-02', 'month'), F: F.ddv04!('2026-02', 'month') }));
    const R = ddvFor(docs, '2026-02', 'month', ctxOf(st), { travel: { arrangements } });
    expect(pick(R)).toEqual(pick(L.R));
    expectDdv04(ddv04(docs, '2026-02', 'month', ctxOf(st), { travel: { arrangements } }), L.F);
  });

  it('non-VAT firm: no travel margin, no input VAT from cash/credits', () => {
    const st = legacyState({ firm: { ddv: false }, data: DATA });
    const { docs, arrangements } = mine(st);
    const L = legacy.run(st, (F) => F.ddvFor!('2026-Т1', 'quarter'));
    const R = ddvFor(docs, '2026-Т1', 'quarter', ctxOf(st), { travel: { arrangements } });
    expect(pick(R)).toEqual(pick(L));
    expect(R.tourM).toBeUndefined();
  });

  it('FIX: pending cash vouchers and supplier credits are not counted', () => {
    const pendDocs = [
      { id: 'BP', type: 'blg', kind: 'out', reg: '1020', date: '2026-01-21', cur: 'MKD', amt: 1180, rate: 18, merchant: 'X', pend: true },
      { id: 'CP', type: 'supcr', kind: 'disc', date: '2026-01-22', partner: 'P2', pend: true, rows: [{ qty: 1, price: 1000, rate: 18 }] },
    ];
    const st = legacyState({ data: { docs: pendDocs } });
    const L = legacy.run(st, (F) => F.ddvFor!('2026-Т1', 'quarter'));
    expect(L.in[18]).toEqual({ b: 0, v: 0 }); // legacy: +1000/+180 from the voucher, −1000/−180 from the credit
    const R = ddvFor({ cashVouchers: [pendDocs[0] as any], supplierCredits: [pendDocs[1] as any] }, '2026-Т1', 'quarter', ctxOf(st));
    expect(R.in).toEqual({});
    const L2 = legacy.run(legacyState({ data: { docs: [pendDocs[0]!] } }), (F) => F.ddvFor!('2026-Т1', 'quarter'));
    expect(L2.in[18]).toEqual({ b: 1000, v: 180 });
  });

  it('NEW: zeroKind / nonResident / reduced-rate art. 32-a fill fields legacy left empty', () => {
    const st = legacyState();
    const docs: VatDocuments = {
      invoices: [
        { date: '2026-01-10', zeroKind: 'exemptNoDed', items: [{ qty: 1, price: 100, rate: 0, konto: '7400' }] },
        { date: '2026-01-10', zeroKind: 'nonResident', items: [{ qty: 1, price: 200, rate: 0, konto: '7400' }] },
      ],
      purchases: [
        { date: '2026-01-11', art32: true, nonResident: true, groups: [{ konto: '4190', rate: 18, base: 1000, vat: 0 }] },
        { date: '2026-01-12', art32: true, groups: [{ konto: '4190', rate: 5, base: 1000, vat: 0 }] },
      ],
    };
    const F = ddv04(docs, '2026-Т1', 'quarter', ctxOf(st));
    expect([F['09'], F['10'], F['12'], F['13'], F['18'], F['19'], F['23'], F['24'], F['25'], F['26']]).toEqual([100, 200, 1000, 180, 1000, 50, 1000, 180, 1000, 50]);
    expect(F['31']).toBe(0);
  });
});

describe('VAT books for the quarter', () => {
  const st = legacyState({ data: DATA });
  const { docs, arrangements } = mine(st);
  const ctx = ctxOf(st);
  const L = legacy.run(st, (F) => ({ out: F.dkOut!('2026-01-01', '2026-03-31'), in: F.dkIn!('2026-01-01', '2026-03-31') }));
  const tourNos = new Set(INVOICES.filter((i: any) => i.tourM).map((i) => i.number));
  const noDedNos = new Set(PURCHASES.filter((p: any) => p.noDed).map((p) => p.number));

  it('output book (КИФ) equals legacy apart from travel-margin invoices', () => {
    const R = vatBookOut(docs, '2026-01-01', '2026-03-31', ctx, { partners: PARTNER_MAP, travel: { arrangements } });
    expect(plain(R.filter((r) => !tourNos.has(r.no)))).toEqual(plain(L.out.filter((r: any) => !tourNos.has(r.no))));
    expect(R.length).toBeGreaterThan(5);
    expect(vatBookSum(R, 'out').tot).toBeGreaterThan(0);
  });
  it('FIX: travel-margin invoices are booked with margin base/VAT (legacy: full amount as 0%)', () => {
    const R = vatBookOut(docs, '2026-01-01', '2026-03-31', ctx, { partners: PARTNER_MAP, travel: { arrangements } });
    const leg = L.out.filter((r: any) => tourNos.has(r.no));
    expect(leg.every((r: any) => r.v18 === 0 && r.b0 !== 0)).toBe(true);
    const T = travelMarginFor(docs.invoices!, '2026-Т1', 'quarter', ctx, { arrangements });
    const t = R.filter((r) => tourNos.has(r.no));
    expect(t.every((r) => r.b0 === 0)).toBe(true);
    // agg 'period' with no negative total: book VAT = ДДВ-04 margin VAT up to per-invoice rounding.
    expect(Math.abs(t.reduce((s, r) => s + r.v18, 0) - (T.vat + T.ownVat))).toBeLessThanOrEqual(0.03);
  });
  it('input book (КПФ) equals legacy apart from noDed purchases', () => {
    const R = vatBookIn(docs, '2026-01-01', '2026-03-31', ctx, { partners: PARTNER_MAP });
    expect(plain(R.filter((r) => !noDedNos.has(r.no)))).toEqual(plain(L.in.filter((r: any) => !noDedNos.has(r.no))));
    const legSum = legacy.run(st, (F) => F.dkSum!(L.in.filter((r: any) => !noDedNos.has(r.no)), 'in'));
    expect(vatBookSum(R.filter((r) => !noDedNos.has(r.no)), 'in')).toEqual(plain(legSum));
  });
  it('FIX: noDed purchases go to "no right of deduction" (legacy listed their VAT as deductible)', () => {
    const R = vatBookIn(docs, '2026-01-01', '2026-03-31', ctx, { partners: PARTNER_MAP });
    const leg = L.in.find((r: any) => r.no === 'Х-1');
    expect(leg.v18).toBe(3600);
    expect(R.find((r) => r.no === 'Х-1')).toMatchObject({ b18: 0, v18: 0, nd: 23600, tot: 23600 });
  });
  it('book totals reconcile with ДДВ-04 input VAT (field 22) for the quarter', () => {
    const R = vatBookIn(docs, '2026-01-01', '2026-03-31', ctx, { partners: PARTNER_MAP });
    const S = vatBookSum(R, 'in');
    const D = ddvFor(docs, '2026-Т1', 'quarter', ctx, { travel: { arrangements } });
    expect(S.v18! + S.v10! + S.v5!).toBeCloseTo(Object.values(D.in).reduce((s, x) => s + x.v, 0), 2);
  });
});

describe('document calculations equal legacy', () => {
  const st = legacyState({ data: DATA });
  it('calcLines', () => {
    for (const inv of INVOICES) {
      const leg = legacy.run(st, (F) => F.calcLines!(inv.items, (inv as any).art32));
      expect(plain(calcLines(inv.items, (inv as any).art32))).toEqual(plain(leg));
    }
  });
  it('blgCalc / scrCalc', () => {
    for (const d of DOCS) {
      if (d.type === 'blg') expect(blgCalc(d as any, ctxOf(st))).toEqual(legacy.run(st, (F) => F.blgCalc!(d)));
      if (d.type === 'supcr') {
        const leg = legacy.run(st, (F) => F.scrCalc!(d));
        const mineC = scrCalc(d as any, ctxOf(st));
        expect(plain({ ...mineC, by: mineC.by.map((g) => ({ ...g, konto: g.konto })) })).toEqual(plain(leg));
      }
    }
  });
});
