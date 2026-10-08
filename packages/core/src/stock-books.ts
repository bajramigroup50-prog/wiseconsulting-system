/**
 * Stock books and lists (Phase 7): лагер листа, картица на артикл, ЕТ / ЕТМ trade books, the official ЕТ form for
 * retail (legacy view "МЕТГ") and the МЕТГ quantity card. Ported from legacy `lagerData`/`LAGER`/`lagerSum` (4918–4930),
 * `kartData` (4973), `trgData` (4990), `inFirst`/`moveDoc`/`etData` (5013–5022) and `metgData` (5043) — see
 * docs/LEGACY-MAP.md §7.1 "Stock lists, cards, trade books".
 *
 * Pure: every function receives a `StockContext` snapshot plus the documents it reads. The link from a move to its
 * source document (legacy `moveDoc`, which parsed `move.src` prefixes) is a resolver passed in by the caller, so the
 * database layer can resolve documents by `source_type`/`source_id` while golden tests use `legacyMoveDoc`.
 *
 * DELIBERATE FIXES applied in every book here:
 * - stock at a date comes from the corrected `stockAt` (LEGACY-MAP §7.4 item 1; the shipped lager list showed 0);
 * - client-submitted `pend` moves are ignored, as in `stock()` (legacy cards and books counted them, item 13);
 * - sums are kept in integer cents / 1/10 000 units (legacy summed floats).
 * Naming (item 10): `tradeBook(retail=false)` is ЕТ (wholesale, cost), `tradeBook(retail=true)` is ЕТМ (retail value),
 * `etBook` is the official ЕТ form for retail stores (legacy view `m_trg`, mislabelled "МЕТГ"), `metgCard` is МЕТГ —
 * the wholesale quantity card per item (legacy view `g_trg`).
 */
import type { StockAtBalance, StockContext, StockItem, StockMove } from './stock';
import { locationKind, stockAt, trackedItems, whOf, priceAt, retailPrice, itemById, calculationRows } from './stock';
import type { PurchaseLike } from './stock';
import { cents, dmy, fromCents, fromQunits, num, qunits, r2, r4 } from './stock/num';

/* ------------------------------------------------------------------ shared */

export interface StockBookOptions {
  /** Location id; empty = all locations of the book's kind. */
  wh?: string;
  from: string;
  to: string;
}

const byDate = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const live = (ctx: StockContext): StockMove[] => ctx.moves.filter((m) => !m.pend);
const mkCompare = (a: string, b: string) => a.localeCompare(b, 'mk', { numeric: true });

/** Legacy `inFirst`: by date, receipts before issues on the same day (stable). */
export const inFirst = <T extends { date: string; inn?: boolean }>(a: T, b: T): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : (b.inn ? 1 : 0) - (a.inn ? 1 : 0);

/* ------------------------------------------------------------------ лагер листа */

export type LagerView = 'g_lager' | 'g_lagerk' | 'm_lager' | 'm_lagerp';
export type LagerColKind = 'q' | 'm' | 't' | 'b';

export interface LagerRow {
  item: StockItem;
  s: StockAtBalance;
}

export interface LagerColumn {
  label: string;
  kind: LagerColKind;
  /** Summed in the footer. */
  sum?: boolean;
  value: (it: StockItem, s: StockAtBalance, wh: string | undefined) => number | string;
}

const rate0 = (it: StockItem) => num(it.rate);

/** Legacy `LAGER` (4918): titles and columns of the four stock-list views. */
export const LAGER: Record<LagerView, { title: string; land?: boolean; dense?: boolean; summary?: boolean; cols: LagerColumn[] }> = {
  g_lager: {
    title: 'Лагер листа',
    land: true,
    dense: true,
    summary: true,
    cols: [
      { label: 'Влезена кол.', kind: 'q', sum: true, value: (_i, s) => s.inQ },
      { label: 'Излезена кол.', kind: 'q', sum: true, value: (_i, s) => s.outQ },
      { label: 'Присутна кол.', kind: 'q', sum: true, value: (_i, s) => s.qty },
      { label: 'Набавна цена', kind: 'm', value: (_i, s) => s.avg },
      { label: 'Фин. влез', kind: 'm', sum: true, value: (_i, s) => s.inV },
      { label: 'Фин. излез', kind: 'm', sum: true, value: (_i, s) => s.outV },
      { label: 'Фин. состојба', kind: 'm', sum: true, value: (_i, s) => s.value },
      { label: 'Прод. цена без ДДВ', kind: 'm', value: (it) => num(it.price) },
      { label: 'Прод. цена со ДДВ', kind: 'm', value: (it) => retailPrice(it) },
      { label: 'Прод. вредност без ДДВ', kind: 'm', sum: true, value: (it, s) => r2(s.qty * num(it.price)) },
      { label: 'Прод. вредност со ДДВ', kind: 'm', sum: true, value: (it, s, wh) => r2(s.qty * retailPrice(it, wh)) },
      { label: 'За набавка', kind: 'q', value: (it, s) => (num(it.min) && s.qty < num(it.min) ? r4(num(it.min) - s.qty) : '') },
    ],
  },
  g_lagerk: {
    title: 'Лагер листа скратена',
    cols: [
      { label: 'Количина', kind: 'q', value: (_i, s) => s.qty },
      { label: 'Пописна количина', kind: 'b', value: () => '' },
      { label: 'Разлика', kind: 'b', value: () => '' },
    ],
  },
  m_lager: {
    title: 'Лагер листа (малопродажба)',
    cols: [
      { label: 'Количина', kind: 'q', value: (_i, s) => s.qty },
      { label: 'Малопродажна цена со ДДВ', kind: 'm', value: (it, _s, wh) => retailPrice(it, wh) },
      { label: 'Вредност по МПЦ', kind: 'm', sum: true, value: (it, s, wh) => r2(s.qty * retailPrice(it, wh)) },
    ],
  },
  m_lagerp: {
    title: 'Лагер листа проширена',
    land: true,
    cols: [
      { label: 'Количина', kind: 'q', value: (_i, s) => s.qty },
      { label: 'Набавна цена', kind: 'm', value: (_i, s) => s.avg },
      { label: 'Набавна вредност', kind: 'm', sum: true, value: (_i, s) => s.value },
      { label: 'ДДВ %', kind: 't', value: (it) => rate0(it) + '%' },
      { label: 'МПЦ со ДДВ', kind: 'm', value: (it, _s, wh) => retailPrice(it, wh) },
      { label: 'Вредност по МПЦ', kind: 'm', sum: true, value: (it, s, wh) => r2(s.qty * retailPrice(it, wh)) },
      { label: 'ДДВ во залихата', kind: 'm', sum: true, value: (it, s, wh) => r2((s.qty * retailPrice(it, wh) * rate0(it)) / (100 + rate0(it))) },
      { label: 'Разлика во цена', kind: 'm', sum: true, value: (it, s, wh) => r2((s.qty * retailPrice(it, wh)) / (1 + rate0(it) / 100) - s.value) },
    ],
  },
};

export interface LagerQuery {
  date: string;
  wh?: string;
  /** Item type filter. */
  type?: string;
  /** Code / name search (case-insensitive). */
  q?: string;
  /** Include items with zero stock. */
  zero?: boolean;
}

/** Legacy `lagerData` (4924): tracked items with stock at the date, sorted by code (or name), numeric-aware. */
export function lagerRows(ctx: StockContext, query: LagerQuery): LagerRow[] {
  const q = (query.q ?? '').toLowerCase();
  const its = trackedItems(ctx)
    .filter((i) => (!query.type || i.type === query.type) && (!q || ((i.name ?? '') + ' ' + (i.code || '')).toLowerCase().includes(q)))
    .sort((a, b) => mkCompare(String(a.code || a.name || ''), String(b.code || b.name || '')));
  return its
    .map((item) => ({ item, s: stockAt(ctx, { item: item.id, date: query.date, wh: query.wh || undefined }) }))
    .filter((r) => query.zero || Math.abs(r.s.qty) > 1e-9);
}

/** Footer total of a summed LAGER column. */
export function lagerColumnTotal(rows: readonly LagerRow[], col: LagerColumn, wh?: string): number {
  if (col.kind === 'q') return fromQunits(rows.reduce((s, r) => s + qunits(num(col.value(r.item, r.s, wh))), 0));
  return fromCents(rows.reduce((s, r) => s + cents(num(col.value(r.item, r.s, wh))), 0));
}

export interface LagerSummary {
  /** At cost without VAT: in, out, balance, balance with VAT. */
  fin: { i: number; o: number; st: number; stv: number };
  /** Quantities: present, in, out, to order. */
  q: { p: number; i: number; o: number; n: number };
  /** At sale prices: in/out with VAT (`iw`/`ow`), without VAT (`in`/`on`). */
  pv: { iw: number; ow: number; in: number; on: number };
}

/** Legacy `lagerSum` (4930): the three summary boxes under the full stock list. */
export function lagerSummary(rows: readonly LagerRow[]): LagerSummary {
  const C = (f: (r: LagerRow) => number) => fromCents(rows.reduce((s, r) => s + cents(f(r)), 0));
  const Q = (f: (r: LagerRow) => number) => fromQunits(rows.reduce((s, r) => s + qunits(f(r)), 0));
  return {
    fin: { i: C((r) => r.s.inV), o: C((r) => r.s.outV), st: C((r) => r.s.value), stv: C((r) => r2(r.s.value * (1 + rate0(r.item) / 100))) },
    q: {
      p: Q((r) => r.s.qty),
      i: Q((r) => r.s.inQ),
      o: Q((r) => r.s.outQ),
      n: Q((r) => (num(r.item.min) && r.s.qty < num(r.item.min) ? num(r.item.min) - r.s.qty : 0)),
    },
    pv: {
      iw: C((r) => r.s.inQ * retailPrice(r.item)),
      ow: C((r) => r.s.outQ * retailPrice(r.item)),
      in: C((r) => r.s.inQ * num(r.item.price)),
      on: C((r) => r.s.outQ * num(r.item.price)),
    },
  };
}

/* ------------------------------------------------------------------ картица на артикл */

export interface ItemCardOpen {
  open: true;
  q: number;
  v: number;
}
export interface ItemCardMove {
  open?: false;
  move: StockMove;
  in: number;
  out: number;
  price: number;
  vin: number;
  vout: number;
  q: number;
  v: number;
}
export type ItemCardRow = ItemCardOpen | ItemCardMove;

export interface ItemCard {
  item: StockItem;
  from: string;
  to: string;
  /** First row is the opening balance. */
  rows: ItemCardRow[];
  totals: { in: number; out: number; vin: number; vout: number; q: number; v: number };
}

/**
 * Legacy `kartData(retail)` (4973): moves of one item in the period with running quantity and value — at cost
 * (материјална картица) or at the current retail price of the location (картица на производ).
 */
export function itemCard(ctx: StockContext, a: StockBookOptions & { item: StockItem; retail?: boolean }): ItemCard {
  const it = a.item;
  const W = a.wh || '';
  const rp = retailPrice(it, W || undefined);
  const retail = !!a.retail;
  const mv = live(ctx)
    .filter((m) => m.item === it.id && (!W || whOf(m) === W))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : +(num(y.qty) > 0) - +(num(x.qty) > 0)));
  let q = 0;
  let v = 0;
  const rows: ItemCardRow[] = [];
  const open = (): ItemCardOpen => ({ open: true, q: fromQunits(q), v: retail ? r2(fromQunits(q) * rp) : fromCents(v) });
  for (const m of mv) {
    if (m.date < a.from) {
      q += qunits(m.qty);
      v += cents(m.value);
      continue;
    }
    if (m.date > a.to) break;
    if (!rows.length) rows.push(open());
    q += qunits(m.qty);
    v += cents(m.value);
    const aq = Math.abs(num(m.qty));
    const val = retail ? r2(aq * rp) : Math.abs(num(m.value));
    rows.push({
      move: m,
      in: num(m.qty) > 0 ? num(m.qty) : 0,
      out: num(m.qty) < 0 ? -num(m.qty) : 0,
      price: aq ? r2(val / aq) : 0,
      vin: num(m.qty) > 0 ? val : 0,
      vout: num(m.qty) < 0 ? val : 0,
      q: fromQunits(q),
      v: retail ? r2(fromQunits(q) * rp) : fromCents(v),
    });
  }
  if (!rows.length) rows.push(open());
  const last = rows[rows.length - 1]!;
  const M = rows.filter((r): r is ItemCardMove => !r.open);
  return {
    item: it,
    from: a.from,
    to: a.to,
    rows,
    totals: {
      in: fromQunits(M.reduce((s, r) => s + qunits(r.in), 0)),
      out: fromQunits(M.reduce((s, r) => s + qunits(r.out), 0)),
      vin: fromCents(M.reduce((s, r) => s + cents(r.vin), 0)),
      vout: fromCents(M.reduce((s, r) => s + cents(r.vout), 0)),
      q: last.q,
      v: last.v,
    },
  };
}

/* ------------------------------------------------------------------ ЕТ / ЕТМ */

/** Daily sales / fiscal report as the trade books read it (`sales`). */
export interface BookSales {
  id: string;
  date: string;
  wh?: string;
  total?: number | string;
  moNo?: string;
  fisk?: { sc?: string; z?: string | number } | null;
  days?: { date: string; z?: string | number; total?: number | string; est?: boolean }[];
}

export interface TradeBookRow {
  date: string;
  doc: string;
  /** Задолжување. */
  d: number;
  /** Раздолжување. */
  p: number;
  /** Wholesale only: sale value without VAT of the invoice line (`''` when not an invoice issue). */
  sale?: number | '';
  bal: number;
}

export interface TradeBook {
  from: string;
  to: string;
  open: number;
  rows: TradeBookRow[];
  totals: { d: number; p: number; sale: number; bal: number };
}

export interface TradeBookArgs extends StockBookOptions {
  /** `false` = ЕТ (wholesale, warehouses, at cost); `true` = ЕТМ (stores, retail value incl. VAT). */
  retail: boolean;
  /** Daily sales (Z reports), retail only. */
  sales?: readonly BookSales[];
  /** Sale value without VAT of an invoice issue (legacy `saleVal`, from `inv-<id>-<line>`), or `''`. */
  saleValue?: (m: StockMove) => number | '';
  locationName?: (id: string) => string;
}

/**
 * Legacy `trgData(retail)` (4990): ЕТ — wholesale trade book at cost (goods only, transfers excluded, with the
 * invoice sale value); ЕТМ — retail trade book at retail value incl. VAT: receipts and transfers in at the price on the
 * date, issues out, POS sales replaced by the daily Z totals, levellings as their value difference.
 * Rows with the same date, document and side are merged; receipts first within a day.
 */
export function tradeBook(ctx: StockContext, a: TradeBookArgs): TradeBook {
  const { from, to, retail } = a;
  const KD = retail ? 'store' : 'warehouse';
  const W = a.wh || '';
  const okW = (w: string) => (W ? w === W : locationKind(ctx, w) === KD);
  const ln = a.locationName ?? ((id: string) => id);
  const ids = new Set(trackedItems(ctx).filter((i) => retail || i.type === 'goods').map((i) => i.id));
  const val = (m: StockMove): number => {
    const it = itemById(ctx, m.item) ?? ({ id: m.item } as StockItem);
    return retail ? r2(Math.abs(num(m.qty)) * priceAt(ctx, it, whOf(m), m.date)) : Math.abs(num(m.value));
  };
  const rows: Omit<TradeBookRow, 'bal'>[] = [];
  let open = 0; // cents
  const mv = live(ctx)
    .filter((m) => ids.has(m.item) && okW(whOf(m)) && (retail || !/^transfer/.test(String(m.type || ''))))
    .sort(byDate);
  for (const m of mv) {
    const sg = num(m.qty) > 0 ? 1 : -1;
    if (m.date < from) {
      open += sg * cents(val(m));
      continue;
    }
    if (m.date > to) continue;
    if (retail && num(m.qty) < 0 && m.type === 'sale' && String(m.src).startsWith('pos-')) continue; // раздолжување преку дневниот промет
    rows.push({
      date: m.date,
      doc: m.label || String(m.type),
      d: num(m.qty) > 0 ? val(m) : 0,
      p: num(m.qty) < 0 ? val(m) : 0,
      sale: !retail && num(m.qty) < 0 ? (a.saleValue?.(m) ?? '') : '',
    });
  }
  if (retail) {
    for (const s of a.sales ?? []) {
      if (!okW(whOf(s))) continue;
      if (s.date < from) {
        open -= cents(s.total);
        continue;
      }
      if (s.date > to) continue;
      rows.push({ date: s.date, doc: 'Дневен промет (Z) ' + dmy(s.date) + (W ? '' : ' · ' + ln(whOf(s))), d: 0, p: num(s.total) });
    }
    for (const n of ctx.levellings ?? []) {
      if (!okW(whOf(n))) continue;
      const amt = r2(n.lines.reduce((s, l) => s + num(l.qty) * (num(l.new) - num(l.old)), 0));
      if (!amt) continue;
      if (n.date < from) {
        open += cents(amt);
        continue;
      }
      if (n.date > to) continue;
      rows.push({ date: n.date, doc: 'Нивелација ' + (n.number || '') + ' · ' + ln(whOf(n)), d: amt > 0 ? amt : 0, p: amt < 0 ? -amt : 0 });
    }
  }
  const M = new Map<string, Omit<TradeBookRow, 'bal'>>();
  for (const r of rows) {
    const k = r.date + '|' + r.doc + '|' + (r.d ? 1 : 0);
    const x = M.get(k);
    if (x) {
      x.d = r2(x.d + r.d);
      x.p = r2(x.p + r.p);
      if (r.sale !== '' && r.sale != null) x.sale = r2(num(x.sale) + num(r.sale));
    } else M.set(k, { ...r });
  }
  const merged = [...M.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : (y.d > 0 ? 1 : 0) - (x.d > 0 ? 1 : 0)));
  let bal = open;
  const out: TradeBookRow[] = merged.map((r) => {
    bal += cents(r.d) - cents(r.p);
    return { ...r, bal: fromCents(bal) };
  });
  return {
    from,
    to,
    open: fromCents(open),
    rows: out,
    totals: {
      d: fromCents(out.reduce((s, r) => s + cents(r.d), 0)),
      p: fromCents(out.reduce((s, r) => s + cents(r.p), 0)),
      sale: fromCents(out.reduce((s, r) => s + cents(num(r.sale)), 0)),
      bal: fromCents(bal),
    },
  };
}

/* ------------------------------------------------------------------ move → document */

/** What a stock move's source document looks like in the books (legacy `moveDoc` result). */
export interface MoveDocInfo {
  /** Grouping key: moves of the same document (and location) form one book row. */
  key: string;
  /** Document title and number, e.g. `Фактура 12`, `Од ПЛТ бр. 5`. */
  no: string;
  /** Partner or location shown next to the number. */
  name: string;
  /** Document date. */
  ddate: string;
  /** Retail-output document (sale/return/write-off/count): issues are not marked "(сторно)". */
  mo?: boolean;
  /**
   * Receipt documents booked as a whole in the ЕТ form (purchase calculation ПЛТ, transfer into the store):
   * purchase value (col. 5) and sale value (col. 6) of the whole document at this location.
   */
  inTotals?: { nab: number; sp: number };
}

export type MoveDocResolver = (m: StockMove) => MoveDocInfo;

/** Fallback when the source document is unknown (legacy last branch of `moveDoc`). */
export const plainMoveDoc = (m: StockMove): MoveDocInfo => ({ key: String(m.src || '') + '|' + m.type, no: m.label || String(m.type), name: '', ddate: m.date });

/** Purchase as the ЕТ form needs it (a calculation / ПЛТ). */
export interface BookPurchase extends PurchaseLike {
  id: string;
  calcNo?: string;
  number?: string;
  partner?: string;
  supplierName?: string;
  docDate?: string;
  date?: string;
  art32?: boolean;
}

/**
 * Col. 5 / col. 6 of the ЕТ form for a purchase calculation (legacy `etData`, purchase branch): purchase value incl.
 * landed costs, plus non-deductible VAT (import VAT on costs; input VAT when the firm is not a VAT payer and the
 * purchase is not under art. 32); sale value = Σ retail value of the calculation.
 */
export function purchaseBookTotals(ctx: StockContext, p: BookPurchase): { nab: number; sp: number } {
  const R = calculationRows(ctx, p);
  const vatReg = ctx.vatRegistered !== false;
  const nab = r2(R.reduce((s, r) => s + r.nabV + (p.imp ? r.cvat : p.art32 || !vatReg ? 0 : r2((r.v * r.rate) / 100)), 0));
  return { nab, sp: r2(R.reduce((s, r) => s + r.spV, 0)) };
}

/** Transfer document (warehouse → store), legacy `docs.type='prenos'`. */
export interface BookTransfer {
  id: string;
  number?: string;
  date: string;
  from: string;
  to: string;
  lines: readonly { item: string; qty: number | string; nabU: number | string; sp?: number | string | null }[];
}

/** Legacy `prPseudo` + `calcRows`: the transfer as a calculation (ПЛТ) of the receiving store. */
export function transferBookTotals(ctx: StockContext, d: BookTransfer): { nab: number; sp: number } {
  const R = calculationRows(ctx, {
    wh: d.to,
    art32: true,
    stock: d.lines.map((l) => ({ item: l.item, qty: l.qty, price: l.nabU, sp: l.sp ?? '' })),
  } as PurchaseLike);
  return { nab: r2(R.reduce((s, r) => s + r.nabV, 0)), sp: r2(R.reduce((s, r) => s + r.spV, 0)) };
}

/** Collections used by {@link legacyMoveDoc} (legacy document shapes). */
export interface LegacyBookDocs {
  invoices?: readonly { id: string; number?: string; date: string; partner?: string }[];
  purchases?: readonly BookPurchase[];
  docs?: readonly { id: string; type: string; t?: string; number?: string; date: string; partner?: string; wh?: string; from?: string; to?: string; lines?: unknown[] }[];
  partners?: readonly { id: string; name: string }[];
  locationName?: (id: string) => string;
}

const MOUT_SHORT: Record<string, string> = { sale: 'Продажба', inv: 'Фактура', ret: 'Повратница', otp: 'Отпис', pop: 'Попис' };

/** Legacy `moveDoc(m)` (5014) over legacy collections and `src` prefixes (`mo-`, `pur-`, `inv-`, `isp-`, `prn-`, `pos-`). */
export function legacyMoveDoc(ctx: StockContext, D: LegacyBookDocs): MoveDocResolver {
  const ln = D.locationName ?? ((id: string) => id);
  const pn = (id?: string) => (D.partners ?? []).find((p) => p.id === id)?.name;
  return (m) => {
    const s = String(m.src || '');
    let x: RegExpMatchArray | null;
    if ((x = s.match(/^mo-(.+)-\d+$/))) {
      const d = (D.docs ?? []).find((y) => y.id === x![1]);
      if (d) return { key: 'mo-' + d.id, no: (MOUT_SHORT[d.t ?? ''] || 'Излез') + ' ' + (d.number || ''), name: d.t === 'ret' ? pn(d.partner) || '' : ln(whOf(d)), ddate: d.date, mo: true };
    }
    if ((x = s.match(/^pur-(.+)$/))) {
      const p = (D.purchases ?? []).find((y) => y.id === x![1]);
      if (p)
        return {
          key: s,
          no: 'Од ПЛТ бр. ' + (p.calcNo || p.number || '') + (p.calcNo && p.number && p.calcNo !== p.number ? ' (ф-ра ' + p.number + ')' : ''),
          name: pn(p.partner) || p.supplierName || 'Добавувач',
          ddate: p.docDate || p.date || m.date,
          inTotals: purchaseBookTotals(ctx, p),
        };
    }
    if ((x = s.match(/^inv-(.+)-\d+$/))) {
      const i = (D.invoices ?? []).find((y) => y.id === x![1]);
      if (i) return { key: 'inv-' + i.id, no: 'Фактура ' + (i.number || ''), name: pn(i.partner) || 'Купувач', ddate: i.date };
    }
    if ((x = s.match(/^isp-(.+)-\d+$/))) {
      const d = (D.docs ?? []).find((y) => y.id === x![1]);
      if (d) return { key: 'isp-' + d.id, no: 'Испратница ' + (d.number || ''), name: pn(d.partner) || '', ddate: d.date };
    }
    if (s.startsWith('prn-')) {
      const d = (D.docs ?? []).find((y) => y.id === s);
      if (d)
        return {
          key: s,
          no: 'Преносница ' + d.number,
          name: num(m.qty) > 0 ? 'од ' + ln(d.from ?? '') : 'во ' + ln(d.to ?? ''),
          ddate: d.date,
          inTotals: transferBookTotals(ctx, d as unknown as BookTransfer),
        };
    }
    if (s.startsWith('pos-')) return { key: s, no: 'Каса', name: ln(whOf(m)), ddate: m.date };
    return plainMoveDoc(m);
  };
}

/* ------------------------------------------------------------------ ЕТ образец (мало) */

export interface EtRow {
  date: string;
  no: string;
  name: string;
  ddate: string;
  /** Col. 5 — purchase value. */
  nab: number;
  /** Col. 6 — sale value (negative for returns / write-offs). */
  sp: number;
  /** Col. 7 — daily turnover. */
  pr: number;
  inn: boolean;
  bal: number;
}

export interface EtBook {
  from: string;
  to: string;
  open: number;
  rows: EtRow[];
  totals: { nab: number; sp: number; pr: number; close: number };
}

export interface EtBookArgs extends StockBookOptions {
  docOf: MoveDocResolver;
  sales?: readonly BookSales[];
  /** Firm default fiscal scheme (legacy `fiskOpt.sc`): `usl` reports carry no goods and are skipped. */
  firmFiskScheme?: string;
  locationName?: (id: string) => string;
}

/**
 * Legacy `etData()` (5022): the official ЕТ form for retail ("Евиденција во трговијата на мало"), per store or all
 * stores (all locations when the firm has no store). Receipt documents (ПЛТ, transfers) are booked once per document
 * and location with their whole value; other moves at retail price on the date (returns and write-offs negative, issues
 * not from retail output marked "(сторно)"); levellings as value difference; daily fiscal reports (per day for periodic
 * reports) as turnover. POS / retail-output sales are not booked as issues — the turnover covers them.
 */
export function etBook(ctx: StockContext, a: EtBookArgs): EtBook {
  const W = a.wh || '';
  const noStore = !(ctx.locations ?? []).some((l) => l.kind === 'store');
  const okW = (w: string) => (W ? w === W : noStore || locationKind(ctx, w) === 'store');
  const ln = a.locationName ?? ((id: string) => id);
  const G = new Map<string, Omit<EtRow, 'bal'>>();
  const add = (k: string, o: Omit<EtRow, 'bal'>) => {
    const x = G.get(k);
    if (x) {
      x.nab = r2(x.nab + o.nab);
      x.sp = r2(x.sp + o.sp);
      x.pr = r2(x.pr + o.pr);
    } else G.set(k, { ...o });
  };
  const done = new Set<string>();
  for (const m of live(ctx)) {
    const w = whOf(m);
    if (!okW(w)) continue;
    const it = itemById(ctx, m.item);
    if (!it) continue;
    const D = a.docOf(m);
    const k = D.key + '|' + w;
    if (num(m.qty) < 0 && m.type === 'sale' && /^(pos|mo)-/.test(String(m.src))) continue;
    if (D.inTotals && num(m.qty) > 0) {
      if (done.has(k)) continue;
      done.add(k);
      add(k, { date: m.date, no: D.no, name: D.name, ddate: D.ddate, nab: D.inTotals.nab, sp: D.inTotals.sp, pr: 0, inn: true });
      continue;
    }
    const sp = r2(num(m.qty) * priceAt(ctx, it, w, m.date));
    add(k, {
      date: m.date,
      no: D.no + (num(m.qty) < 0 && !D.mo ? ' (сторно)' : ''),
      name: D.name,
      ddate: D.ddate,
      nab: num(m.qty) > 0 ? Math.abs(num(m.value)) : 0,
      sp,
      pr: 0,
      inn: num(m.qty) > 0,
    });
  }
  for (const n of ctx.levellings ?? []) {
    if (!okW(whOf(n))) continue;
    const amt = r2(n.lines.reduce((s, l) => s + num(l.qty) * (num(l.new) - num(l.old)), 0));
    if (amt) add('niv-' + (n.id ?? n.number ?? n.date), { date: n.date, no: 'Извештај за нивелација ' + (n.number || ''), name: ln(whOf(n)), ddate: n.date, nab: 0, sp: amt, pr: 0, inn: amt > 0 });
  }
  for (const z of a.sales ?? []) {
    if (!okW(whOf(z))) continue;
    if (z.fisk && (z.fisk.sc === 'usl' || (!z.fisk.sc && a.firmFiskScheme === 'usl'))) continue;
    if (Array.isArray(z.days) && z.days.length) {
      z.days.forEach((d, i) =>
        add('z-' + z.id + '-' + i, {
          date: d.date,
          no: 'Дн. фин. изв.' + (d.z ? ' Z бр. ' + d.z : '') + (d.est ? ' (распределено)' : ''),
          name: W ? '' : ln(whOf(z)),
          ddate: d.date,
          nab: 0,
          sp: 0,
          pr: num(d.total),
          inn: false,
        }),
      );
      continue;
    }
    add('z-' + z.id, {
      date: z.date,
      no: z.moNo ? 'Продажба / парагон ' + z.moNo : 'Дн. фин. изв.' + (z.fisk && z.fisk.z ? ' Z бр. ' + z.fisk.z : ''),
      name: W ? '' : ln(whOf(z)),
      ddate: z.date,
      nab: 0,
      sp: 0,
      pr: num(z.total),
      inn: false,
    });
  }
  const all = [...G.values()].sort(inFirst);
  let open = 0;
  const rows: EtRow[] = [];
  for (const r of all) {
    if (r.date < a.from) {
      open += cents(r.sp) - cents(r.pr);
      continue;
    }
    if (r.date > a.to) continue;
    rows.push({ ...r, bal: 0 });
  }
  let bal = open;
  for (const r of rows) {
    bal += cents(r.sp) - cents(r.pr);
    r.bal = fromCents(bal);
  }
  const S5 = rows.reduce((s, r) => s + cents(r.nab), 0);
  const S6 = rows.reduce((s, r) => s + cents(r.sp), 0);
  const S7 = rows.reduce((s, r) => s + cents(r.pr), 0);
  return { from: a.from, to: a.to, open: fromCents(open), rows, totals: { nab: fromCents(S5), sp: fromCents(S6), pr: fromCents(S7), close: fromCents(open + S6 - S7) } };
}

/* ------------------------------------------------------------------ МЕТГ (количинска картица) */

export interface MetgRow {
  date: string;
  no: string;
  ddate: string;
  name: string;
  in: number;
  out: number;
  bal: number;
}

export interface MetgCard {
  open: number;
  rows: MetgRow[];
  totals: { in: number; out: number; bal: number };
}

/**
 * Legacy `metgData(itemId, wh, from, to)` (5043): МЕТГ — quantity card of one item in the warehouses (or one
 * warehouse): bought / sold quantities per document, receipts first within a day, running balance.
 */
export function metgCard(ctx: StockContext, a: StockBookOptions & { item: string; docOf: MoveDocResolver }): MetgCard {
  const W = a.wh || '';
  const okW = (w: string) => (W ? w === W : locationKind(ctx, w) === 'warehouse');
  const mv = live(ctx)
    .filter((m) => m.item === a.item && okW(whOf(m)))
    .map((m) => ({ m, date: m.date, inn: num(m.qty) > 0 }))
    .sort(inFirst);
  let q = 0;
  let open = 0;
  const rows: MetgRow[] = [];
  for (const { m } of mv) {
    if (m.date < a.from) {
      q += qunits(m.qty);
      open += qunits(m.qty);
      continue;
    }
    if (m.date > a.to) continue;
    const D = a.docOf(m);
    q += qunits(m.qty);
    rows.push({ date: m.date, no: D.no, ddate: D.ddate, name: D.name, in: num(m.qty) > 0 ? num(m.qty) : 0, out: num(m.qty) < 0 ? -num(m.qty) : 0, bal: fromQunits(q) });
  }
  return {
    open: fromQunits(open),
    rows,
    totals: {
      in: fromQunits(rows.reduce((s, r) => s + qunits(r.in), 0)),
      out: fromQunits(rows.reduce((s, r) => s + qunits(r.out), 0)),
      bal: rows.length ? rows[rows.length - 1]!.bal : fromQunits(open),
    },
  };
}

/* ------------------------------------------------------------------ daily sales (POS / парагон) */

export interface DailySalesLine {
  item: string;
  qty: number | string;
  /** Unit price incl. VAT. */
  price: number | string;
  rate: number | string;
}

export interface DailySalesGroup {
  rate: number;
  konto: string;
  base: number;
  vat: number;
}

export interface DailySalesTotals {
  groups: DailySalesGroup[];
  total: number;
  /** Macedonian-product turnover per rate (КДФИ). */
  mk?: Record<string, { g: number; v: number }>;
}

/**
 * Group retail sale lines into the daily sales document (legacy `posSell` 5838 / `moSaveDoc` sale branch 5772):
 * gross = qty × price, base = gross / (1 + rate), VAT = gross − base, grouped by rate and revenue account.
 * `revenueAccount(item)` gives the account (legacy: item `konto`, else `revRetail` for goods, else `REV_K[type]`).
 */
export function dailySalesTotals(
  ctx: Pick<StockContext, 'items'>,
  lines: readonly DailySalesLine[],
  revenueAccount: (it: StockItem | undefined) => string,
  start?: DailySalesTotals,
): DailySalesTotals {
  const out: DailySalesTotals = start
    ? { groups: start.groups.map((g) => ({ ...g })), total: start.total, ...(start.mk ? { mk: Object.fromEntries(Object.entries(start.mk).map(([k, v]) => [k, { ...v }])) } : {}) }
    : { groups: [], total: 0 };
  for (const l of lines) {
    const it = itemById(ctx, l.item);
    const rate = num(l.rate);
    const gross = r2(num(l.qty) * num(l.price));
    const base = r2(gross / (1 + rate / 100));
    const vat = r2(gross - base);
    const konto = revenueAccount(it) || '7400';
    let g = out.groups.find((x) => x.rate === rate && x.konto === konto);
    if (!g) out.groups.push((g = { rate, konto, base: 0, vat: 0 }));
    g.base = r2(g.base + base);
    g.vat = r2(g.vat + vat);
    out.total = r2(out.total + gross);
    if (it?.mk) {
      out.mk ??= {};
      const x = (out.mk[rate] ??= { g: 0, v: 0 });
      x.g = r2(x.g + gross);
      x.v = r2(x.v + vat);
    }
  }
  return out;
}
