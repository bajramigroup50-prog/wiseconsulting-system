import type { StockContext, StockItem } from './types';
import { num, r2, rnd } from './num';

export const itemById = (ctx: Pick<StockContext, 'items'>, id: string): StockItem | undefined =>
  (ctx.items ?? []).find((i) => i.id === id);

/** Legacy `trk()`: stock-tracked items (typed, not services), in catalogue order. */
export const trackedItems = (ctx: Pick<StockContext, 'items'>): StockItem[] =>
  (ctx.items ?? []).filter((i) => i.type && i.type !== 'service');

/** VAT rate used in postings: legacy `+(it.rate ?? 18)`; 0 for a non-VAT firm. */
export const postingRate = (ctx: Pick<StockContext, 'vatRegistered'>, item: Pick<StockItem, 'rate'>): number =>
  ctx.vatRegistered === false ? 0 : num(item.rate ?? 18);

/**
 * Legacy `retailP(it, wh)`: retail price incl. VAT at a location — `it.sp[wh]` when set, else
 * `price × (1 + rate/100)` rounded to cents. Note legacy uses `+it.rate || 0` here (missing rate = 0%).
 */
export function retailPrice(item: StockItem, wh?: string): number {
  const sp = wh && item.sp ? item.sp[wh] : undefined;
  if (wh && item.sp && sp != null) return num(sp);
  return r2(num(item.price) * (1 + num(item.rate) / 100));
}

/**
 * Legacy `priceAt(it, wh, date)`: retail price on a date, rebuilt from levelling (`nivel`) documents of that
 * location: the newest `new` price on or before the date, else the `old` price of the first later levelling,
 * else the current `retailPrice`.
 */
export function priceAt(ctx: Pick<StockContext, 'levellings'>, item: StockItem, wh: string | undefined, date: string): number {
  const N = (ctx.levellings ?? [])
    .filter((x) => (x.wh || 'main') === wh)
    .flatMap((n) => n.lines.filter((l) => l.item === item.id).map((l) => ({ date: n.date, old: num(l.old), new: num(l.new) })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let p: number | null = null;
  for (const n of N) {
    if (n.date <= date) p = n.new;
    else {
      if (p == null) p = n.old;
      break;
    }
  }
  return p != null ? p : retailPrice(item, wh);
}

/** VAT contained in a VAT-inclusive amount: `gross × rate / (100 + rate)`, rounded to `dp` decimals. */
export const vatInGross = (gross: number, rate: number, dp = 2): number => (rate ? rnd((gross * rate) / (100 + rate), dp) : 0);

export interface RetailBreakdown {
  /** Retail value incl. VAT. */
  gross: number;
  /** Retail value without VAT. */
  net: number;
  vat: number;
  /** Price difference (разлика во цена) = net − cost. */
  margin: number;
}

/**
 * Retail value split used by calculations (ПЛТ), ЕТ/ЕТМ and transfers (legacy `calcRows`):
 * `net = r2(gross / (1 + rate/100))`, `vat = gross − net`, `margin = net − cost`.
 */
export function retailBreakdown(gross: number, rate: number, cost = 0): RetailBreakdown {
  const g = r2(gross);
  const net = r2(g / (1 + rate / 100));
  return { gross: g, net, vat: r2(g - net), margin: r2(net - cost) };
}

/**
 * Retail value split used by postings at retail value (legacy `postOut` / `prnLines` / levelling):
 * VAT first (`gross × rate/(100+rate)`), margin = gross − VAT − cost. `dp` = 0 for issues (whole denars), 2 otherwise.
 */
export function retailPostingSplit(gross: number, rate: number, cost: number, dp = 2): RetailBreakdown {
  const vat = vatInGross(gross, rate, dp);
  return { gross, net: rnd(gross - vat, dp), vat, margin: rnd(gross - vat - cost, dp) };
}
