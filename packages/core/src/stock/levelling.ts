/**
 * Levelling (нивелација), promotions (акции) and transfers (преносници).
 */
import type { LevellingDoc, LevellingLine, StockContext, StockItem, StockJournalLine, StockMove } from './types';
import { addDaysIso, num, r2, r4, rnd } from './num';
import { itemById, retailPrice } from './retail';
import { postOut, stock, stockAt } from './average';
import { transferLines } from './journal';

export interface LevellingDraft {
  /** Location id. */
  wh: string;
  /** New retail price incl. VAT per item id; `null`/`''` = unchanged. */
  prices: Record<string, number | string | null | undefined>;
  /** Imported quantities (Excel) per item id; otherwise the stock at the date is used. */
  qty?: Record<string, number | string | null | undefined>;
  /** Imported old prices per item id; otherwise the current retail price is used. */
  old?: Record<string, number | string | null | undefined>;
}

/**
 * Lines of a levelling document (legacy `ACT.saveNivel`, index.html 13211 / 17188): one line per item whose new price
 * differs from the old one by at least half a cent; quantity = stock at the levelling date at that location.
 *
 * DELIBERATE FIX: the quantity comes from the corrected `stockAt`. In the shipped legacy app the swapped `stockAt`
 * arguments made every quantity 0, so levellings had no value in ЕТМ and no posting.
 */
export function levellingLines(ctx: StockContext, draft: LevellingDraft, date: string): LevellingLine[] {
  const W = draft.wh;
  const lines: LevellingLine[] = [];
  for (const [id, nv] of Object.entries(draft.prices)) {
    if (nv == null || nv === '') continue;
    const it = itemById(ctx, id);
    if (!it) continue;
    const oldIn = draft.old?.[id];
    const old = oldIn != null ? num(oldIn) : retailPrice(it, W);
    if (Math.abs(num(nv) - old) < 0.005) continue;
    const qIn = draft.qty?.[id];
    const qty = qIn != null ? num(qIn) : stockAt(ctx, { item: id, wh: W, date }).qty;
    lines.push({ item: id, qty, old, new: num(nv), ...(qIn != null ? { qtyImp: true } : {}) });
  }
  return lines;
}

/**
 * Next number for a yearly-numbered document: `NNN/YYYY`.
 * DELIBERATE FIX (LEGACY-MAP §7.4 item 9): legacy used `count + 1`, which repeats a number after a delete; this is
 * `max(existing) + 1` over the documents of that year.
 */
export function nextYearNumber(existing: readonly { number?: string; date?: string }[], year: string | number, pad = 3): string {
  const y = String(year);
  const mx = existing
    .filter((x) => String(x.date ?? '').startsWith(y))
    .reduce((m, x) => Math.max(m, parseInt(String(x.number ?? ''), 10) || 0), 0);
  return String(mx + 1).padStart(pad, '0') + '/' + y;
}

/**
 * The automatic price-back levelling of a promotion that ends on `akTo` (legacy `saveNivel` with "Акција важи до"):
 * dated the day after `akTo`, with old/new swapped. `null` when `akTo` is before the levelling date.
 */
export function levellingReversal(doc: LevellingDoc, akTo: string): LevellingDoc | null {
  if (!akTo || akTo < doc.date) return null;
  return {
    date: addDaysIso(akTo, 1),
    wh: doc.wh,
    lines: doc.lines.map((l) => ({ item: l.item, qty: l.qty, old: l.new, new: l.old })),
    note: 'Враќање на цените по акција (' + (doc.number ?? '') + ')',
    akBack: doc.number,
  };
}

export interface PromotionLine {
  item: string;
  old: number;
  new: number;
}
export interface Promotion {
  wh: string;
  from: string;
  to: string;
  /** Default discount percent. */
  pct?: number | string;
  /** Rounding of the new price: 0 = cents, 1 = whole denar, 10 = tens. */
  rnd?: number | string;
  lines: PromotionLine[];
}

/** Legacy `akNewPrice` (index.html 5825): explicit price, else `old × (1 − pct%)` rounded to `rnd` (or cents). */
export function promotionPrice(old: number, sel: { price?: number | string | null; pct?: number | string | null }, promo: Pick<Promotion, 'pct' | 'rnd'>): number {
  if (sel.price != null && sel.price !== '') return r2(sel.price);
  const p = sel.pct != null && sel.pct !== '' ? num(sel.pct) : num(promo.pct);
  let n = old * (1 - p / 100);
  const R = num(promo.rnd);
  n = R ? rnd(n / R, 0) * R : r2(n);
  return r2(n);
}

/**
 * Levelling lines that start (`back=false`) or end (`back=true`) a promotion (legacy `akMakeNiv`, 5834): quantity =
 * stock at the date (corrected `stockAt`, see `levellingLines`).
 */
export function promotionLevellingLines(ctx: StockContext, promo: Promotion, date: string, back: boolean): LevellingLine[] {
  const out: LevellingLine[] = [];
  for (const l of promo.lines) {
    if (!itemById(ctx, l.item)) continue;
    const qty = stockAt(ctx, { item: l.item, wh: promo.wh, date }).qty;
    out.push({ item: l.item, qty, old: back ? num(l.new) : num(l.old), new: back ? num(l.old) : num(l.new) });
  }
  return out;
}

/** Legacy `akCost`: average cost incl. VAT at a location (floor for a promotion price). */
export function promotionCostFloor(ctx: StockContext, item: StockItem, wh: string): number {
  const c = stock(ctx, item.id, wh).avg || num(item.cost);
  return r2(c * (1 + num(item.rate ?? 18) / 100));
}

export interface TransferArgs {
  item: StockItem;
  qty: number;
  date: string;
  from: string;
  to: string;
  /** Document key, `prn-…`. */
  src: string;
  /** Label of the issuing move (legacy `Преносница N → <to>`). */
  outLabel?: string;
  /** Label of the receiving move (legacy `Преносница N од <from>`). */
  inLabel?: string;
  /** Retail unit price incl. VAT at the destination; default the item's retail price there. */
  retailUnitPrice?: number | string | null;
  /** Suffix for the receiving move id when one item appears on several lines (legacy `-in-<i>`). */
  lineIndex?: number;
}

export interface TransferResult {
  out: StockMove;
  in: StockMove;
  cost: number;
  /** Unit cost at the source (legacy `nabU`, 4 decimals). */
  unitCost: number;
  retailUnitPrice: number;
}

/**
 * One transfer line (legacy `ACT.prSave`, index.html 17396): issue from the source at average cost without lines,
 * receive at the destination at the same cost with `transferLines`.
 */
export function postTransfer(ctx: StockContext, a: TransferArgs): TransferResult {
  const q = num(a.qty);
  const res = postOut(ctx, { item: a.item, qty: q, date: a.date, type: 'transfer', src: a.src, label: a.outLabel ?? 'Преносница', debitAccount: null, wh: a.from });
  const spU = a.retailUnitPrice == null || a.retailUnitPrice === '' ? retailPrice(a.item, a.to) : num(a.retailUnitPrice);
  const lines: StockJournalLine[] = transferLines(ctx, { item: a.item, qty: q, retailUnitPrice: spU, cost: res.value, from: a.from, to: a.to });
  const inMove: StockMove = {
    id: a.src + '-' + a.item.id + '-in' + (a.lineIndex != null ? '-' + a.lineIndex : ''),
    date: a.date,
    item: a.item.id,
    qty: q,
    value: res.value,
    type: 'transfer-in',
    src: a.src,
    wh: a.to,
    label: a.inLabel ?? 'Преносница',
    lines,
  };
  return { out: res.move, in: inMove, cost: res.value, unitCost: q ? r4(res.value / q) : 0, retailUnitPrice: spU };
}

/** Stock shortages for a transfer (legacy `prSave` check): items whose stock at the source on the date is below the requested total. */
export function transferShortages(
  ctx: StockContext,
  from: string,
  date: string,
  lines: readonly { item: string; qty: number | string }[],
): { item: string; have: number; need: number }[] {
  const need = new Map<string, number>();
  for (const l of lines) if (l.item && num(l.qty) > 0) need.set(l.item, (need.get(l.item) ?? 0) + num(l.qty));
  const out: { item: string; have: number; need: number }[] = [];
  for (const [id, q] of need) {
    const have = stockAt(ctx, { item: id, wh: from, date }).qty;
    if (have < q - 1e-9) out.push({ item: id, have, need: q });
  }
  return out;
}
