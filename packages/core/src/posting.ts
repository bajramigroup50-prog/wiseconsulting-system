/**
 * Posting schemes and document → journal-line posting, ported from legacy `index.html`.
 *
 * Final effective legacy versions ported (LEGACY-MAP C.3, C.4, Phases 3/4/7):
 * - `SCH0` / `SCH_OLD` / `sch` / `schOn` (3174–3177) → `schemeValue` / `schemeOn` (see FIX below)
 * - `STOCK_K` / `rk` / `stockK` / `retailOn` (3178–3182) → `locationAccounts`
 * - `revByRate` (3347), `posL` (3181), `vatKset` (3355), `roundL` (3356)
 * - `invoiceEntries` (3348)
 * - `purchaseEntries` (3354) → `purRound` (4387) → `purchaseEntries0` (3357 wrapped by 11993: `noDed`)
 * - `bankEntries` (3384 wrapped by 12760: FX side of a currency conversion posts nothing)
 * - `saleEntries` (3392)
 * - `blgEntries` (6518) with `blgKonto` (6515)
 * - `fiskEntries` (11354 → 13070 POS partner → 13093 `fisk.sc` schemes, `FK_SC` 13090)
 * - `kompEntries` (8924), `scrEntries` (8768)
 * - `ddvCloseLines` (3524) → `vatCloseEntries` (pure: takes the period's ledger lines)
 *
 * Every function returns balanced `JournalLine`s (debit total = credit total) in denars with two
 * decimals. Amounts are accumulated as integer cents; see vat.ts for the rounding contract.
 * Deliberate fixes of legacy bugs are marked `FIX:`.
 *
 * Not ported here (ledger concerns, owned by ledger.ts): credit-note storno mode (`stornoOn`/`stF`),
 * configurable extra lines (`extraLines`), side flips (`sideFlips`), off-balance VAT-base lines
 * (`vbLines`), per-line correction overlays (`ed`/`edAdd`).
 */
import { r2 } from './money';
import { FISCAL_SCHEMES, CASH_EXPENSE_CATEGORIES, REV_RATE_KEYS, SCH0, SCH_EXTRA, SCH_OLD } from './data/posting';
import {
  advDeduct, blgCalc, calcLines, costsOf, scrCalc, vatAccount, vatAccounts,
  type AdvanceDeduction, type VatAccountMap,
} from './vat';

export { CASH_EXPENSE_CATEGORIES, FISCAL_SCHEMES, PURCHASE_COST_SLOTS, REV_RATE_KEYS, SCH0, SCH_EXTRA, SCH_OLD } from './data/posting';

/* ------------------------------------------------------------------ output */

/** One journal line. `debit`/`credit` in denars (2 decimals), never both non-zero. */
export interface JournalLine {
  account: string;
  partnerId?: string;
  debit: number;
  credit: number;
  /** Currency of `amtCur` (legacy `dd`/`dp`). */
  cur?: string;
  /** Amount in foreign currency. */
  amtCur?: number;
  note?: string;
  /** VAT base for a VAT line (legacy `vb`) — feeds the VAT books / off-balance base lines. */
  vatBase?: number;
  /** Referenced document number (legacy `doc`, compensations). */
  doc?: string;
}

/* ------------------------------------------------------------------ money helpers (private) */

const n0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const rh = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));
const toC = (x: unknown): number => Math.round(r2(n0(x)) * 100);
const toD = (c: number): number => (c === 0 ? 0 : c / 100);
/** Round integer cents to whole denars (legacy `Math.round` on denars). */
const wholeC = (c: number): number => rh(c / 100) * 100;

/** Internal line: d/p/vb in integer cents. */
interface IL { k: string; d: number; p: number; partner?: string; note?: string; vb?: number; doc?: string; cur?: string; amtCur?: number }

function out(L: readonly IL[]): JournalLine[] {
  return L.filter((l) => l.d || l.p).map((l) => {
    const j: JournalLine = { account: String(l.k), debit: toD(l.d), credit: toD(l.p) };
    if (l.partner) j.partnerId = l.partner;
    if (l.cur) j.cur = l.cur;
    if (l.amtCur != null) j.amtCur = l.amtCur;
    if (l.note) j.note = l.note;
    if (l.vb != null) j.vatBase = toD(l.vb);
    if (l.doc) j.doc = l.doc;
    return j;
  });
}

/** Debit − credit of a set of lines, in denars (0 when balanced). */
export function journalDifference(lines: readonly JournalLine[]): number {
  return toD(lines.reduce((s, l) => s + toC(l.debit) - toC(l.credit), 0));
}
export const isBalanced = (lines: readonly JournalLine[]): boolean => journalDifference(lines) === 0;

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

/* ------------------------------------------------------------------ scheme resolution */

export type SchemeKey = keyof typeof SCH0 | keyof typeof SCH_EXTRA;
export type SchemeMap = Partial<Record<SchemeKey | string, string | boolean | null>>;

/** Scheme overrides, per firm (`firm.sch`, …) or global (`appsettings/schemes`). */
export interface SchemeSettings {
  sch?: SchemeMap | null;
  vatOut?: VatAccountMap | null;
  vatIn?: VatAccountMap | null;
  vatImp?: VatAccountMap | null;
}
export interface FirmPostingSettings extends SchemeSettings {
  /** VAT-registered firm. */
  ddv?: boolean | null;
  /** One input-VAT konto for all rates. */
  vatInKonto?: string | null;
  /** Card receivables konto for POS / fiscal card payments (legacy `firm.posK`). */
  posK?: string | null;
  /** Partner id of the "POS терминал" partner (legacy `posPid()`); set on 12x card lines. */
  posPartnerId?: string | null;
}
/** Everything posting needs to know about the firm and office-wide settings. */
export interface PostingContext {
  firm: FirmPostingSettings;
  global?: SchemeSettings | null;
}

const DEFAULT_SCHEME: Readonly<Record<string, string | boolean>> = { ...SCH0, ...SCH_EXTRA };
const setVal = (v: unknown): v is string | boolean => v !== undefined && v !== null && v !== '';

/**
 * Raw scheme value: firm → global → default (legacy `sch`, 3177).
 *
 * FIX (LEGACY-MAP 2.4 item 2 / top-fix #8): legacy treated a stored value equal to `SCH_OLD[k]`
 * as unset, so users could not choose e.g. `advance='2270'` or `ddvPay='2300'`. Explicit values
 * are honoured now; run `migrateLegacyScheme` on legacy `sch` objects once at import.
 */
export function schemeRaw(ctx: PostingContext, key: SchemeKey | string): string | boolean | undefined {
  const f = ctx.firm.sch?.[key];
  if (setVal(f)) return f;
  const g = ctx.global?.sch?.[key];
  if (setVal(g)) return g;
  return DEFAULT_SCHEME[key];
}
/** Scheme konto for a role key ('' when unset or a boolean flag is false). */
export function schemeValue(ctx: PostingContext, key: SchemeKey | string): string {
  const v = schemeRaw(ctx, key);
  return typeof v === 'string' ? v : v ? 'true' : '';
}
/** Role is configured and not switched off with '-' (legacy `schOn`). */
export function schemeOn(ctx: PostingContext, key: SchemeKey | string): boolean {
  const v = schemeRaw(ctx, key);
  return !!v && v !== '-';
}

/** Drop stored values equal to the old defaults (`SCH_OLD`) — the import-time equivalent of legacy `sch()` skipping them. */
export function migrateLegacyScheme(sch: SchemeMap | null | undefined): SchemeMap {
  const o: SchemeMap = {};
  for (const [k, v] of Object.entries(sch ?? {})) {
    if (v === (SCH_OLD as Record<string, string>)[k]) continue;
    o[k] = v;
  }
  return o;
}

/** All VAT kontos incl. art. 32-a (legacy `vatKset`). */
export function vatAccountSet(ctx: PostingContext): Set<string> {
  const s = vatAccounts(ctx);
  for (const k of ['r32out', 'r32in']) {
    const v = schemeValue(ctx, k);
    if (v) s.add(v);
  }
  return s;
}

/** Revenue konto → per-rate sub-konto when configured (legacy `revByRate`, 3347). */
export function revByRate(ctx: PostingContext, k: string, rate: number | string): string {
  if (!k || !n0(rate)) return k;
  for (const b of REV_RATE_KEYS) {
    if (schemeValue(ctx, b) === k) {
      const kk = `${b}_${n0(rate)}`;
      return schemeOn(ctx, kk) ? schemeValue(ctx, kk) : k;
    }
  }
  return k;
}

export type ItemType = 'service' | 'goods' | 'material' | 'product';

/** Stock konto per item type (legacy `STOCK_K`). */
export function stockAccount(ctx: PostingContext, type: ItemType): string | undefined {
  if (type === 'material') return schemeValue(ctx, 'material');
  if (type === 'product') return schemeValue(ctx, 'product');
  if (type === 'goods') return schemeValue(ctx, 'stock');
  return undefined;
}

/** A warehouse or store (legacy codes rows `cb:'warehouse'|'store'`); `undefined` = the main warehouse. */
export interface StockLocation {
  kind: 'warehouse' | 'store';
  /** Stock konto override. */
  konto?: string | null;
  /** Margin konto override. */
  kMarg?: string | null;
  /** Retail VAT konto override. */
  kVat?: string | null;
}
export interface LocationAccounts {
  /** Stock kept at retail price (legacy `retailOn`). */
  retail: boolean;
  /** Stock / margin / VAT kontos for the retail method (legacy `rk(w,'Stock'|'Marg'|'Vat')`). */
  stock: string;
  marg: string;
  vat: string;
  /** Goods stock konto at cost (legacy `stockK(w,{type:'goods'})`). */
  goodsStock: string;
}

/** Kontos of a location (legacy `retailOn`, `rk`, `stockK`, 3182). */
export function locationAccounts(ctx: PostingContext, loc?: StockLocation | null): LocationAccounts {
  const store = loc?.kind === 'store';
  const ov = (v: string | null | undefined) => String(v ?? '').trim();
  const rk = (key: 'Stock' | 'Marg' | 'Vat', o: string) => ov(o) || schemeValue(ctx, (store ? 'retail' : 'wh') + key);
  return {
    retail: store ? schemeOn(ctx, 'retailMethod') : schemeOn(ctx, 'whSaleMethod'),
    stock: rk('Stock', loc?.konto ?? ''),
    marg: rk('Marg', loc?.kMarg ?? ''),
    vat: rk('Vat', loc?.kVat ?? ''),
    goodsStock: ov(loc?.konto) || schemeValue(ctx, 'stock') || '6600',
  };
}

const vatOutOrThrow = (ctx: PostingContext, rate: number): string => {
  const k = vatAccount(ctx, 'out', rate);
  if (!k) throw new PostingError(`ДДВ стапка ${rate}% нема конто за излезен ДДВ`);
  return k;
};

/** Legacy `posL`: a negative debit becomes a credit and vice versa; zero lines dropped. */
function posL(L: IL[]): IL[] {
  return L.map((l) => {
    let d = l.d, p = l.p;
    if (d < 0) { p -= d; d = 0; }
    if (p < 0) { d -= p; p = 0; }
    return { ...l, d, p };
  }).filter((l) => l.d || l.p);
}

const stableMaxBy = <T>(xs: T[], f: (x: T) => number): T | undefined => {
  let best: T | undefined;
  for (const x of xs) if (best === undefined || f(x) > f(best)) best = x;
  return best;
};

/**
 * Round lines to whole denars and push the rounding difference to one line (legacy `roundL`, 3356):
 * a surplus goes to the largest credit that is neither a partner nor a VAT line, a shortfall to the
 * largest debit that is not class 13 / VAT.
 */
function roundL(M: IL[], ctx: PostingContext): IL[] {
  for (const l of M) {
    l.d = wholeC(l.d);
    l.p = wholeC(l.p);
    if (l.vb != null) l.vb = wholeC(l.vb);
  }
  const diff = M.reduce((s, l) => s + l.d - l.p, 0);
  const VK = vatAccountSet(ctx);
  if (diff) {
    const t = diff > 0
      ? stableMaxBy(M.filter((l) => l.p && !l.partner && !VK.has(String(l.k))), (l) => l.p) ?? stableMaxBy(M.filter((l) => l.p), (l) => l.p)
      : stableMaxBy(M.filter((l) => l.d && !/^13/.test(l.k) && !VK.has(String(l.k))), (l) => l.d);
    if (t) {
      if (diff > 0) t.p += diff;
      else t.d -= diff;
    } else {
      const x = stableMaxBy(M.filter((l) => l.d), (l) => l.d);
      if (x) x.d -= diff;
    }
  }
  return M.filter((l) => l.d || l.p);
}

/* ------------------------------------------------------------------ invoices */

export interface InvoiceItem {
  name?: string;
  itemId?: string;
  unit?: string;
  qty: number | string;
  /** Net unit price. */
  price: number | string;
  /** Discount %. */
  disc?: number | string;
  rate?: number | string;
  /** Revenue konto. */
  konto?: string;
}

/** How a zero-rated sale is reported on ДДВ-04 (new; legacy only knew `export`). */
export type ZeroRateKind = 'export' | 'exempt' | 'exemptNoDed' | 'nonResident';

/** Outgoing invoice / credit note / advance invoice (`invoices`). */
export interface InvoiceDoc {
  id?: string;
  date: string;
  number?: string;
  partner?: string;
  items: InvoiceItem[];
  /** Domestic reverse charge (чл. 32-а): no VAT charged. */
  art32?: boolean;
  /** Credit note: every line is posted on the opposite side. */
  credit?: boolean;
  /** Advance invoice: revenue goes to the advances konto. */
  advance?: boolean;
  export?: boolean;
  zeroKind?: ZeroRateKind;
  /** Travel-agency margin scheme (чл. 38). */
  tourM?: boolean;
  /** Travel arrangement the invoice belongs to (resolved from legacy `tbookId` → booking → `arr`). */
  arrangementId?: string;
  /** Credit note → original invoice id. */
  refInv?: string;
  /** Advance invoices deducted on this invoice (legacy `advances` map resolved to the advance invoices). */
  advances?: AdvanceDeduction[];
  /** Client-submitted, not yet approved: never posted or reported. */
  pend?: boolean;
}

const NOTE_ADV = 'Одбиен аванс';

/**
 * Invoice posting (legacy `invoiceEntries`, 3348): D customer / P revenue (per-rate sub-kontos,
 * `…0` kontos for zero-rated revenue) / P output VAT; advance invoices credit the advances konto;
 * used advances are reversed; credit notes flip every line.
 *
 * FIX: a VAT amount on a rate without an output-VAT konto throws `PostingError` (legacy silently
 * dropped the VAT line and posted an unbalanced journal).
 */
export function invoiceEntries(inv: InvoiceDoc, ctx: PostingContext): JournalLine[] {
  const nonVat = ctx.firm.ddv === false;
  const opts = { nonVat, defaultKonto: schemeValue(ctx, 'revDefault') };
  const c = calcLines(inv.items, inv.art32, opts);
  const L: IL[] = [{ k: schemeValue(ctx, 'customer'), d: toC(c.total), p: 0, partner: inv.partner }];
  const m0: Record<string, string> = {};
  for (const [rev, zero] of [['revGoods', 'revGoods0'], ['revService', 'revService0'], ['revProduct', 'revProduct0']] as const) {
    m0[schemeValue(ctx, rev)] = schemeOn(ctx, zero) ? schemeValue(ctx, zero) : '';
  }
  for (const g of c.by) {
    const k = inv.advance ? schemeValue(ctx, 'advance') : (!g.vat && !inv.art32 && m0[g.konto]) || (g.vat ? revByRate(ctx, g.konto, g.rate) : g.konto);
    L.push({ k, d: 0, p: toC(g.base) });
    if (g.vat) L.push({ k: vatOutOrThrow(ctx, g.rate), d: 0, p: toC(g.vat), vb: toC(g.base) });
  }
  if (!inv.credit && !inv.advance) {
    const A = advDeduct(inv.advances, opts);
    if (A.total) {
      L.push({ k: schemeValue(ctx, 'advance'), d: toC(A.base), p: 0, note: NOTE_ADV });
      for (const g of A.by) if (g.vat) L.push({ k: vatOutOrThrow(ctx, g.rate), d: toC(g.vat), p: 0, vb: toC(g.base), note: 'ДДВ на одбиен аванс' });
      L.push({ k: schemeValue(ctx, 'customer'), d: 0, p: toC(A.total), partner: inv.partner, note: NOTE_ADV });
    }
  }
  return out(inv.credit ? L.map((l) => ({ ...l, d: l.p, p: l.d })) : L);
}

/* ------------------------------------------------------------------ purchases */

export interface PurchaseGroup {
  /** Cost / stock konto. */
  konto?: string;
  rate: number | string;
  base: number | string;
  vat: number | string;
}
export type PurchaseCostKey = 'car' | 't1' | 't2' | 'sped' | 'trans' | 'dr' | 'dev';
export interface CostLine { base?: number | string; rate?: number | string; vat?: number | string }
/** A landed cost (customs, forwarding, transport…) with its own supplier document. */
export interface CostSlot {
  /** Amount without VAT (in currency for `dev`). */
  amt?: number | string;
  /** Exchange rate (only `dev`). */
  fx?: number | string;
  doc?: string;
  date?: string;
  due?: string;
  partner?: string;
  /** Transport allocated by quantity (stock allocation; not used by posting). */
  byQty?: boolean;
  /** Up to three VAT lines of the cost document. */
  lines?: (CostLine | null | undefined)[];
}
export interface PurchaseStockLine {
  item?: string;
  name?: string;
  qty: number | string;
  /** Unit price (in currency for imports). */
  price: number | string;
  /** Discount %. */
  rab?: number | string;
  /** Item type (legacy `stType`: line type → item type → 'goods'); resolved by the caller. */
  type?: ItemType;
}
/** Incoming invoice / import calculation (`purchases`). */
export interface PurchaseDoc {
  id?: string;
  date: string;
  number?: string;
  partner?: string;
  supplierName?: string;
  groups: PurchaseGroup[];
  /** Domestic reverse charge (чл. 32-а): recipient calculates VAT. */
  art32?: boolean;
  /** Received from a non-resident (чл. 32 т. 4/5) — together with `art32`, reported in ДДВ-04 fields 12–15/23/24 (new). */
  nonResident?: boolean;
  /** Import: VAT on import kontos, supplier on `supKonto`/`supplierFx`, stock valued × fx. */
  imp?: boolean;
  /** Paid in cash (fiscal receipt) — credit cash instead of the supplier. */
  cash?: boolean;
  /** No input-VAT deduction (travel prior services, чл. 38 ст. 4). */
  noDed?: boolean;
  supKonto?: string;
  fx?: number | string;
  costs?: Partial<Record<PurchaseCostKey, CostSlot | null>>;
  stock?: PurchaseStockLine[];
  /** Warehouse/store id (resolve with `locationAccounts`). */
  wh?: string;
  /**
   * Retail margin and retail VAT of the received goods when the location uses the retail method
   * (legacy `calcRows`: Σ marg, Σ vat over goods lines). Computed by stock.ts; required for retail posting.
   */
  retail?: { margin: number; vat: number };
  pend?: boolean;
}

/** Stock value of a purchase line (legacy `stVal`): qty × price × (1 − rab%) × (fx for imports). */
export const stockLineValue = (p: Pick<PurchaseDoc, 'imp' | 'fx'>, s: PurchaseStockLine): number =>
  r2(n0(s.qty) * n0(s.price) * (1 - n0(s.rab) / 100) * (p.imp ? n0(p.fx) : 1));

/** Integer rounding of groups and costs before posting (legacy `purRound`, 4387). */
export function purRound<T extends PurchaseDoc>(p: T): T {
  const groups = (p.groups ?? []).map((g) => {
    const V = p.art32 ? 0 : rh(n0(g.vat));
    const T = rh(n0(g.base) + (p.art32 ? 0 : n0(g.vat)));
    return { ...g, rate: n0(g.rate), base: T - V, vat: V };
  });
  let costs = p.costs;
  if (p.costs) {
    const C: Partial<Record<PurchaseCostKey, CostSlot | null>> = {};
    for (const [k, o] of Object.entries(p.costs) as [PurchaseCostKey, CostSlot | null][]) {
      if (!o) { C[k] = o; continue; }
      C[k] = {
        ...o,
        ...(k === 'dev' ? {} : { amt: rh(n0(o.amt)) }),
        lines: (o.lines ?? []).map((l) => (l ? { ...l, base: rh(n0(l.base)), vat: rh(n0(l.vat)) } : l)),
      };
    }
    costs = C;
  }
  return { ...p, groups, costs };
}

function purchaseEntries0(p: PurchaseDoc, ddvFirm: boolean, ctx: PostingContext, loc: StockLocation | null | undefined): IL[] {
  const S = (k: string) => schemeValue(ctx, k);
  const def = S('purDefault');
  const L: IL[] = [];
  let tot = 0;
  for (const g of p.groups ?? []) {
    const base = toC(g.base), vat = toC(g.vat);
    const vin = vatAccount(ctx, 'in', g.rate);
    if (p.art32) {
      const v = rh((base * (n0(g.rate) || 18)) / 100);
      // FIX (LEGACY-MAP 3.4 item 3): legacy defaulted art. 32-a groups to '4100' (rail transport services); now the common purchase default.
      L.push({ k: g.konto || def, d: base, p: 0 });
      if (ddvFirm) L.push({ k: S('r32in'), d: v, p: 0 }, { k: S('r32out'), d: 0, p: v });
      tot += base;
    } else if (ddvFirm && vat && vin) {
      L.push({ k: g.konto || def, d: base, p: 0 }, { k: (p.imp && vatAccount(ctx, 'imp', g.rate)) || vin, d: vat, p: 0, vb: base });
      tot += base + vat;
    } else if (vat && schemeOn(ctx, 'vatNoDed')) {
      L.push({ k: g.konto || def, d: base, p: 0 }, { k: S('vatNoDed'), d: vat, p: 0 });
      tot += base + vat;
    } else {
      L.push({ k: g.konto || def, d: base + vat, p: 0 });
      tot += base + vat;
    }
  }
  L.push(p.cash
    ? { k: S('cash'), d: 0, p: tot, partner: p.partner || '', note: 'Готовина' + (p.number ? ' – фиск. сметка ' + p.number : '') }
    : { k: p.imp ? p.supKonto || S('supplierFx') : S('supplier'), d: 0, p: tot, partner: p.partner });
  const stock = p.stock ?? [];
  const gk = (p.groups ?? []).find((g) => /^[36]/.test(g.konto || ''))?.konto || (stock.length ? S('stock') : p.groups?.[0]?.konto || def);
  for (const c of costsOf(p)) {
    const amt = toC(c.amt);
    if (amt) L.push({ k: gk, d: amt, p: 0, note: c.n });
    let v = 0;
    for (const l of c.o.lines ?? []) {
      const lv = toC(l?.vat);
      if (!lv) continue;
      const rate = n0(l?.rate) || 18;
      // FIX (LEGACY-MAP 3.4 item 4): legacy fell back to summary konto '1300' (in VAT_BAD) for a rate
      // without an input-VAT konto; such VAT is now not deductible and is capitalised into the cost konto.
      const k = ddvFirm ? (c.k === 'car' ? vatAccount(ctx, 'imp', rate) : undefined) || vatAccount(ctx, 'in', rate) : undefined;
      L.push(k ? { k, d: lv, p: 0, note: 'ДДВ ' + c.n, vb: toC(l?.base) } : { k: gk, d: lv, p: 0, note: 'ДДВ ' + c.n });
      v += lv;
    }
    if (amt + v) L.push({ k: S('supplier'), d: 0, p: amt + v, partner: c.o.partner || '', note: c.n + (c.o.doc ? ' ' + c.o.doc : '') });
  }
  const LA = locationAccounts(ctx, loc);
  if (stock.length) {
    const SK = new Set([S('stock'), S('material'), S('product'), '6600', '660', '3100', '3000', '6630', LA.stock, LA.goodsStock].filter(Boolean));
    const byT = new Map<ItemType, number>();
    let tv = 0;
    for (const s of stock) {
      const v = toC(stockLineValue(p, s));
      if (!v) continue;
      const t = s.type || 'goods';
      byT.set(t, (byT.get(t) ?? 0) + v);
      tv += v;
    }
    const T = [...byT.keys()];
    if (T.length && tv) {
      const nk = (t: ItemType) => (t === 'material' ? S('material') || '3100' : t === 'product' ? S('product') || '6300' : LA.retail ? S('stock') : LA.goodsStock);
      const o: IL[] = [];
      for (const l of L) {
        if (!(l.d > 0) || !(SK.has(String(l.k)) || /^(3[01]|66)/.test(String(l.k))) || l.partner) { o.push(l); continue; }
        if (T.length === 1) { o.push({ ...l, k: nk(T[0]!) }); continue; }
        let rest = l.d;
        T.forEach((t, i) => {
          const a = i === T.length - 1 ? rest : rh((l.d * byT.get(t)!) / tv);
          rest -= a;
          if (a) o.push({ ...l, k: nk(t), d: a });
        });
      }
      L.length = 0;
      L.push(...o);
    }
  }
  if (stock.length && LA.retail) {
    const st = S('stock');
    for (const l of L) if (l.k === st || /^66/.test(l.k)) l.k = LA.stock;
    if (!p.retail) throw new PostingError('Набавка во продавница (малопродажен метод): потребни се маржа и ДДВ (retail) од калкулацијата');
    const mg = toC(p.retail.margin), vt = toC(p.retail.vat);
    if (mg || vt) L.push(...posL([{ k: LA.stock, d: mg + vt, p: 0 }, { k: LA.marg, d: 0, p: mg }, { k: LA.vat, d: 0, p: vt }]));
  }
  if (stock.length && !LA.retail) {
    const st = S('stock');
    if (LA.goodsStock !== st) for (const l of L) if (l.k === st) l.k = LA.goodsStock;
  }
  return L;
}

/**
 * Purchase posting (legacy `purchaseEntries` 3354 with `purchaseEntries0` 3357 + `noDed` patch 11993):
 * integer-rounded groups; D cost/stock + D input VAT (import VAT for imports, art. 32-a both sides,
 * `vatNoDed` when configured) / P supplier (or cash); landed costs D cost konto + VAT / P their
 * suppliers; stock lines re-kontoed by item type and location; retail method adds margin and retail
 * VAT; lines merged per konto/partner/note and rounded to whole denars.
 *
 * Input VAT is posted only for a VAT firm (`firm.ddv`) and not for `noDed` purchases.
 */
export function purchaseEntries(p: PurchaseDoc, ctx: PostingContext, loc?: StockLocation | null): JournalLine[] {
  const ddvFirm = !!ctx.firm.ddv && !p.noDed;
  const L0 = purchaseEntries0(purRound(p), ddvFirm, ctx, loc);
  const M: IL[] = [];
  for (const l of L0) {
    const k = M.find((x) => x.k === l.k && (x.partner || '') === (l.partner || '') && !x.note === !l.note && (!l.note || x.note === l.note));
    if (k) {
      k.d += l.d;
      k.p += l.p;
      if (l.vb != null || k.vb != null) k.vb = (k.vb ?? 0) + (l.vb ?? 0);
    } else M.push({ ...l });
  }
  return out(roundL(M, ctx));
}

/* ------------------------------------------------------------------ bank */

/** A bank statement line (`bank`). `amount` in denars, positive = inflow. */
export interface BankTxn {
  id?: string;
  date?: string;
  amount: number | string;
  /** Counter konto; empty = customer (inflow) / supplier (outflow). */
  konto?: string;
  partner?: string;
  /** Linked document (invoice/purchase); `settle` is only honoured when set. */
  ref?: { type: string; id: string; label?: string } | null;
  /** Amount that settles the linked document; the difference is an FX gain/loss. */
  settle?: number | string | null;
  /** Outflow split over kontos (e.g. a salary payment); remainder → `pay_net`. */
  split?: { k: string; a: number | string; n?: string }[];
  /** Currency purchase/sale (откуп). */
  conv?: boolean;
}
/** The bank account of the statement (legacy `firm.banks[]`). */
export interface BankAccountInfo { konto?: string | null; cur?: string | null }

/**
 * Bank line posting (legacy `bankEntries` 3384 + 12760).
 * FIX (LEGACY-MAP C.4): the default counter kontos come from the scheme (`customer`/`supplier`)
 * instead of the literals '1200'/'2200' — identical for the default scheme.
 */
export function bankEntries(b: BankTxn, ctx: PostingContext, account: BankAccountInfo = {}): JournalLine[] {
  const bk = account.konto || schemeValue(ctx, 'bank');
  // FX side of a currency conversion: the MKD statement carries the amount (patch 12760).
  if (b.conv && (account.cur || 'MKD') !== 'MKD' && String(b.konto) === String(account.konto || '')) return [];
  const amount = n0(b.amount);
  const a = Math.abs(toC(amount));
  if (!a) return [];
  const other = b.konto || schemeValue(ctx, amount >= 0 ? 'customer' : 'supplier');
  if (b.split && b.split.length && amount < 0) {
    const L: IL[] = b.split.filter((x) => n0(x.a)).map((x) => ({ k: x.k, d: toC(x.a), p: 0, note: x.n || '' }));
    const t = L.reduce((s, l) => s + l.d, 0);
    if (t !== a) L.push({ k: schemeValue(ctx, 'pay_net'), d: a - t, p: 0 });
    L.push({ k: bk, d: 0, p: a });
    return out(posL(L));
  }
  const st = b.ref && b.settle != null ? toC(b.settle) : a;
  const diff = a - st;
  const gain = schemeValue(ctx, 'fxGain'), loss = schemeValue(ctx, 'fxLoss');
  const L: IL[] = [];
  if (amount >= 0) {
    L.push({ k: bk, d: a, p: 0 }, { k: other, d: 0, p: st, partner: b.partner });
    if (diff > 0) L.push({ k: gain, d: 0, p: diff });
    if (diff < 0) L.push({ k: loss, d: -diff, p: 0 });
  } else {
    L.push({ k: other, d: st, p: 0, partner: b.partner }, { k: bk, d: 0, p: a });
    if (diff > 0) L.push({ k: loss, d: diff, p: 0 });
    if (diff < 0) L.push({ k: gain, d: 0, p: -diff });
  }
  return out(L);
}

/* ------------------------------------------------------------------ retail / fiscal */

export interface SalesGroup { rate: number | string; konto?: string; base: number | string; vat: number | string }
export type FiscalSchemeKey = keyof typeof FISCAL_SCHEMES;
export interface FiscalInfo {
  device?: string;
  z?: string;
  /** Posting scheme (legacy `FK_SC`); absent = plain cash sale posting. */
  sc?: FiscalSchemeKey;
  cashK?: string;
  /** Revenue konto override. */
  rev?: string;
  nonVat?: boolean;
  /** Periodic report range. */
  from?: string;
  to?: string;
}
/** Daily cash / fiscal (Z) report (`sales`). */
export interface SalesDoc {
  id?: string;
  date: string;
  number?: string;
  wh?: string;
  /** Gross total. Defaults to Σ(base + vat). */
  total?: number | string;
  groups: SalesGroup[];
  /** Card payments within the total. */
  card?: number | string;
  cardKonto?: string;
  fisk?: FiscalInfo | null;
  pend?: boolean;
}

function saleLines(s: SalesDoc, ctx: PostingContext): IL[] {
  const def = schemeValue(ctx, 'revDefault');
  const groups = s.groups ?? [];
  const sum = groups.reduce((a, g) => a + toC(g.base) + toC(g.vat), 0);
  const total = s.total == null || s.total === '' ? sum : toC(s.total);
  const L: IL[] = [{ k: schemeValue(ctx, 'kasaCash'), d: total, p: 0 }];
  const rev: IL[] = [];
  for (const g of groups) {
    const vat = toC(g.vat);
    const r: IL = { k: vat ? revByRate(ctx, g.konto || def, g.rate) : g.konto || def, d: 0, p: toC(g.base) };
    L.push(r);
    rev.push(r);
    if (vat) L.push({ k: vatOutOrThrow(ctx, n0(g.rate)), d: 0, p: vat, vb: toC(g.base) });
  }
  // FIX: legacy debited `total` and credited Σ groups without reconciling them (unbalanced when the
  // Z report total differs from its groups by rounding). The difference now goes to the largest revenue line.
  const diff = total - sum;
  if (diff) {
    const t = stableMaxBy(rev, (l) => l.p);
    if (t) t.p += diff;
    else L.push({ k: def, d: 0, p: diff });
  }
  return L;
}

/** Cash sales day posting (legacy `saleEntries`, 3392): D cash register / P revenue / P output VAT. */
export function saleEntries(s: SalesDoc, ctx: PostingContext): JournalLine[] {
  return out(posL(saleLines(s, ctx)));
}

const CARD_NOTE = 'Плаќања со картичка';
const dmy = (d: string | undefined) => (d ? String(d).split('-').reverse().join('.') : '');

/** Legacy `fiskEntries` 11354 + 13070: cash sale posting with card payments moved to the card konto. */
function fiskBase(z: SalesDoc, ctx: PostingContext, posK: string): IL[] {
  const L = saleLines(z, ctx);
  const card = toC(z.card);
  if (card > 0 && L[0]) {
    L[0] = { ...L[0], d: L[0].d - card };
    L.splice(1, 0, { k: z.cardKonto || posK, d: card, p: 0, note: CARD_NOTE });
  }
  const pid = ctx.firm.posPartnerId;
  for (const l of L) if (l.note === CARD_NOTE && /^12/.test(String(l.k)) && !l.partner && pid) l.partner = pid;
  return L.filter((l) => l.d || l.p);
}

/**
 * Fiscal (Z / periodic) report posting (legacy `fiskEntries`, final 13093 with `FK_SC`):
 * - no scheme → cash-sale posting with card payments on the card konto (`posK`, POS partner);
 * - `usl` → D cash 1009 / D card / P output VAT / P 7414;
 * - `trgNoVat` → D cash / D card / P 7410 for the total, plus D retail margin 6694 / P retail stock 6630 (legacy: 6690);
 * - `trg` → D cash / D card / P revenue + VAT from the cash-sale posting (stock issue is a separate move).
 *
 * FIX: in `trg` legacy dropped the cash-sale debit by the literal konto '1020'; with a configured
 * `kasaCash` it stayed and the journal was double-debited. The scheme's cash konto is used now.
 */
export function fiskEntries(z: SalesDoc, ctx: PostingContext): JournalLine[] {
  const fk = z.fisk ?? {};
  const posK = ctx.firm.posK || schemeValue(ctx, 'posCard');
  if (!fk.sc) return out(fiskBase(z, ctx, posK));
  const tot = toC(z.total);
  const card = Math.min(tot, toC(z.card));
  const cash = tot - card;
  const ds = fk.from && fk.to && fk.from !== fk.to ? `ПЕР.ИЗВ ${dmy(fk.from)}–${dmy(fk.to)}` : `ДНЕВЕН ПРОМЕТ ${dmy(z.date)}`;
  const pid = ctx.firm.posPartnerId;
  const L: IL[] = [];
  if (cash) L.push({ k: fk.cashK || schemeValue(ctx, 'fiskCash'), d: cash, p: 0, note: ds });
  if (card) {
    const ck = z.cardKonto || posK;
    L.push({ k: ck, d: card, p: 0, note: CARD_NOTE, ...(pid && /^12/.test(String(ck)) ? { partner: pid } : {}) });
  }
  const G = (z.groups ?? []).filter((g) => n0(g.base) || n0(g.vat));
  const rev = fk.rev || FISCAL_SCHEMES[fk.sc]?.[1] || '7411';
  if (fk.sc === 'trgNoVat' || fk.nonVat || !G.length) {
    L.push({ k: rev, d: 0, p: tot, note: ds });
  } else {
    let rb = 0, vs = 0;
    for (const g of G) {
      const v = toC(g.vat);
      if (v) L.push({ k: vatAccount(ctx, 'out', g.rate) || vatOutOrThrow(ctx, 18), d: 0, p: v, note: ds, vb: toC(g.base) });
      rb += toC(g.base);
      vs += v;
    }
    const diff = tot - rb - vs;
    L.push({ k: rev, d: 0, p: rb + diff, note: ds });
  }
  if (fk.sc === 'trgNoVat') {
    // FIX (LEGACY-MAP §7.4 item 4): legacy hard-coded D 6690 / P 6630 here. The margin account is the retail margin
    // (`retailMarg`, 6694) like sales, transfers and levelling; `fiskMarg` / `fiskStock` stay as explicit overrides.
    const mk = schemeValue(ctx, 'fiskMarg') || schemeValue(ctx, 'retailMarg') || '6694';
    const sk = schemeValue(ctx, 'fiskStock') || schemeValue(ctx, 'retailStock') || '6630';
    L.push({ k: mk, d: tot, p: 0, note: ds }, { k: sk, d: 0, p: tot, note: ds });
  }
  if (fk.sc === 'trg') {
    const cashK = schemeValue(ctx, 'kasaCash');
    const O = fiskBase(z, ctx, posK).filter((l) => !(l.d && (String(l.k) === cashK || l.note === CARD_NOTE)));
    return out([...L.filter((l) => l.d), ...O]);
  }
  return out(L);
}

/* ------------------------------------------------------------------ cash register (благајна) */

/** Cash voucher (`docs.type='blg'`): `in` = receipt into the register, `out` = expense paid from it. */
export interface CashVoucher {
  id?: string;
  kind: 'in' | 'out';
  /** Register id. */
  reg?: string;
  date: string;
  /** У-nnn / И-nnn. */
  number?: string;
  /** Receipt number. */
  docNo?: string;
  merchant?: string;
  vatId?: string;
  /** ISO country of the merchant (VAT deductible only in MK). */
  country?: string;
  cur?: string;
  /** Amount in `cur`. */
  amt: number | string;
  fx?: number | string;
  rate?: number | string;
  /** VAT in `cur` (when printed on the receipt); empty = computed from the rate. */
  vat?: number | string | null;
  /** Expense category (see `CASH_EXPENSE_CATEGORIES`). */
  cat?: string;
  konto?: string;
  partner?: string;
  note?: string;
  /** Counter konto override for the register side. */
  payK?: string;
  pend?: boolean;
}
export interface CashRegisterInfo { konto: string; cur?: string }

/** Expense konto for a cash category: first candidate that exists in the chart (legacy `blgKonto`, 6515). */
export function cashExpenseAccount(cat: string | undefined, abroad: boolean, accountExists: (k: string) => boolean = () => true): string {
  let L = [...(CASH_EXPENSE_CATEGORIES[cat ?? ''] ?? CASH_EXPENSE_CATEGORIES.other!)[1]];
  if (abroad && cat === 'accommodation') L = ['44011', ...L];
  if (!abroad && cat === 'accommodation') L = ['44010', ...L];
  if (abroad && cat === 'transport') L = ['44021', ...L];
  return L.find((k) => accountExists(k)) ?? L[L.length - 1]!;
}

/**
 * Cash voucher posting (legacy `blgEntries`, 6518), whole denars.
 * in: D register / P konto (default `blgInOther` 1000). out: D expense / D input VAT / P register.
 * Foreign-currency vouchers carry the currency amount on the expense and register lines.
 */
export function blgEntries(x: CashVoucher, ctx: PostingContext, register: CashRegisterInfo, opts: { accountExists?: (k: string) => boolean } = {}): JournalLine[] {
  const c = blgCalc(x, ctx);
  const pk = x.payK || register.konto;
  const fxOn = !!c.fx && x.cur !== 'MKD' && !!c.mkd;
  const dv = (v: number) => (fxOn ? { cur: x.cur, amtCur: r2((n0(x.amt) * v) / c.mkd) } : {});
  const nt = (x.merchant || '') + (x.country && x.country !== 'MK' ? ` (${x.country})` : '');
  const C = (v: number) => v * 100;
  if (x.kind === 'in') {
    return out([
      { k: pk, d: C(c.mkd), p: 0, ...dv(c.mkd), note: x.note || nt },
      { k: x.konto || schemeValue(ctx, 'blgInOther'), d: 0, p: C(c.mkd), partner: x.partner || '', note: x.note || nt },
    ]);
  }
  const L: IL[] = [{ k: x.konto || cashExpenseAccount(x.cat, !!x.country && x.country !== 'MK', opts.accountExists), d: C(c.base), p: 0, ...dv(c.base), note: nt, partner: x.partner || '' }];
  if (c.vat) L.push({ k: vatAccount(ctx, 'in', x.rate ?? 0)!, d: C(c.vat), p: 0, vb: C(c.base), note: nt });
  L.push({ k: pk, d: 0, p: C(c.mkd), ...dv(c.mkd), note: nt, partner: x.partner || '' });
  return out(L);
}

/* ------------------------------------------------------------------ supplier returns / credits */

export interface SupplierCreditRow { item?: string; name?: string; qty: number | string; price: number | string; rate?: number | string; konto?: string }
/** Supplier return (`ret`) or price discount (`disc`) — `docs.type='supcr'`. */
export interface SupplierCreditDoc {
  id?: string;
  kind: 'ret' | 'disc';
  date: string;
  number?: string;
  /** Supplier's credit-note number. */
  supNo?: string;
  partner?: string;
  wh?: string;
  /** The original purchase (legacy `refPur` resolved): decides the supplier konto. */
  refPurchase?: Pick<PurchaseDoc, 'imp' | 'supKonto'> | null;
  rows: SupplierCreditRow[];
  pend?: boolean;
}

/**
 * Supplier return / credit posting (legacy `scrEntries`, 8768), whole denars:
 * D supplier (import supplier when the purchase was an import) / P stock (returns) or supplier
 * discount konto / P input VAT (reduction).
 */
export function scrEntries(d: SupplierCreditDoc, ctx: PostingContext, loc?: StockLocation | null): JournalLine[] {
  const c = scrCalc(d, ctx);
  const pur = d.refPurchase;
  const supK = pur?.imp ? pur.supKonto || schemeValue(ctx, 'supplierFx') : schemeValue(ctx, 'supplier');
  const L: IL[] = [{ k: supK, d: c.total * 100, p: 0, partner: d.partner }];
  const fallback = d.kind === 'ret' ? locationAccounts(ctx, loc).goodsStock : schemeValue(ctx, 'supDisc');
  for (const g of c.by) {
    const vin = ctx.firm.ddv && g.v ? vatAccount(ctx, 'in', g.rate) : undefined;
    L.push({ k: g.konto || fallback, d: 0, p: (vin ? g.b : g.b + g.v) * 100 });
    if (vin) L.push({ k: vin, d: 0, p: g.v * 100, note: 'Намалување на влезен ДДВ' });
  }
  return out(roundL(L, ctx));
}

/* ------------------------------------------------------------------ compensations */

export interface CompensationRow {
  /** `rec` = our receivable closed, `pay` = our payable closed. */
  side: 'rec' | 'pay';
  ref?: { type: 'invoice' | 'purchase'; id: string } | null;
  docNo?: string;
  date?: string;
  open?: number;
  amt: number | string;
  partner?: string;
  konto?: string;
}
/** Bilateral / multilateral compensation (`docs.type='komp'`). Receivables must equal payables. */
export interface CompensationDoc { id?: string; kind?: 'bi' | 'multi'; date?: string; number?: string; note?: string; parties?: string[]; rows: CompensationRow[]; pend?: boolean }

/** Compensation totals (legacy `kompTot`). */
export function kompTot(d: CompensationDoc): { rec: number; pay: number } {
  let rec = 0, pay = 0;
  for (const r of d.rows ?? []) if (r.side === 'rec') rec += toC(r.amt); else pay += toC(r.amt);
  return { rec: toD(rec), pay: toD(pay) };
}

/**
 * Compensation posting (legacy `kompEntries`, 8924): P customer for receivables, D supplier for payables.
 * Balanced only when receivables = payables (legacy enforces that on save; check with `kompTot`).
 */
export function kompEntries(d: CompensationDoc, ctx: PostingContext): JournalLine[] {
  const note = 'Компензација ' + (d.number || '');
  const L: IL[] = [];
  for (const r of d.rows ?? []) {
    const a = toC(r.amt);
    if (!a) continue;
    if (r.side === 'rec') L.push({ k: r.konto || schemeValue(ctx, 'customer') || '1200', d: 0, p: a, partner: r.partner, doc: r.docNo || '', note });
    else L.push({ k: r.konto || schemeValue(ctx, 'supplier') || '2200', d: a, p: 0, partner: r.partner, doc: r.docNo || '', note });
  }
  return out(L);
}

/* ------------------------------------------------------------------ VAT period close */

/** A posted ledger line as seen by the VAT close (account, date, amounts). */
export interface LedgerLineLike { account: string; date: string; debit: number; credit: number }

/**
 * Journal that closes the VAT kontos of a period after the return is filed (legacy `ddvCloseLines`,
 * 3524): each VAT konto balance is reversed; the net goes to `ddvPay` (payable) or `ddvClaim`
 * (refund). Pass the period's ledger lines *excluding* earlier VAT-close journals.
 */
export function vatCloseEntries(ledger: readonly LedgerLineLike[], from: string, to: string, ctx: PostingContext): { lines: JournalLine[]; diff: number } {
  const K = vatAccountSet(ctx);
  const B = new Map<string, number>();
  for (const l of ledger) {
    if (l.date < from || l.date > to || !K.has(String(l.account))) continue;
    B.set(l.account, (B.get(l.account) ?? 0) + toC(l.debit) - toC(l.credit));
  }
  const L: IL[] = [...B.entries()]
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a[0] === '2' ? 0 : 1) - (b[0] === '2' ? 0 : 1) || (/18/.test(b) ? 1 : 0) - (/18/.test(a) ? 1 : 0) || a.localeCompare(b))
    .map(([k, v]) => ({ k, d: v < 0 ? -v : 0, p: v > 0 ? v : 0, note: v < 0 ? 'Затворање на обврска за ДДВ' : 'Затворање на претходен ДДВ' }));
  const diff = L.reduce((s, l) => s + l.d - l.p, 0);
  if (diff > 0) L.push({ k: schemeValue(ctx, 'ddvPay'), d: 0, p: diff, note: 'Обврска за плаќање ДДВ' });
  else if (diff < 0) L.push({ k: schemeValue(ctx, 'ddvClaim'), d: -diff, p: 0, note: 'Побарување за ДДВ (поврат/пребивање)' });
  return { lines: out(L), diff: toD(diff) };
}
