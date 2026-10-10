/**
 * Production costing and material write-off without a BOM (legacy `VIEWS.prodCost` 10015, `VIEWS.rasNorm` 13870,
 * `pnbPlan` 13915), and lot balances by FEFO (legacy `lotIns` / `lotBal` 10024).
 */
import { num, r2, r4 } from '../stock/num';

/* ---------------- real production cost ---------------- */

export type OverheadBasis = 'mat' | 'lab' | 'qty';
export interface ProdRecord { productId: string; qty: number; mat: number; lab: number }
export interface ProdCostRow { productId: string; q: number; mat: number; lab: number; n: number; ohA: number; real: number; std: number; price: number; var: number | null; mar: number | null }

/** Accounts of an overhead prefix list `"401, 410; 4200"`. */
export const overheadPrefixes = (s: string | null | undefined): string[] => String(s ?? '').split(/[,; ]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Legacy `prodCost`: per product, produced qty, material and labour of the work orders in the period, overheads (sum of
 * debit − credit on the given account prefixes) spread by material value, labour or quantity; real unit cost vs the
 * standard (BOM) cost and margin over the net selling price.
 */
export function productionCost(records: readonly ProdRecord[], a: { overhead: number; basis: OverheadBasis; std: (id: string) => number; price: (id: string) => number }): ProdCostRow[] {
  const by = new Map<string, { q: number; mat: number; lab: number; n: number }>();
  for (const x of records) {
    const o = by.get(x.productId) ?? { q: 0, mat: 0, lab: 0, n: 0 };
    o.q += num(x.qty); o.mat += num(x.mat); o.lab += num(x.lab); o.n++;
    by.set(x.productId, o);
  }
  const pick = (o: { q: number; mat: number; lab: number }) => (a.basis === 'lab' ? o.lab : a.basis === 'qty' ? o.q : o.mat);
  const base = [...by.values()].reduce((s, o) => s + pick(o), 0);
  return [...by.entries()].map(([productId, o]) => {
    const sh = base ? pick(o) / base : 0;
    const ohA = r2(a.overhead * sh);
    const real = o.q ? r2((o.mat + o.lab + ohA) / o.q) : 0;
    const std = a.std(productId), price = a.price(productId);
    return {
      productId, q: r4(o.q), mat: r2(o.mat), lab: r2(o.lab), n: o.n, ohA, real, std, price,
      var: std ? r2((real / std - 1) * 100) : null, mar: price ? r2(((price - real) / price) * 100) : null,
    };
  });
}

/* ---------------- write-off without BOM ---------------- */

export interface RasRow {
  itemId: string;
  /** Balance at the start of the period (exclusive of `from`). */
  a: { qty: number; value: number };
  /** Received in the period (qty, value). */
  iq: number; iv: number;
  /** Already issued in the period (positive). */
  oq: number;
  /** Balance at the end of the period. */
  now: { qty: number; avg: number };
}
export interface RasPlanRow extends RasRow { avg: number; end?: number; q: number; v: number }

/** Average cost of the period: (opening value + receipts) / (opening qty + receipts), else the current average. */
export const rasAvg = (x: RasRow): number => (x.a.value + x.iv > 0 && x.a.qty + x.iq > 0 ? r4((x.a.value + x.iv) / (x.a.qty + x.iq)) : x.now.avg);

/**
 * Legacy `rasNorm` "по попис": issue = opening + received − already issued − counted end quantity (empty = the book
 * quantity), never below 0 or above what is available.
 */
export function rasPlanCount(rows: readonly RasRow[], end: Readonly<Record<string, number | null | undefined>>): RasPlanRow[] {
  return rows.map((x) => {
    const avg = rasAvg(x);
    const e = end[x.itemId] != null && Number.isFinite(end[x.itemId]) ? Number(end[x.itemId]) : x.now.qty;
    const avail = r4(x.a.qty + x.iq - x.oq);
    const q = r4(Math.max(0, Math.min(avail, avail - e)));
    return { ...x, avg, end: e, q, v: r2(q * avg) };
  });
}

/**
 * Legacy `rasNorm` "% од продажба": total = sales × pct %, spread over the materials by their stock value (never more
 * than the stock value of a material).
 */
export function rasPlanPct(rows: readonly RasRow[], sales: number, pct: number): RasPlanRow[] {
  const tot = r2((sales * pct) / 100);
  const base = rows.map((x) => { const avg = rasAvg(x); return { ...x, avg, av: r2(Math.max(0, x.now.qty) * avg) }; });
  const sv = base.reduce((s, x) => s + x.av, 0) || 1;
  return base.map(({ av, ...x }) => {
    const v = r2(Math.min(av, (tot * av) / sv));
    return { ...x, q: x.avg > 0 ? r4(v / x.avg) : 0, v };
  });
}

/* ---------------- lots (FEFO) ---------------- */

export interface LotIn { itemId: string; qty: number; lot: string; exp: string | null; date: string; src: string; partnerId?: string | null }

/**
 * Legacy `lotBal`: the item's current stock is attributed to its lots taking the ones that expire LAST first (what was
 * sold came from the earliest-expiring lots — FEFO); lots with nothing left are dropped. Result in FEFO order.
 */
export function lotBalance<L extends LotIn>(lots: readonly L[], stockQty: number): (L & { on: number })[] {
  const L = [...lots].sort((a, b) => String(b.exp || '9999').localeCompare(String(a.exp || '9999')) || String(b.date).localeCompare(String(a.date)));
  let rem = Math.max(0, stockQty);
  return L.map((l) => {
    const q = Math.min(l.qty, rem);
    rem = r4(rem - q);
    return { ...l, on: r4(q) };
  }).filter((l) => l.on > 0).reverse();
}
