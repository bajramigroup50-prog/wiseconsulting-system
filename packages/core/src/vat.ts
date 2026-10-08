/**
 * VAT (ДДВ) domain logic, ported from legacy `index.html`.
 *
 * Final effective legacy versions ported (LEGACY-MAP Phase 5):
 * - VAT account Proxies `VAT_OUT`/`VAT_IN`/`VAT_IMP`/`VAT_BAD`/`vOk` (3169–3171) → `vatAccount` (one validated resolver)
 * - `calcLines` (3329), `advDeduct` (3340), `costsOf` (4335), `blgCalc` (6517), `scrCalc` (8767)
 * - `periodOf` (3605), `perRange` (5915)
 * - `ddvFor` (3606 wrapped by 11963 — travel margin, `tourM` / `noDed` exclusion) → `ddvFor`
 * - `ddv04` (5905) → `ddv04` / `ddv04FromResult`
 * - `dkOut` / `dkIn` / `dkSum` (8877 / 8884 / 8895) → `vatBookOut` / `vatBookIn` / `vatBookSum`
 * - `tuMarginFor` (11961) → `travelMarginFor`
 *
 * Money: every amount is accumulated in integer cents. A single product (qty × price, base × rate)
 * is computed in floating point and rounded once with `r2` from `money.ts` (half away from zero).
 * Legacy `r2` is `Math.round(x*100)/100`, i.e. half *up* (towards +∞) — the two differ only on an
 * exact negative half cent (e.g. −0.125 → legacy −0.12, here −0.13). Whole-denar rounding
 * (legacy `Math.round`) uses the same half-away-from-zero rule. These are the only intended
 * numeric differences; everything else reproduces legacy rounding step by step.
 *
 * Deliberate fixes of legacy bugs (LEGACY-MAP 5.4 / 3.4) are marked `FIX:` in the code.
 */
import { r2 } from './money';
import {
  DDV04_FIELDS, TRAVEL_MARGIN_RATE, VAT_BAD_ACCOUNTS, VAT_IMP_DEFAULT, VAT_IN_DEFAULT, VAT_OUT_DEFAULT, VAT_BOOK_COLUMNS,
  type VatRate,
} from './data/vat';
import { PURCHASE_COST_SLOTS } from './data/posting';
import type {
  CashVoucher, CostSlot, InvoiceDoc, InvoiceItem, PurchaseCostKey, PurchaseDoc, SalesDoc, SupplierCreditDoc,
} from './posting';

export {
  ART32_TXT, DDV04_FIELDS, DDV04_FORM_ROWS1, DDV04_FORM_ROWS2, TRAVEL_MARGIN_RATE, VAT_BAD_ACCOUNTS, VAT_BOOK_COLUMNS,
  VAT_IMP_DEFAULT, VAT_IN_DEFAULT, VAT_OUT_DEFAULT, VAT_POSITIVE_RATES, VAT_RATES, VAT_REGISTRATION_LIMIT,
  type VatRate,
} from './data/vat';

/* ------------------------------------------------------------------ money helpers (private) */

/** Legacy `+x||0`. */
const n0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
/** Round half away from zero to an integer. */
const rh = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));
/** Denars (float) → integer cents, rounding like `r2`. */
const toC = (x: unknown): number => Math.round(r2(n0(x)) * 100);
/** Integer cents → denars. */
const toD = (c: number): number => (c === 0 ? 0 : c / 100);

/* ------------------------------------------------------------------ VAT accounts */

export type VatAccountMap = Partial<Record<number | string, string | null | undefined>>;
export type VatAccountKind = 'out' | 'in' | 'imp';

/** VAT account overrides, stored per firm (`firm.vatOut/vatIn/vatImp/vatInKonto`) and globally (`appsettings/schemes`). */
export interface VatAccountSettings {
  vatOut?: VatAccountMap | null;
  vatIn?: VatAccountMap | null;
  vatImp?: VatAccountMap | null;
  /** One input-VAT konto for every rate (firm level only). */
  vatInKonto?: string | null;
}

/** Firm facts the VAT computations need. `PostingContext` (posting.ts) is assignable to this. */
export interface VatContext {
  firm: VatAccountSettings & {
    /**
     * VAT-registered. Legacy is inconsistent: invoices treat only an explicit `false` as non-VAT
     * (`calcLines`), purchases/cash/credits treat any falsy value as non-VAT. Kept as-is.
     */
    ddv?: boolean | null;
  };
  global?: Omit<VatAccountSettings, 'vatInKonto'> | null;
}

/** Legacy `vOk`: a configured VAT konto is usable when non-empty and not a summary konto. */
export function isValidVatAccount(k: unknown): k is string {
  if (k == null || k === '') return false;
  const s = String(k).trim();
  return s !== '' && !VAT_BAD_ACCOUNTS.has(s);
}

const isVatRate = (r: number): r is VatRate => r === 18 || r === 10 || r === 5;
const DEFAULTS: Record<VatAccountKind, Readonly<Record<VatRate, string>>> = { out: VAT_OUT_DEFAULT, in: VAT_IN_DEFAULT, imp: VAT_IMP_DEFAULT };
const MAP_KEY = { out: 'vatOut', in: 'vatIn', imp: 'vatImp' } as const;

/**
 * Resolve the VAT konto for a rate. Order: firm per-rate map → (input VAT only) firm single
 * `vatInKonto` → global per-rate map → default. Returns `undefined` for rates without VAT (0, odd rates).
 *
 * FIX (LEGACY-MAP 5.4 item 1 / top-fix #8): legacy had three Proxies with different rules —
 * `VAT_IMP` accepted summary kontos such as `1300` (no `vOk`). Every candidate is now validated.
 */
export function vatAccount(ctx: VatContext, kind: VatAccountKind, rate: number | string): string | undefined {
  const r = n0(rate);
  if (!isVatRate(r)) return undefined;
  const key = MAP_KEY[kind];
  const pick = (m: VatAccountMap | null | undefined): string | undefined => {
    const v = m?.[r];
    return isValidVatAccount(v) ? String(v).trim() : undefined;
  };
  return (
    pick(ctx.firm[key]) ??
    (kind === 'in' && isValidVatAccount(ctx.firm.vatInKonto) ? String(ctx.firm.vatInKonto).trim() : undefined) ??
    pick(ctx.global?.[key]) ??
    DEFAULTS[kind][r]
  );
}

/** All VAT kontos of a firm (output, input, import for 18/10/5). Posting adds the art. 32-a kontos. */
export function vatAccounts(ctx: VatContext): Set<string> {
  const s = new Set<string>();
  for (const r of [18, 10, 5]) for (const k of ['out', 'in', 'imp'] as const) {
    const a = vatAccount(ctx, k, r);
    if (a) s.add(a);
  }
  return s;
}

/** Konto code shape accepted by the tariff editor (legacy `trSave` 12855: 3–10 digits). */
export const isAccountCode = (k: unknown): boolean => /^\d{3,10}$/.test(String(k ?? '').trim());

/**
 * Validate VAT account overrides before saving. Returns human-readable problems (empty = OK).
 * FIX (LEGACY-MAP 5.4 item 3): legacy accepted values that the resolvers then silently ignored.
 */
export function validateVatAccountSettings(s: VatAccountSettings): string[] {
  const out: string[] = [];
  const check = (label: string, v: unknown) => {
    if (v == null || v === '') return;
    if (!isAccountCode(v)) out.push(`${label}: „${String(v)}“ не е конто (3–10 цифри)`);
    else if (!isValidVatAccount(v)) out.push(`${label}: збирното конто ${String(v).trim()} не смее да се користи за ДДВ`);
  };
  for (const kind of ['out', 'in', 'imp'] as const) {
    const m = s[MAP_KEY[kind]];
    if (!m) continue;
    for (const [rate, v] of Object.entries(m)) {
      if (v == null || v === '') continue;
      if (!isVatRate(n0(rate))) out.push(`${MAP_KEY[kind]}: стапка ${rate}% нема ДДВ конто`);
      else check(`${MAP_KEY[kind]}[${rate}]`, v);
    }
  }
  check('vatInKonto', s.vatInKonto);
  return out;
}

/** True for a rate the system knows (18, 10, 5, 0). */
export const isKnownVatRate = (rate: unknown): boolean => [18, 10, 5, 0].includes(n0(rate));

/** VAT included in a gross amount: gross × rate / (100 + rate), rounded to cents. */
export const vatFromGross = (gross: number, rate: number): number => toD(rh((toC(gross) * rate) / (100 + rate)));

/** Art. 32-a (reverse charge) VAT the recipient calculates on a base. Legacy `r2(base*rate/100)`. */
export const reverseChargeVat = (base: number, rate: number = 18): number => toD(rh((toC(base) * (n0(rate) || 18)) / 100));

/** Legacy `passK`: zero-rated lines on a 2xxx konto are amounts collected on behalf of others (not turnover). */
export const isPassThroughAccount = (k: unknown): boolean => /^2/.test(String(k ?? ''));

/* ------------------------------------------------------------------ document calculations */

export interface CalcGroup { rate: number; konto: string; base: number; vat: number }
export interface CalcLinesResult { by: CalcGroup[]; base: number; vat: number; total: number }
export interface CalcLinesOptions {
  /** Firm is explicitly not VAT-registered (legacy `firm().ddv===false`) → every rate becomes 0. */
  nonVat?: boolean;
  /** Konto for lines without one (legacy literal `'7400'`). */
  defaultKonto?: string;
}

/**
 * Invoice totals grouped per (rate, konto), each line rounded to cents (legacy `calcLines`, 3329).
 * Art. 32-a → rate 18 with VAT 0 (the buyer calculates it).
 */
export function calcLines(items: readonly InvoiceItem[] | undefined, art32?: boolean, opts: CalcLinesOptions = {}): CalcLinesResult {
  const defK = opts.defaultKonto ?? '7400';
  const by = new Map<string, { rate: number; konto: string; base: number; vat: number }>();
  let base = 0;
  let vat = 0;
  for (const it of items ?? []) {
    const b = toC(n0(it.qty) * n0(it.price) * (1 - n0(it.disc) / 100));
    const rate = art32 ? 18 : opts.nonVat ? 0 : n0(it.rate);
    const v = art32 || opts.nonVat ? 0 : rh((b * rate) / 100);
    base += b;
    vat += v;
    const konto = it.konto || defK;
    const key = `${rate}|${konto}`;
    const g = by.get(key) ?? { rate, konto, base: 0, vat: 0 };
    g.base += b;
    g.vat += v;
    by.set(key, g);
  }
  return {
    by: [...by.values()].map((g) => ({ rate: g.rate, konto: g.konto, base: toD(g.base), vat: toD(g.vat) })),
    base: toD(base),
    vat: toD(vat),
    total: toD(base + vat),
  };
}

/** An advance invoice deducted on a final invoice (legacy `inv.advances = {advInvId: base}` resolved by the caller). */
export interface AdvanceDeduction {
  /** Base amount (without VAT) of the advance used on this invoice. */
  amount: number;
  /** The advance invoice. */
  invoice: { id?: string; number?: string; date?: string; items: readonly InvoiceItem[]; art32?: boolean };
}
export interface AdvanceDeductResult {
  base: number; vat: number; total: number;
  by: { rate: number; base: number; vat: number }[];
  list: { id?: string; number?: string; date?: string; base: number; vat: number }[];
}

/** Pro-rata VAT of used advances (legacy `advDeduct`, 3340). */
export function advDeduct(advances: readonly AdvanceDeduction[] | undefined, opts: CalcLinesOptions = {}): AdvanceDeductResult {
  let base = 0;
  let vat = 0;
  const by: AdvanceDeductResult['by'] = [];
  const list: AdvanceDeductResult['list'] = [];
  for (const a of advances ?? []) {
    const amt = toC(a.amount);
    if (!amt) continue;
    const ac = calcLines(a.invoice.items, a.invoice.art32, opts);
    const acBase = toC(ac.base);
    if (!acBase) continue;
    let v = 0;
    for (const g of ac.by) {
      const gb = rh((toC(g.base) * amt) / acBase);
      const gv = rh((toC(g.vat) * amt) / acBase);
      v += gv;
      by.push({ rate: g.rate, base: toD(gb), vat: toD(gv) });
    }
    list.push({ id: a.invoice.id, number: a.invoice.number, date: a.invoice.date, base: toD(amt), vat: toD(v) });
    base += amt;
    vat += v;
  }
  return { base: toD(base), vat: toD(vat), total: toD(base + vat), by, list };
}

export interface CostOf { k: PurchaseCostKey; n: string; o: CostSlot; amt: number; vat: number }

/** Landed costs of a purchase that carry an amount or VAT (legacy `costsOf`, 4335). `dev` = amount × fx. */
export function costsOf(p: Pick<PurchaseDoc, 'costs'>): CostOf[] {
  const C = p.costs ?? {};
  const out: CostOf[] = [];
  for (const [k, n] of PURCHASE_COST_SLOTS) {
    const o: CostSlot = C[k] ?? {};
    const amt = k === 'dev' ? toC(n0(o.amt) * (n0(o.fx) || 1)) : toC(o.amt);
    const vat = (o.lines ?? []).reduce((s, l) => s + toC(l?.vat), 0);
    if (amt || vat) out.push({ k, n, o, amt: toD(amt), vat: toD(vat) });
  }
  return out;
}

export interface CashVoucherCalc { fx: number; mkd: number; vat: number; base: number; ded: boolean }

/**
 * Cash voucher (благајна) amounts (legacy `blgCalc`, 6517). Input VAT is deductible only for
 * expenses (`out`), in Macedonia, for a VAT firm, at a rate with an input-VAT konto.
 *
 * FIX (LEGACY-MAP 4.4 #14): legacy rounded the denar amount and the VAT to whole denars
 * (`Math.round`) while bank lines use `r2`, so a foreign receipt (EUR 15 × 61.53 = 922.95) was booked
 * as 923 and the register drifted from the receipts. Amounts are now rounded to the cent (`r2`);
 * vouchers whose amount is already whole denars give exactly the legacy result.
 */
export function blgCalc(x: CashVoucher, ctx: VatContext): CashVoucherCalc {
  const fx = x.cur === 'MKD' ? 1 : n0(x.fx);
  const mkd = r2(n0(x.amt) * fx);
  const rate = n0(x.rate);
  const ded = x.kind !== 'in' && (x.country || 'MK') === 'MK' && !!ctx.firm.ddv && !!rate && !!vatAccount(ctx, 'in', rate);
  const vat = ded
    ? x.vat !== '' && x.vat != null
      ? r2(n0(x.vat) * (x.cur === 'MKD' ? 1 : fx))
      : r2((mkd * rate) / (100 + rate))
    : 0;
  return { fx, mkd, vat, base: r2(mkd - vat), ded };
}

export interface SupplierCreditCalc { base: number; vat: number; total: number; by: { konto?: string; rate: number; b: number; v: number }[] }

/** Supplier return / credit totals, whole denars per row (legacy `scrCalc`, 8767). */
export function scrCalc(d: Pick<SupplierCreditDoc, 'rows'>, ctx: VatContext): SupplierCreditCalc {
  const ddv = !!ctx.firm.ddv;
  let base = 0;
  let vat = 0;
  const by = new Map<string, { konto?: string; rate: number; b: number; v: number }>();
  for (const r of d.rows ?? []) {
    const b = rh(n0(r.qty) * n0(r.price));
    const rt = n0(r.rate);
    const v = ddv && rt ? rh((b * rt) / 100) : 0;
    base += b;
    vat += v;
    const k = `${r.konto || ''}|${rt}`;
    const g = by.get(k) ?? { konto: r.konto || undefined, rate: rt, b: 0, v: 0 };
    g.b += b;
    g.v += v;
    by.set(k, g);
  }
  return { base, vat, total: base + vat, by: [...by.values()] };
}

/* ------------------------------------------------------------------ periods */

export type VatPeriodKind = 'month' | 'quarter';

/** 'YYYY-MM' (month) or 'YYYY-Тq' (quarter, Cyrillic Т) for a date (legacy `periodOf`, 3605). */
export function periodOf(date: string, per: VatPeriodKind | string | undefined): string {
  const m = Number(date.slice(5, 7));
  return per === 'month' ? date.slice(0, 7) : `${date.slice(0, 4)}-Т${Math.ceil(m / 3)}`;
}

/** First and last day of a period id (legacy `perRange`, 5915). */
export function perRange(p: string): [string, string] {
  const last = (y: number, m0: number) => new Date(Date.UTC(y, m0, 0)).toISOString().slice(0, 10);
  if (p.includes('-Т')) {
    const [y, q] = p.split('-Т');
    const m1 = (Number(q) - 1) * 3 + 1;
    return [`${y}-${String(m1).padStart(2, '0')}-01`, last(Number(y), m1 + 2)];
  }
  const [y, m] = p.split('-');
  return [`${p}-01`, last(Number(y), Number(m))];
}

/** All periods of a year for a filing frequency. */
export function periodsOfYear(year: number | string, per: VatPeriodKind | string | undefined): string[] {
  const y = String(year);
  return per === 'month'
    ? Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
    : [1, 2, 3, 4].map((q) => `${y}-Т${q}`);
}

/** Due date of a VAT return: the 25th of the month after the period (legacy `periodDue`, 3747). */
export function periodDue(p: string): string {
  const [, to] = perRange(p);
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7));
  return m === 12 ? `${y + 1}-01-25` : `${y}-${String(m + 1).padStart(2, '0')}-25`;
}

/* ------------------------------------------------------------------ travel margin (чл. 38 ЗДДВ) */

/** Arrangement totals from the travel module (legacy `taCalc`): revenue, prior travel services, own services. */
export interface TravelArrangementTotals { rev: number; cost: number; own?: number }
export interface TravelMarginOptions {
  /** Totals per arrangement id; invoices reference them by `arrangementId`. */
  arrangements?: Readonly<Record<string, TravelArrangementTotals>>;
  /** Margin basis (чл. 38 ст. 3): whole period (negatives offset) or per arrangement (negatives dropped). Default 'period'. */
  agg?: 'period' | 'arr';
  /** Margin VAT rate; legacy hard-codes 18. */
  rate?: number;
}
export interface TravelMarginLine { invoice: InvoiceDoc; arrangementId?: string; g: number; cost: number; own: number; mg: number }
export interface TravelMarginResult {
  /** Sum of margins. */ m: number;
  /** Taxable margin (after the per-arrangement / period clamp at 0). */ mt: number;
  base: number; vat: number; own: number; ownBase: number; ownVat: number;
  L: TravelMarginLine[]; agg: 'period' | 'arr';
}

/**
 * Travel-agency margin VAT for a period (legacy `tuMarginFor`, 11961). Uses invoices with `tourM`.
 * Each invoice's gross is split into prior services and own services in the ratio of its
 * arrangement's totals; VAT = taxable margin × rate / (100 + rate).
 *
 * Note (LEGACY-MAP 5.4 item 6): the ratio is the arrangement's *current* cost ratio, so later
 * costs change a closed period. The caller should pass totals frozen at closing time.
 */
export function travelMarginFor(
  invoices: readonly InvoiceDoc[], period: string, per: VatPeriodKind | string | undefined, ctx: VatContext, opts: TravelMarginOptions = {},
): TravelMarginResult {
  return travelMarginOf(invoices.filter((inv) => periodOf(inv.date, per) === period), ctx, opts);
}

/** Travel margin over an already selected set of invoices (non-`tourM` and pending ones are ignored). */
export function travelMarginOf(invoices: readonly InvoiceDoc[], ctx: VatContext, opts: TravelMarginOptions = {}): TravelMarginResult {
  const agg = opts.agg ?? 'period';
  const rate = opts.rate ?? TRAVEL_MARGIN_RATE;
  const nonVat = ctx.firm.ddv === false;
  const L: TravelMarginLine[] = [];
  const byA = new Map<string, number>();
  const cents: { g: number; cost: number; own: number; mg: number }[] = [];
  for (const inv of invoices) {
    if (!inv.tourM || inv.pend) continue;
    const sg = inv.credit ? -1 : 1;
    const g = sg * toC(calcLines(inv.items, false, { nonVat }).total);
    const A = inv.arrangementId ? opts.arrangements?.[inv.arrangementId] : undefined;
    let cost = 0;
    let own = 0;
    if (A) {
      const rev = toC(A.rev);
      if (rev) {
        cost = rh((toC(A.cost) * g) / rev);
        own = rh((toC(A.own ?? 0) * g) / rev);
      }
    }
    const mg = g - cost - own;
    cents.push({ g, cost, own, mg });
    L.push({ invoice: inv, arrangementId: A ? inv.arrangementId : undefined, g: toD(g), cost: toD(cost), own: toD(own), mg: toD(mg) });
    const k = A ? String(inv.arrangementId) : '_';
    byA.set(k, (byA.get(k) ?? 0) + mg);
  }
  const m = cents.reduce((s, x) => s + x.mg, 0);
  const mt = agg === 'arr' ? [...byA.values()].reduce((s, x) => s + Math.max(0, x), 0) : Math.max(0, m);
  const vat = rh((mt * rate) / (100 + rate));
  const own = cents.reduce((s, x) => s + x.own, 0);
  const ownVat = rh((own * rate) / (100 + rate));
  return { m: toD(m), mt: toD(mt), base: toD(mt - vat), vat: toD(vat), own: toD(own), ownBase: toD(own - ownVat), ownVat: toD(ownVat), L, agg };
}

/* ------------------------------------------------------------------ ДДВ-04 */

/** Documents of one firm that feed VAT. Pending (client-submitted, unapproved) documents are skipped. */
export interface VatDocuments {
  invoices?: readonly InvoiceDoc[];
  sales?: readonly SalesDoc[];
  purchases?: readonly PurchaseDoc[];
  /** `docs.type='blg'`. */
  cashVouchers?: readonly CashVoucher[];
  /** `docs.type='supcr'`. */
  supplierCredits?: readonly SupplierCreditDoc[];
}

export interface VatRateTotals { b: number; v: number }
export interface DdvResult {
  /** Output VAT per rate (18/10/5). */
  out: Record<number, VatRateTotals>;
  /** Zero-rated / exempt sales with the right to deduct (field 08). */
  outBase0: number;
  /** Exempt sales without the right to deduct (field 09; only from `zeroKind:'exemptNoDed'`). */
  exemptNoDedBase: number;
  /** Supplies to non-resident taxable persons (field 10; only from `zeroKind:'nonResident'`). */
  nonResidentBase: number;
  /** Export (field 07). */
  exportBase: number;
  /** Domestic sales under art. 32-a reverse charge (field 11). */
  art32Out: number;
  /** Input VAT per rate (fields 21/22). */
  in: Record<number, VatRateTotals>;
  /** Received domestic art. 32-a supplies, all rates: base and VAT the recipient calculates (fields 25/26). */
  art32InBase: number;
  art32InVat: number;
  /** Same, split: general rate (16/17) vs reduced rates (18/19). */
  art32In18: VatRateTotals;
  art32InReduced: VatRateTotals;
  /** Received supplies from non-residents under art. 32 т. 4/5 (fields 12–15, 23/24), from `nonResident` purchases. */
  nrIn18: VatRateTotals;
  nrInReduced: VatRateTotals;
  /** Import (customs) base and VAT (fields 27/28). */
  impB: number;
  impV: number;
  outV: number;
  inV: number;
  net: number;
  tourM?: TravelMarginResult;
}

export interface DdvForOptions { travel?: TravelMarginOptions }

/**
 * VAT totals of a period (legacy `ddvFor` 3606 + patch 11963).
 *
 * Effective legacy behaviour kept: invoices with `tourM` are taxed only through the travel margin
 * (added to 18%), purchases with `noDed` (travel prior services) are left out entirely, zero-rated
 * lines on 2xxx kontos are pass-through amounts, advance deductions reduce output VAT pro rata.
 *
 * FIX: cash vouchers and supplier credits marked `pend` are skipped like every other document
 *   (legacy counted unapproved client entries).
 * FIX: `outV`/`inV`/`net` include the travel margin (legacy computed them before adding it).
 * FIX: art. 32-a received supplies are split by rate (legacy put all rates into fields 16/17).
 * NEW: optional `zeroKind` on invoices and `nonResident` on purchases fill fields 09/10/12–15/23/24
 *   (legacy never filled them); without those fields the result equals legacy.
 */
export function ddvFor(docs: VatDocuments, period: string, per: VatPeriodKind | string | undefined, ctx: VatContext, opts: DdvForOptions = {}): DdvResult {
  const nonVat = ctx.firm.ddv === false;
  const out = new Map<number, { b: number; v: number }>();
  const inn = new Map<number, { b: number; v: number }>();
  let outBase0 = 0, exportBase = 0, art32Out = 0, exemptNoDed = 0, nonRes = 0;
  const a32in18 = { b: 0, v: 0 }, a32inR = { b: 0, v: 0 }, nr18 = { b: 0, v: 0 }, nrR = { b: 0, v: 0 };
  let impB = 0, impV = 0;
  const add = (M: Map<number, { b: number; v: number }>, rate: number, b: number, v: number) => {
    const o = M.get(rate) ?? { b: 0, v: 0 };
    o.b += b;
    o.v += v;
    M.set(rate, o);
  };
  const inP = (d: { date: string; pend?: boolean | null }) => !d.pend && periodOf(d.date, per) === period;

  for (const inv of docs.invoices ?? []) {
    if (inv.tourM || !inP(inv)) continue;
    const c = calcLines(inv.items, inv.art32, { nonVat });
    const sg = inv.credit ? -1 : 1;
    if (inv.art32) art32Out += sg * toC(c.base);
    else {
      for (const g of c.by) {
        if (g.rate === 0 && isPassThroughAccount(g.konto)) continue;
        const b = sg * toC(g.base);
        if (g.rate === 0) {
          const kind = inv.zeroKind ?? (inv.export ? 'export' : 'exempt');
          if (kind === 'export') exportBase += b;
          else if (kind === 'exemptNoDed') exemptNoDed += b;
          else if (kind === 'nonResident') nonRes += b;
          else outBase0 += b;
        } else add(out, g.rate, b, sg * toC(g.vat));
      }
    }
    if (!inv.credit && !inv.advance && !inv.art32) {
      for (const g of advDeduct(inv.advances, { nonVat }).by) {
        if (g.rate) add(out, g.rate, -toC(g.base), -toC(g.vat));
        else outBase0 -= toC(g.base);
      }
    }
  }
  for (const s of docs.sales ?? []) {
    if (!inP(s)) continue;
    for (const g of s.groups ?? []) {
      if (n0(g.rate) === 0) outBase0 += toC(g.base);
      else add(out, n0(g.rate), toC(g.base), toC(g.vat));
    }
  }
  for (const x of docs.cashVouchers ?? []) {
    if (!inP(x)) continue;
    const c = blgCalc(x, ctx);
    if (c.ded && c.vat) add(inn, n0(x.rate), toC(c.base), toC(c.vat));
  }
  for (const x of docs.supplierCredits ?? []) {
    if (!inP(x)) continue;
    for (const g of scrCalc(x, ctx).by) {
      if (!g.v || !vatAccount(ctx, 'in', g.rate)) continue;
      add(inn, g.rate, -g.b * 100, -g.v * 100);
    }
  }
  for (const p of docs.purchases ?? []) {
    if (p.noDed || !inP(p)) continue;
    for (const c of costsOf(p)) {
      for (const l of c.o.lines ?? []) {
        const b = toC(l?.base), v = toC(l?.vat);
        if (!b && !v) continue;
        if (c.k === 'car') { impB += b; impV += v; } else add(inn, n0(l?.rate) || 18, b, v);
      }
    }
    if (p.imp) continue;
    for (const g of p.groups ?? []) {
      const rate = n0(g.rate) || 18;
      if (p.art32) {
        const b = toC(g.base);
        const v = rh((b * rate) / 100);
        const T = p.nonResident ? (rate === 18 ? nr18 : nrR) : rate === 18 ? a32in18 : a32inR;
        T.b += b;
        T.v += v;
      } else if (n0(g.vat)) add(inn, n0(g.rate), toC(g.base), toC(g.vat));
    }
  }

  let tourM: TravelMarginResult | undefined;
  if (ctx.firm.ddv) {
    const T = travelMarginFor(docs.invoices ?? [], period, per, ctx, opts.travel);
    const b = toC(T.base) + toC(T.ownBase);
    const v = toC(T.vat) + toC(T.ownVat);
    if (b || v) add(out, 18, b, v);
    tourM = T;
  }

  const art32InVat = a32in18.v + a32inR.v + nr18.v + nrR.v;
  const sumV = (M: Map<number, { v: number }>) => [...M.values()].reduce((s, x) => s + x.v, 0);
  // Reverse-charge VAT is both output and input (it nets to zero).
  const outV = sumV(out) + art32InVat;
  const inV = sumV(inn) + art32InVat + impV;
  const asObj = (M: Map<number, { b: number; v: number }>) => {
    const o: Record<number, VatRateTotals> = {};
    for (const [r, x] of [...M.entries()].sort((a, b) => b[0] - a[0])) o[r] = { b: toD(x.b), v: toD(x.v) };
    return o;
  };
  const T = (x: { b: number; v: number }): VatRateTotals => ({ b: toD(x.b), v: toD(x.v) });
  const R: DdvResult = {
    out: asObj(out), outBase0: toD(outBase0), exemptNoDedBase: toD(exemptNoDed), nonResidentBase: toD(nonRes), exportBase: toD(exportBase),
    art32Out: toD(art32Out), in: asObj(inn),
    // Same as legacy unless the new `nonResident` flag is used (those go to 12–15 / 23–24 instead).
    art32InBase: toD(a32in18.b + a32inR.b), art32InVat: toD(a32in18.v + a32inR.v),
    art32In18: T(a32in18), art32InReduced: T(a32inR), nrIn18: T(nr18), nrInReduced: T(nrR),
    impB: toD(impB), impV: toD(impV), outV: toD(outV), inV: toD(inV), net: toD(outV - inV),
  };
  if (tourM) R.tourM = tourM;
  return R;
}

export type Ddv04Fields = Record<string, number>;

/**
 * ДДВ-04 fields in whole denars from a `ddvFor` result (legacy `ddv04`, 5905).
 *
 * FIX: legacy rounded each field *after* computing the totals 20/29/31 from unrounded values, so
 * 31 could differ from 20 − 29 by one denar on the printed form. Here every amount field is
 * rounded first and 20, 29 and 31 are sums of the rounded fields.
 * `corrections` is field 30 (legacy always 0); 31 = 20 − 29 − 30 as in legacy.
 */
export function ddv04FromResult(D: DdvResult, corrections = 0): Ddv04Fields {
  const F: Ddv04Fields = {};
  for (const [k] of DDV04_FIELDS) F[k] = 0;
  const w = (x: number) => rh(x);
  F['01'] = w(D.out[18]?.b ?? 0); F['02'] = w(D.out[18]?.v ?? 0);
  F['03'] = w(D.out[10]?.b ?? 0); F['04'] = w(D.out[10]?.v ?? 0);
  F['05'] = w(D.out[5]?.b ?? 0); F['06'] = w(D.out[5]?.v ?? 0);
  F['07'] = w(D.exportBase); F['08'] = w(D.outBase0); F['09'] = w(D.exemptNoDedBase); F['10'] = w(D.nonResidentBase);
  F['11'] = w(D.art32Out);
  F['12'] = w(D.nrIn18.b); F['13'] = w(D.nrIn18.v); F['14'] = w(D.nrInReduced.b); F['15'] = w(D.nrInReduced.v);
  F['16'] = w(D.art32In18.b); F['17'] = w(D.art32In18.v); F['18'] = w(D.art32InReduced.b); F['19'] = w(D.art32InReduced.v);
  F['20'] = F['02']! + F['04']! + F['06']! + F['13']! + F['15']! + F['17']! + F['19']!;
  F['21'] = w(Object.values(D.in).reduce((s, x) => s + x.b, 0));
  F['22'] = w(Object.values(D.in).reduce((s, x) => s + x.v, 0));
  F['23'] = w(D.nrIn18.b + D.nrInReduced.b); F['24'] = w(D.nrIn18.v + D.nrInReduced.v);
  F['25'] = w(D.art32InBase); F['26'] = w(D.art32InVat);
  F['27'] = w(D.impB); F['28'] = w(D.impV);
  F['29'] = F['22']! + F['24']! + F['26']! + F['28']!;
  F['30'] = w(corrections);
  F['31'] = F['20'] - F['29'] - F['30'];
  return F;
}

/** ДДВ-04 for a period straight from documents. */
export function ddv04(docs: VatDocuments, period: string, per: VatPeriodKind | string | undefined, ctx: VatContext, opts: DdvForOptions & { corrections?: number } = {}): Ddv04Fields {
  return ddv04FromResult(ddvFor(docs, period, per, ctx, opts), opts.corrections ?? 0);
}

/* ------------------------------------------------------------------ VAT books (КИФ / КПФ) */

export interface PartnerInfo { name?: string; edb?: string }
export interface VatBookOptions {
  /** Partner names / tax numbers by id. */
  partners?: Readonly<Record<string, PartnerInfo>>;
  /** Travel arrangements (for `tourM` invoices in the output book). */
  travel?: TravelMarginOptions;
}
export interface VatBookOutRow {
  date: string; no: string; name: string; edb: string; note: string;
  b18: number; v18: number; b10: number; v10: number; b5: number; v5: number; b0: number; exp: number; a32: number; tot: number;
}
export interface VatBookInRow {
  date: string; no: string; name: string; edb: string; note: string;
  b18: number; v18: number; b10: number; v10: number; b5: number; v5: number; ib: number; iv: number; ab: number; av: number; nd: number; tot: number;
}

const BK = { 18: 'b18', 10: 'b10', 5: 'b5' } as const;
const VK = { 18: 'v18', 10: 'v10', 5: 'v5' } as const;
const dmy = (d: string | undefined) => (d ? String(d).split('-').reverse().join('.') : '');
const bookSort = <T extends { date: string; no: string }>(R: T[]) =>
  R.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.no).localeCompare(String(y.no), undefined, { numeric: true })));
const inRange = (d: { date: string }, a: string, b: string) => !(d.date < a || d.date > b);

/**
 * Output VAT book (КИФ) between two dates inclusive (legacy `dkOut`, 8877).
 * FIX (LEGACY-MAP 5.4 item 6): invoices under the travel-margin scheme (`tourM`) are booked with
 * their margin base/VAT at 18% (per invoice, as in the чл. 38 evidence) instead of the full amount,
 * so the book agrees with ДДВ-04. With `agg:'arr'` a negative arrangement margin is not clamped per
 * invoice, so the book can still differ from field 01/02 by that clamp.
 */
export function vatBookOut(docs: VatDocuments, from: string, to: string, ctx: VatContext, opts: VatBookOptions = {}): VatBookOutRow[] {
  const nonVat = ctx.firm.ddv === false;
  const P = opts.partners ?? {};
  const R: VatBookOutRow[] = [];
  type G = [number | 'exp' | 'a32', number, number];
  const add = (o: { date: string; no: string; name: string; edb: string; note?: string; g: G[] }) => {
    const c = { b18: 0, v18: 0, b10: 0, v10: 0, b5: 0, v5: 0, b0: 0, exp: 0, a32: 0 };
    for (const [rt, bb, vv] of o.g) {
      if (rt === 'a32') c.a32 += bb;
      else if (rt === 'exp') c.exp += bb;
      else if (!rt) c.b0 += bb;
      else if (rt === 18 || rt === 10 || rt === 5) { c[BK[rt]] += bb; c[VK[rt]] += vv; }
    }
    const tot = c.b18 + c.v18 + c.b10 + c.v10 + c.b5 + c.v5 + c.b0 + c.exp + c.a32;
    R.push({
      date: o.date, no: o.no, name: o.name, edb: o.edb, note: o.note ?? '',
      b18: toD(c.b18), v18: toD(c.v18), b10: toD(c.b10), v10: toD(c.v10), b5: toD(c.b5), v5: toD(c.v5), b0: toD(c.b0), exp: toD(c.exp), a32: toD(c.a32), tot: toD(tot),
    });
  };
  const invs = docs.invoices ?? [];
  const byId = new Map(invs.map((i) => [i.id, i]));
  const tour = new Map<InvoiceDoc, TravelMarginLine>();
  if (ctx.firm.ddv && invs.some((i) => i.tourM)) {
    for (const l of travelMarginOf(invs.filter((i) => inRange(i, from, to)), ctx, opts.travel).L) tour.set(l.invoice, l);
  }
  const rate = opts.travel?.rate ?? TRAVEL_MARGIN_RATE;
  for (const inv of invs) {
    if (inv.pend || !inRange(inv, from, to)) continue;
    const p = (inv.partner && P[inv.partner]) || {};
    const note = inv.credit ? 'Одобрение' + (inv.refInv ? ' кон ' + (byId.get(inv.refInv)?.number ?? '') : '') : inv.advance ? 'Аванс' : '';
    if (inv.tourM) {
      const t = tour.get(inv);
      if (!t) continue;
      const mg = toC(t.mg), own = toC(t.own);
      const mv = rh((mg * rate) / (100 + rate)), ov = rh((own * rate) / (100 + rate));
      add({ date: inv.date, no: inv.number ?? '', name: p.name ?? '', edb: p.edb ?? '', note: (note ? note + ' · ' : '') + 'Маржа (чл. 38)', g: [[rate === 18 || rate === 10 || rate === 5 ? rate : 18, mg - mv + own - ov, mv + ov]] });
      continue;
    }
    const c = calcLines(inv.items, inv.art32, { nonVat });
    const sg = inv.credit ? -1 : 1;
    const g: G[] = [];
    if (inv.art32) g.push(['a32', sg * toC(c.base), 0]);
    else for (const x of c.by) {
      if (x.rate === 0 && isPassThroughAccount(x.konto)) continue;
      const exp = inv.zeroKind ? inv.zeroKind === 'export' : !!inv.export;
      g.push([x.rate === 0 ? (exp ? 'exp' : 0) : x.rate, sg * toC(x.base), sg * toC(x.vat)]);
    }
    if (!inv.credit && !inv.advance && !inv.art32) for (const x of advDeduct(inv.advances, { nonVat }).by) g.push([x.rate || 0, -toC(x.base), -toC(x.vat)]);
    add({ date: inv.date, no: inv.number ?? '', name: p.name ?? '', edb: p.edb ?? '', g, note });
  }
  for (const s of docs.sales ?? []) {
    if (s.pend || !inRange(s, from, to)) continue;
    add({ date: s.date, no: s.number || 'ДФИ ' + dmy(s.date), name: 'Готовинска продажба (каса)', edb: '', g: (s.groups ?? []).map((x) => [n0(x.rate), toC(x.base), toC(x.vat)] as G) });
  }
  return bookSort(R);
}

/**
 * Input VAT book (КПФ) between two dates inclusive (legacy `dkIn`, 8884).
 * FIX (LEGACY-MAP 5.4 item 6): purchases with `noDed` (travel prior services) go entirely to the
 * "no right of deduction" column, matching ДДВ-04 (legacy listed their VAT as deductible).
 * FIX: pending cash vouchers / supplier credits are skipped (see `ddvFor`).
 */
export function vatBookIn(docs: VatDocuments, from: string, to: string, ctx: VatContext, opts: VatBookOptions = {}): VatBookInRow[] {
  const P = opts.partners ?? {};
  const R: VatBookInRow[] = [];
  const mk = () => ({ b18: 0, v18: 0, b10: 0, v10: 0, b5: 0, v5: 0, ib: 0, iv: 0, ab: 0, av: 0, nd: 0 });
  type Acc = ReturnType<typeof mk>;
  const isR = (r: number): r is 18 | 10 | 5 => r === 18 || r === 10 || r === 5;
  const fin = (h: { date: string; no: string; name: string; edb: string; note: string }, c: Acc) => {
    const tot = c.b18 + c.v18 + c.b10 + c.v10 + c.b5 + c.v5 + c.ib + c.iv + c.ab + c.nd;
    if (!tot && !c.av) return;
    const o = {} as Record<keyof Acc, number>;
    for (const k of Object.keys(c) as (keyof Acc)[]) o[k] = toD(c[k]);
    R.push({ ...h, ...o, tot: toD(tot) });
  };
  for (const p of docs.purchases ?? []) {
    if (p.pend || !inRange(p, from, to)) continue;
    const pp = (p.partner && P[p.partner]) || {};
    const c = mk();
    for (const cs of costsOf(p)) for (const l of cs.o.lines ?? []) {
      const bb = toC(l?.base), vv = toC(l?.vat);
      if (!bb && !vv) continue;
      const rt = n0(l?.rate) || 18;
      if (p.noDed) c.nd += bb + vv;
      else if (cs.k === 'car') { c.ib += bb; c.iv += vv; }
      else if (isR(rt)) { c[BK[rt]] += bb; c[VK[rt]] += vv; }
      else c.nd += bb + vv;
    }
    if (!p.imp) for (const g of p.groups ?? []) {
      const bb = toC(g.base), vv = toC(g.vat), rt = n0(g.rate);
      if (p.noDed) c.nd += bb + (p.art32 ? 0 : vv);
      else if (p.art32) { c.ab += bb; c.av += rh((bb * (rt || 18)) / 100); }
      else if (vv && isR(rt)) { c[BK[rt]] += bb; c[VK[rt]] += vv; }
      else c.nd += bb + vv;
    }
    fin({ date: p.date, no: p.number ?? '', name: pp.name || p.supplierName || '', edb: pp.edb ?? '', note: p.imp ? 'Увоз' : p.cash ? 'Готовина' : '' }, c);
  }
  for (const x of docs.cashVouchers ?? []) {
    if (x.pend || !inRange(x, from, to)) continue;
    const k = blgCalc(x, ctx);
    if (!(k.ded && k.vat)) continue;
    const rt = n0(x.rate);
    const c = mk();
    if (isR(rt)) { c[BK[rt]] += toC(k.base); c[VK[rt]] += toC(k.vat); }
    fin({ date: x.date, no: x.docNo || x.number || '', name: x.merchant || x.note || 'Фискална сметка', edb: '', note: 'Благајна' }, c);
  }
  for (const x of docs.supplierCredits ?? []) {
    if (x.pend || !inRange(x, from, to)) continue;
    const k = scrCalc(x, ctx);
    const pp = (x.partner && P[x.partner]) || {};
    const c = mk();
    for (const g of k.by) {
      if (g.v && vatAccount(ctx, 'in', g.rate) && isR(g.rate)) { c[BK[g.rate]] -= g.b * 100; c[VK[g.rate]] -= g.v * 100; }
      else c.nd -= (g.b + g.v) * 100;
    }
    fin({ date: x.date, no: (x.kind !== 'ret' && x.supNo) || x.number || '', name: pp.name ?? '', edb: pp.edb ?? '', note: x.kind === 'ret' ? 'Повратница' : 'Одобрение од добавувач' }, c);
  }
  return bookSort(R);
}

/** Column totals of a VAT book (legacy `dkSum`, 8895). */
export function vatBookSum(rows: readonly (VatBookOutRow | VatBookInRow)[], kind: 'out' | 'in'): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k] of VAT_BOOK_COLUMNS[kind]) o[k] = toD(rows.reduce((s, r) => s + toC((r as unknown as Record<string, number>)[k]), 0));
  return o;
}
