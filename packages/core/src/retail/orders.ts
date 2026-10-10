/**
 * Customer orders, supplier orders, automatic replenishment and material requirements planning (legacy 9858–10008:
 * `ordDeliv`/`ordRest`/`ordSt`, `reservedQty`, `onOrderQty`, `replRows`, `mrpCalc`, `mrpDemand`).
 */
import { num, r4 } from '../stock/num';

export interface OrderLine { itemId?: string | null; name: string; unit?: string | null; qty: number; price: number; disc?: number; rate: number; account?: string | null }
export interface CustomerOrder { id: string; status: 'open' | 'cancel'; lines: readonly OrderLine[] }
export type OrderState = 'open' | 'part' | 'done' | 'cancel';

export const ORDER_STATES: Readonly<Record<OrderState, [string, string]>> = {
  open: ['отворена', 'info'], part: ['делумно', 'warn'], done: ['испорачана', 'good'], cancel: ['откажана', ''],
};

/** Delivered quantity per order line (legacy `ordRest`): invoiced quantities are consumed line by line in order. */
export function orderRest<L extends OrderLine>(lines: readonly L[], delivered: Readonly<Record<string, number>>): (L & { dl: number; rest: number })[] {
  const D: Record<string, number> = { ...delivered };
  return lines.map((l) => {
    const dl = Math.min(num(l.qty), l.itemId ? D[l.itemId] ?? 0 : 0);
    if (l.itemId) D[l.itemId] = (D[l.itemId] ?? 0) - dl;
    return { ...l, dl, rest: r4(num(l.qty) - dl) };
  });
}

/** Legacy `ordSt`. */
export function orderState(o: CustomerOrder, delivered: Readonly<Record<string, number>>): OrderState {
  if (o.status === 'cancel') return 'cancel';
  const R = orderRest(o.lines, delivered);
  if (R.every((l) => l.rest <= 1e-9)) return 'done';
  return R.some((l) => l.dl > 0) ? 'part' : 'open';
}

/** Quantity reserved by open and partly delivered orders, per item (legacy `reservedQty`). */
export function reservedByItem(orders: readonly CustomerOrder[], deliveredOf: (orderId: string) => Readonly<Record<string, number>>, exceptId?: string): Map<string, number> {
  const M = new Map<string, number>();
  for (const o of orders) {
    if (o.id === exceptId) continue;
    const d = deliveredOf(o.id);
    const st = orderState(o, d);
    if (st === 'cancel' || st === 'done') continue;
    for (const l of orderRest(o.lines, d)) if (l.itemId && l.rest > 0) M.set(l.itemId, r4((M.get(l.itemId) ?? 0) + l.rest));
  }
  return M;
}

export interface SupplierOrderLike { status: 'open' | 'recv' | 'cancel'; lines: readonly { itemId: string; qty: number }[] }

/** Quantity already ordered from suppliers (open supplier orders), per item (legacy `onOrderQty`). */
export function onOrderByItem(pos: readonly SupplierOrderLike[]): Map<string, number> {
  const M = new Map<string, number>();
  for (const p of pos) if (p.status === 'open') for (const l of p.lines) M.set(l.itemId, r4((M.get(l.itemId) ?? 0) + num(l.qty)));
  return M;
}

/* ---------------- replenishment ---------------- */

export interface ReplConfig { lead: number; cover: number; days: number }
export const REPL_DEFAULTS: ReplConfig = { lead: 7, cover: 14, days: 90 };

export interface ReplItem { id: string; type?: string | null; active?: boolean; min?: number | string | null; lead?: number | string | null }
export interface ReplRow<I extends ReplItem> {
  i: I; st: number; res: number; oo: number; daily: number; need: number; sug: number; days: number | null;
}

/**
 * Legacy `replRows`: suggestion = ⌈daily sales × (lead + cover) + min − (stock − reserved + on order)⌉, daily sales from
 * the outgoing moves of the last `days` days (transfers excluded). Only goods and materials; sorted by days of cover.
 */
export function replenishment<I extends ReplItem>(items: readonly I[], a: {
  cfg: ReplConfig;
  /** Outgoing quantity per item in the window (positive). */
  outQty: ReadonlyMap<string, number>;
  stockOf: (id: string) => number;
  reserved: ReadonlyMap<string, number>;
  onOrder: ReadonlyMap<string, number>;
}): ReplRow<I>[] {
  const c = a.cfg;
  return items
    .filter((i) => i.active !== false && ['goods', 'material'].includes(i.type || 'goods'))
    .map((i) => {
      const st = a.stockOf(i.id), res = a.reserved.get(i.id) ?? 0, oo = a.onOrder.get(i.id) ?? 0;
      const daily = (a.outQty.get(i.id) ?? 0) / (c.days || 1);
      const lead = num(i.lead) || c.lead;
      const need = daily * (lead + c.cover) + num(i.min);
      const sug = Math.ceil(Math.max(0, need - (st - res + oo)) - 1e-9);
      return { i, st, res, oo, daily, need, sug, days: daily > 0 ? Math.floor((st - res) / daily) : null };
    })
    .filter((r) => r.sug > 0)
    .sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9));
}

/* ---------------- MRP ---------------- */

export interface MrpItem { id: string; type?: string | null; bom?: readonly { item: string; qty: number | string }[] }
export interface MrpMat { id: string; q: number; st: number; res: number; oo: number; short: number }

/**
 * Legacy `mrpCalc`: explode the production plan through the BOMs (max depth 8); a semi-product with a BOM first uses
 * its free stock (stock − reserved), the rest is produced and exploded further; leaves are materials to procure.
 */
export function mrpCalc(plan: Readonly<Record<string, number>>, a: {
  item: (id: string) => MrpItem | undefined;
  stockOf: (id: string) => number;
  reserved: ReadonlyMap<string, number>;
  onOrder: ReadonlyMap<string, number>;
}): { mats: MrpMat[]; prods: { id: string; q: number }[] } {
  const need: Record<string, number> = {};
  const prodQ: Record<string, number> = {};
  const used: Record<string, number> = {};
  const explode = (id: string, q: number, depth: number): void => {
    if (depth > 8 || q <= 0) return;
    const it = a.item(id);
    if (!it) return;
    if (it.type === 'product' && (it.bom ?? []).length) {
      const free = Math.max(0, a.stockOf(id) - (a.reserved.get(id) ?? 0) - (used[id] ?? 0));
      const use = Math.min(free, q);
      used[id] = (used[id] ?? 0) + use;
      const mk = q - use;
      if (mk > 0) {
        prodQ[id] = (prodQ[id] ?? 0) + mk;
        for (const b of it.bom!) explode(b.item, r4(mk * num(b.qty)), depth + 1);
      }
    } else need[id] = (need[id] ?? 0) + q;
  };
  for (const [id, q] of Object.entries(plan)) {
    if (!(num(q) > 0)) continue;
    const it = a.item(id);
    if (!it) continue;
    prodQ[id] = (prodQ[id] ?? 0) + num(q);
    for (const b of it.bom ?? []) explode(b.item, r4(num(q) * num(b.qty)), 1);
  }
  const mats = Object.entries(need).map(([id, q]) => {
    const st = a.stockOf(id), res = a.reserved.get(id) ?? 0, oo = a.onOrder.get(id) ?? 0;
    return { id, q: r4(q), st, res, oo, short: r4(Math.max(0, q - (st - res) - oo)) };
  }).sort((x, y) => y.short - x.short);
  return { mats, prods: Object.entries(prodQ).map(([id, q]) => ({ id, q: r4(q) })) };
}

/** Default plan (legacy `VIEWS.mrp`): ⌈open ordered quantity − stock⌉ per product, never negative. */
export const mrpDefaultPlan = (demand: number, stockQty: number): number => {
  const short = Math.max(0, demand - stockQty);
  return short ? Math.ceil(short) : 0;
};

/** Group rows by supplier (legacy `poCreate`): one supplier order per partner (empty = no supplier). */
export function groupBySupplier<R extends { pid: string | null | undefined }>(rows: readonly R[]): Map<string, R[]> {
  const M = new Map<string, R[]>();
  for (const r of rows) {
    const k = r.pid || '';
    M.set(k, [...(M.get(k) ?? []), r]);
  }
  return M;
}

/** Legacy `bzNextNo(t, prefix, date)`: `<prefix><NNN>/<YYYY>` = the highest number among documents of that year + 1. */
export function nextPrefixedNo(existing: readonly { number?: string | null; date?: string | null }[], prefix: string, date: string): string {
  const y = date.slice(0, 4);
  const mx = existing.filter((x) => String(x.date ?? '').slice(0, 4) === y)
    .reduce((m, x) => Math.max(m, parseInt(String(x.number ?? '').replace(/^\D+/, ''), 10) || 0), 0);
  return prefix + String(mx + 1).padStart(3, '0') + '/' + y;
}
