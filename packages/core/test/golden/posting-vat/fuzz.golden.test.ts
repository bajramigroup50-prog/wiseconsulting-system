/**
 * Randomised golden comparison (deterministic seed): many generated invoices, purchases, cash sales
 * and supplier credits posted by legacy and by the new code must be identical and balanced.
 */
import { describe, expect, it } from 'vitest';
import { r2 } from '../../../src/money';
import { invoiceEntries, isBalanced, purchaseEntries, saleEntries, scrEntries, type JournalLine } from '../../../src/posting';
import { ddvFor } from '../../../src/vat';
import { ctxOf, legacyState, purOf } from './fixtures';
import { loadLegacy, normLegacy, plain } from './legacy';

const legacy = loadLegacy();

/** mulberry32 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = Number(process.env.FUZZ_SEED) || 20261008;
const R = rng(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
const money = (max: number, dec = 2) => Math.round(R() * max * 10 ** dec) / 10 ** dec;

const KONTA = ['7400', '7410', '7411', '7460', '7499'];
const genInvoice = (i: number) => ({
  id: 'G' + i, date: '2026-0' + (1 + (i % 3)) + '-1' + (i % 10), partner: 'P1',
  credit: R() < 0.15, art32: R() < 0.1, export: R() < 0.1,
  items: Array.from({ length: 1 + Math.floor(R() * 5) }, () => ({
    qty: pick([1, 2, 3, 0.5, 1.25, 7, 12, 0.333]), price: money(5000, pick([0, 2, 2, 4])), disc: pick([0, 0, 0, 5, 7.5, 10, 33]),
    rate: pick([18, 18, 10, 5, 0]), konto: pick(KONTA),
  })),
});
const genPurchase = (i: number) => {
  const imp = R() < 0.15;
  const groups = Array.from({ length: 1 + Math.floor(R() * 3) }, () => {
    const rate = imp ? 0 : pick([18, 18, 10, 5, 0]);
    const base = money(20000);
    return { konto: pick(['4000', '4190', '6600', '3100', '4011']), rate, base, vat: Math.round(base * rate) / 100 + pick([0, 0, 0.01, -0.01]) };
  });
  const costs = R() < 0.3 ? {
    car: { amt: money(3000), partner: 'P3', lines: [{ base: money(30000), rate: 18, vat: money(5000) }] },
    trans: { amt: money(2000), partner: 'P3', lines: [{ base: money(2000), rate: pick([18, 5]), vat: money(300) }] },
  } : undefined;
  const stock = R() < 0.4 ? Array.from({ length: 1 + Math.floor(R() * 3) }, () => ({ item: pick(['I1', 'I2', 'I3']), qty: pick([1, 5, 10, 2.5]), price: money(500), rab: pick([0, 0, 5]) })) : undefined;
  return {
    id: 'U' + i, date: '2026-0' + (1 + (i % 3)) + '-0' + (1 + (i % 9)), number: 'Ф-' + i, partner: 'P2',
    imp, ...(imp ? { supKonto: '2210', fx: 61.5 } : {}), art32: !imp && R() < 0.1, cash: !imp && R() < 0.1,
    groups, ...(costs ? { costs } : {}), ...(stock ? { stock } : {}),
  };
};
const genSale = (i: number) => {
  const groups = [18, 10, 5, 0].filter(() => R() < 0.6).map((rate) => {
    const base = money(30000);
    return { rate, konto: '7411', base, vat: Math.round(base * rate) / 100 };
  });
  return { id: 'Z' + i, date: '2026-01-' + String(1 + (i % 28)).padStart(2, '0'), total: Math.round(groups.reduce((s, g) => s + g.base + g.vat, 0) * 100) / 100, groups };
};
const genScr = (i: number) => ({
  id: 'C' + i, type: 'supcr', kind: pick(['ret', 'disc'] as const), date: '2026-02-' + String(1 + (i % 28)).padStart(2, '0'), partner: 'P2',
  rows: Array.from({ length: 1 + Math.floor(R() * 3) }, () => ({ qty: pick([1, 2, 3.5]), price: money(1000), rate: pick([18, 10, 5, 0]), konto: pick([undefined, '4190']) })),
});

const N = 150;
const invoices = Array.from({ length: N }, (_, i) => genInvoice(i));
const purchases = Array.from({ length: N }, (_, i) => genPurchase(i));
const sales = Array.from({ length: 60 }, (_, i) => genSale(i));
const credits = Array.from({ length: 60 }, (_, i) => genScr(i));

/**
 * Intended difference: a VAT amount that is an exact half cent (e.g. 2561.50 × 5% = 128.075) is
 * rounded half up exactly (128.08). Legacy `r2` works on binary floats, where 128.075 is stored as
 * 128.07499999…, and so sometimes rounds such ties down (128.07). Invoices with such a tie may differ
 * by one cent per tied line; everything else must be identical.
 */
const lineBaseC = (it: { qty: unknown; price: unknown; disc?: unknown }) => Math.round(r2(+(it.qty as number) * +(it.price as number) * (1 - (+(it.disc as number) || 0) / 100)) * 100);
const invTies = (inv: ReturnType<typeof genInvoice>) =>
  inv.art32 ? 0 : inv.items.filter((it) => (lineBaseC(it) * it.rate) % 100 === 50).length;

function sameUpToTies(mine: JournalLine[], leg: JournalLine[], ties: number) {
  if (!ties) return expect(plain(mine)).toEqual(plain(leg));
  expect(mine.map((l) => [l.account, l.partnerId, l.note])).toEqual(leg.map((l) => [l.account, l.partnerId, l.note]));
  mine.forEach((l, i) => {
    expect(Math.abs(l.debit - leg[i]!.debit)).toBeLessThanOrEqual(0.01 * ties + 1e-9);
    expect(Math.abs(l.credit - leg[i]!.credit)).toBeLessThanOrEqual(0.01 * ties + 1e-9);
  });
}

describe(`random documents (seed ${SEED})`, () => {
  const st = legacyState();
  const ctx = ctxOf(st);

  it(`${N} invoices`, () => {
    let tied = 0;
    for (const inv of invoices) {
      const mine = invoiceEntries(inv, ctx);
      const ties = invTies(inv);
      if (ties) tied++;
      sameUpToTies(mine, legacy.run(st, (L) => normLegacy(L.invoiceEntries!(inv))), ties);
      expect(isBalanced(mine)).toBe(true);
    }
    expect(tied).toBeLessThan(N / 5);
  });
  it(`${N} purchases`, () => {
    for (const p of purchases) {
      const mine = purchaseEntries(purOf(p), ctx);
      expect(plain(mine)).toEqual(plain(legacy.run(st, (L) => normLegacy(L.purchaseEntries!(p, true)))));
      expect(isBalanced(mine)).toBe(true);
    }
  });
  it('60 cash sale days', () => {
    for (const s of sales) {
      const mine = saleEntries(s, ctx);
      expect(plain(mine)).toEqual(plain(legacy.run(st, (L) => normLegacy(L.saleEntries!(s)))));
      expect(isBalanced(mine)).toBe(true);
    }
  });
  it('60 supplier credits', () => {
    for (const d of credits) {
      const mine = scrEntries(d, ctx);
      expect(plain(mine)).toEqual(plain(legacy.run(st, (L) => normLegacy(L.scrEntries!(d)))));
      expect(isBalanced(mine)).toBe(true);
    }
  });
  it('ddvFor over all random documents, every quarter month', () => {
    const data = { invoices, purchases, sales, docs: credits };
    for (const per of ['2026-01', '2026-02', '2026-03'] as const) {
      const leg = legacy.run(legacyState({ data }), (L) => L.ddvFor!(per, 'month'));
      const mine = ddvFor({ invoices, purchases: purchases.map((p) => purOf(p)), sales, supplierCredits: credits }, per, 'month', ctx);
      const ties = invoices.filter((i) => i.date.startsWith(per)).reduce((s, i) => s + invTies(i), 0);
      for (const k of ['in', 'outBase0', 'exportBase', 'art32Out', 'art32InBase', 'art32InVat', 'inV'] as const) {
        expect([k, plain(mine[k] ?? 0)]).toEqual([k, plain(leg[k] ?? 0)]);
      }
      for (const r of Object.keys(leg.out)) {
        expect(mine.out[+r]!.b).toBe(leg.out[r].b);
        expect(Math.abs(mine.out[+r]!.v - leg.out[r].v)).toBeLessThanOrEqual(0.01 * ties + 1e-9);
      }
      expect(Math.abs(mine.net - leg.net)).toBeLessThanOrEqual(0.01 * ties + 1e-9);
      expect([mine.impB, mine.impV]).toEqual([leg.impB ?? 0, leg.impV ?? 0]);
    }
  });
});
