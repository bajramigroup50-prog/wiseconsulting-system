/**
 * Landed-cost allocation over purchase stock lines (legacy `COSTS`, `costsOf`, `stVal`, `allocAuto`, `allocCosts`,
 * `purRound`, the stock part of `purPersist`, `calcRows`; index.html 4333–4401).
 */
import type { StockContext } from './types';
import { cents, num, r0, r2 } from './num';
import { itemById, retailBreakdown, retailPrice } from './retail';

/** Landed-cost slots: customs, cost 1, cost 2, forwarding, transport, other, foreign-currency cost. */
export const LANDED_COST_SLOTS = [
  ['car', 'Царина'],
  ['t1', 'Трошок 1'],
  ['t2', 'Трошок 2'],
  ['sped', 'Шпедиција'],
  ['trans', 'Транспорт'],
  ['dr', 'Друго'],
  ['dev', 'Дев. трошок'],
] as const;
export type LandedCostSlot = (typeof LANDED_COST_SLOTS)[number][0];

export interface CostVatLine {
  base?: number | string;
  rate?: number | string;
  vat?: number | string;
}
export interface LandedCost {
  amt?: number | string;
  /** Exchange rate (only `dev`). */
  fx?: number | string;
  /** Spread by quantity instead of value (only `trans`). */
  byQty?: boolean;
  lines?: (CostVatLine | null | undefined)[];
  [k: string]: unknown;
}

export interface PurchaseStockLine {
  item?: string;
  name?: string;
  qty?: number | string;
  price?: number | string;
  /** Discount %. */
  rab?: number | string;
  /** Customs-tariff index (into `cnames`), for allocation by tariff. */
  cn?: number | string | null;
  /** Manual landed-cost share; when any line has one, all manual values are used. */
  dep?: number | string | null;
  /** Manual customs-VAT share. */
  cvat?: number | string | null;
  /** New retail price incl. VAT. */
  sp?: number | string | null;
  value?: number;
  [k: string]: unknown;
}

export interface PurchaseLike {
  /** Import: stock prices are in foreign currency × `fx`. */
  imp?: boolean;
  fx?: number | string;
  art32?: boolean;
  wh?: string;
  costs?: Partial<Record<string, LandedCost | null | undefined>>;
  stock?: PurchaseStockLine[];
  /** Customs amounts per tariff (index = `cn`). */
  cnames?: (number | string | null | undefined)[];
  /** `val` (by value), `cn` (customs by tariff), `multi` (customs and its VAT by tariff). */
  distMode?: AllocMode;
  groups?: { konto?: string; rate?: number | string; base?: number | string; vat?: number | string; [k: string]: unknown }[];
  [k: string]: unknown;
}

export type AllocMode = 'val' | 'cn' | 'multi';

/** Legacy `costVat`: Σ VAT of a cost's VAT lines. */
export const costVat = (o: LandedCost | null | undefined): number => r2((o?.lines ?? []).reduce((s, l) => s + num(l?.vat), 0));

export interface CostOf {
  k: LandedCostSlot;
  n: string;
  o: LandedCost;
  amt: number;
  vat: number;
}

/** Legacy `costsOf`: non-empty cost slots, `dev` converted with its `fx`. */
export function costsOf(p: PurchaseLike): CostOf[] {
  const C = p.costs ?? {};
  return LANDED_COST_SLOTS.map(([k, n]) => {
    const o = C[k] ?? {};
    const amt = k === 'dev' ? r2(num(o.amt) * (num(o.fx) || 1)) : num(o.amt);
    return { k, n, o, amt: r2(amt), vat: costVat(o) };
  }).filter((x) => x.amt || x.vat);
}

/** Legacy `stVal`: qty × price × (1 − rab%) × (fx when import), cents. */
export const stockLineValue = (p: Pick<PurchaseLike, 'imp' | 'fx'>, s: PurchaseStockLine): number =>
  r2(num(s.qty) * num(s.price) * (1 - num(s.rab) / 100) * (p.imp ? num(p.fx) : 1));

export interface Allocation {
  /** Landed cost per stock line (cents). */
  by: number[];
  /** Total landed cost. */
  tot: number;
  /** Customs VAT per stock line. */
  cvat: number[];
  /** Manual shares were used. */
  manual?: boolean;
}

/**
 * Legacy `allocAuto(p, mode)`: spread every cost over the stock lines in proportion to line value; transport with
 * `byQty` by quantity; customs (`car`) by tariff amounts `cnames` in modes `cn`/`multi` (the share of a tariff with
 * no matching lines falls back to value). Customs VAT is spread by tariff in `multi`, else by value.
 * Shares are rounded per line to cents, as in legacy (the whole-denar balancing happens in `finalizeStockLines`).
 */
export function allocAuto(p: PurchaseLike, mode: AllocMode = 'val'): Allocation {
  const cs = costsOf(p);
  const st = p.stock ?? [];
  const vals = st.map((s) => stockLineValue(p, s));
  const qts = st.map((s) => num(s.qty));
  const cn = (p.cnames ?? []).map((v) => num(v));
  const cnS = cn.reduce((a, b) => a + b, 0);
  const spread = (amt: number, w: number[]): number[] => {
    const sw = w.reduce((a, b) => a + b, 0);
    return sw ? w.map((x) => (amt * x) / sw) : w.map(() => 0);
  };
  const byNames = (amt: number): number[] => {
    if (!cnS || !st.some((s) => s.cn !== '' && s.cn != null)) return spread(amt, vals);
    const out = st.map(() => 0);
    let rest = 0;
    cn.forEach((v, i) => {
      if (!v) return;
      const share = (amt * v) / cnS;
      const w = st.map((s, j) => (String(s.cn) === String(i) ? vals[j]! : 0));
      if (w.some((x) => x)) spread(share, w).forEach((x, j) => (out[j]! += x));
      else rest += share;
    });
    if (rest) spread(rest, vals).forEach((x, j) => (out[j]! += x));
    return out;
  };
  const dep = st.map(() => 0);
  let tot = 0;
  for (const c of cs) {
    tot += c.amt;
    const sh =
      c.k === 'trans' && p.costs?.trans?.byQty
        ? spread(c.amt, qts)
        : c.k === 'car' && (mode === 'cn' || mode === 'multi')
          ? byNames(c.amt)
          : spread(c.amt, vals);
    sh.forEach((x, i) => (dep[i]! += x));
  }
  const cv = costVat(p.costs?.car ?? {});
  const cvat = mode === 'multi' ? byNames(cv) : spread(cv, vals);
  return { by: dep.map(r2), tot: r2(tot), cvat: cvat.map(r2) };
}

/** Legacy `allocCosts(p)`: `allocAuto` with `p.distMode`, overridden by manual `dep` / `cvat` when any line has one. */
export function allocCosts(p: PurchaseLike): Allocation {
  const A = allocAuto(p, p.distMode || 'val');
  const st = p.stock ?? [];
  if (st.some((s) => s.dep !== '' && s.dep != null)) {
    A.by = st.map((s) => r2(s.dep));
    A.manual = true;
  }
  if (st.some((s) => s.cvat !== '' && s.cvat != null)) A.cvat = st.map((s) => r2(s.cvat));
  return A;
}

/**
 * Legacy `purRound(p)`: whole-denar groups (gross kept, VAT rounded, base = gross − VAT; art. 32-a → no VAT) and
 * whole-denar costs (except the `dev` amount, which is in foreign currency) and cost VAT lines.
 */
export function roundPurchase<P extends PurchaseLike>(p: P): P {
  const groups = (p.groups ?? []).map((g) => {
    const V = p.art32 ? 0 : r0(g.vat);
    const T = r0(num(g.base) + (p.art32 ? 0 : num(g.vat)));
    return { ...g, konto: g.konto, rate: num(g.rate), base: T - V, vat: V };
  });
  let costs = p.costs;
  if (p.costs) {
    const C: Record<string, LandedCost | null | undefined> = {};
    for (const [k, o] of Object.entries(p.costs)) {
      if (!o) {
        C[k] = o;
        continue;
      }
      C[k] = {
        ...o,
        ...(k === 'dev' ? {} : { amt: r0(o.amt) }),
        lines: (o.lines ?? []).map((l) => (l ? { ...l, base: r0(l.base), vat: r0(l.vat) } : l)),
      };
    }
    costs = C;
  }
  return { ...p, groups, costs };
}

export interface FinalStockLine {
  item: string;
  name: string;
  amount: number;
  code: string;
  barcode: string;
  qty: number;
  price: number;
  rab: number;
  cn: number | string;
  dep: number | '';
  cvat: number;
  sp: number | '';
  /** Stock value incl. landed cost, whole denars. */
  value: number;
}

/**
 * Stock lines as `purPersist` stores them (index.html 4388): lines without item or qty dropped, value = line value +
 * landed cost rounded to whole denars, and the rounding difference against the rounded total put on the largest line,
 * so Σ values = round(Σ unrounded values). Call on a `roundPurchase`-ed purchase.
 */
export function finalizeStockLines(p: PurchaseLike): FinalStockLine[] {
  const AL = allocCosts(p);
  const out = (p.stock ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.item && num(s.qty))
    .map(({ s, i }) => ({
      item: String(s.item),
      name: s.name || '',
      amount: num(s.amount),
      code: String(s.code || ''),
      barcode: String(s.barcode || ''),
      qty: num(s.qty),
      price: num(s.price),
      rab: num(s.rab),
      cn: s.cn ?? '',
      dep: AL.manual ? r2(s.dep) : ('' as const),
      cvat: AL.cvat[i] || 0,
      sp: s.sp === '' || s.sp == null ? ('' as const) : num(s.sp),
      value: r2(stockLineValue(p, s) + (AL.by[i] || 0)),
    }));
  const rawC = out.reduce((a, x) => a + cents(x.value), 0);
  out.forEach((x) => (x.value = r0(x.value)));
  const df = r0(rawC / 100) - out.reduce((a, x) => a + x.value, 0);
  if (df && out.length) {
    // largest line (first among equals), as legacy `slice().sort((a,b)=>b.value-a.value)[0]`
    let big = out[0]!;
    for (const x of out) if (x.value > big.value) big = x;
    big.value += df;
  }
  return out;
}

export interface CalculationRow {
  item: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  /** qty × price (× fx). */
  gross: number;
  rab: number;
  rabA: number;
  /** Value after discount. */
  v: number;
  /** Landed cost. */
  dep: number;
  /** Purchase value (v + dep). */
  nabV: number;
  /** Purchase unit price. */
  nabU: number;
  cvat: number;
  rate: number;
  /** Retail unit price incl. VAT. */
  sp: number;
  /** Retail value incl. VAT. */
  spV: number;
  netV: number;
  vat: number;
  /** Price difference (разлика во цена) = netV − nabV. */
  marg: number;
}

/**
 * Legacy `calcRows(p)` (index.html 4401): the calculation (ПЛТ) rows used by ЕТ/ЕТМ — purchase value incl. landed
 * cost, retail value incl. VAT, its VAT and the price difference. Retail price = line `sp`, else the item's retail
 * price at the purchase location.
 */
export function calculationRows(ctx: Pick<StockContext, 'items'>, p: PurchaseLike): CalculationRow[] {
  const AL = allocCosts(p);
  const all = p.stock ?? [];
  return all
    .filter((s) => num(s.qty))
    .map((s) => {
      const i = all.indexOf(s);
      const it = itemById(ctx, String(s.item ?? '')) ?? { id: String(s.item ?? '') };
      const rate = num(it.rate ?? 18);
      const gross = r2(num(s.qty) * num(s.price) * (p.imp ? num(p.fx) : 1));
      const v = stockLineValue(p, s);
      const dep = AL.by[i] || 0;
      const nabV = r2(v + dep);
      const sp = s.sp !== '' && s.sp != null ? num(s.sp) : retailPrice(it, p.wh || 'main');
      const spV = r2(sp * num(s.qty));
      const b = retailBreakdown(spV, rate, nabV);
      return {
        item: it.id,
        code: it.code || '',
        name: it.name || s.name || '',
        unit: it.unit || '',
        qty: num(s.qty),
        gross,
        rab: num(s.rab),
        rabA: r2(gross - v),
        v,
        dep,
        nabV,
        nabU: nabV / num(s.qty),
        cvat: AL.cvat[i] || 0,
        rate,
        sp,
        spV,
        netV: b.net,
        vat: b.vat,
        marg: b.margin,
      };
    });
}
