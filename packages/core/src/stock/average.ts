/**
 * Weighted-average stock (legacy `stock`, `stockAt`, `postOut`, popis surplus, `reaverage`).
 * Pure: functions read a `StockContext` snapshot and return new moves; persisting them is the caller's job.
 */
import type { StockContext, StockItem, StockJournalLine, StockMove } from './types';
import { cents, fqMk, fromCents, fromQunits, num, qunits, r0, r2, r4 } from './num';
import {
  cogsAccount,
  normalizeLines,
  retailAccount,
  retailOn,
  stockAccount,
  stockScheme,
  whOf,
} from './accounts';
import { itemById, postingRate, priceAt, trackedItems } from './retail';
import { productionLines } from './journal';

export interface StockBalance {
  qty: number;
  value: number;
  /** `value / qty` to 4 decimals when qty > 0, else the item's `cost` (or 0). */
  avg: number;
}

export interface StockAtBalance extends StockBalance {
  inQ: number;
  outQ: number;
  inV: number;
  outV: number;
}

const itemCost = (ctx: StockContext, id: string): number => num(itemById(ctx, id)?.cost);

function avgOf(qu: number, vc: number): number {
  // value/qty = (vc/100) / (qu/10000) = vc*100/qu
  return qu > 0 ? r4((vc * 100) / qu) : 0;
}

/**
 * Legacy `stock(itemId, wh)` (index.html 3410): current balance over all dates. Skips `pend` moves.
 * `wh` empty/undefined = all locations.
 */
export function stock(ctx: StockContext, itemId: string, wh?: string): StockBalance {
  let q = 0;
  let v = 0;
  for (const m of ctx.moves) {
    if (m.item !== itemId || m.pend || (wh && whOf(m) !== wh)) continue;
    q += qunits(m.qty);
    v += cents(m.value);
  }
  return { qty: fromQunits(q), value: fromCents(v), avg: q > 0 ? avgOf(q, v) : itemCost(ctx, itemId) };
}

export interface StockAtQuery {
  item: string;
  /** Location id; empty/undefined = all locations. */
  wh?: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Include moves dated exactly `date` (default true). `false` = balance at the start of the day (legacy `before`). */
  inclusive?: boolean;
}

/**
 * Stock at a date for one item and location.
 *
 * DELIBERATE FIX (LEGACY-MAP §7.4 item 1): legacy redeclared `stockAt` at 13858 as `(itemId, wh, date, before)`
 * while ~22 callers still passed `(id, date, wh)`; the date landed in `wh`, every move was skipped and stock-at-date
 * was 0 (avg = item cost) in lager lists, levelling, transfers, retail output, FIFO/LIFO and promotions. The 13858
 * body also lost the `inQ/outQ/inV/outV` totals the LAGER columns need, and the older 4914 body did not skip `pend`.
 * This is the single, explicitly typed version: named query, skips `pend`, returns in/out totals.
 */
export function stockAt(ctx: StockContext, query: StockAtQuery): StockAtBalance {
  const { item, wh, date } = query;
  const inclusive = query.inclusive !== false;
  let q = 0;
  let v = 0;
  let iq = 0;
  let oq = 0;
  let iv = 0;
  let ov = 0;
  for (const m of ctx.moves) {
    if (m.item !== item || m.pend || (wh && whOf(m) !== wh)) continue;
    if (inclusive ? m.date > date : m.date >= date) continue;
    const a = qunits(m.qty);
    const b = cents(m.value);
    q += a;
    v += b;
    if (a > 0) {
      iq += a;
      iv += b;
    } else {
      oq -= a;
      ov -= b;
    }
  }
  return {
    qty: fromQunits(q),
    value: fromCents(v),
    avg: q > 0 ? avgOf(q, v) : itemCost(ctx, item),
    inQ: fromQunits(iq),
    outQ: fromQunits(oq),
    inV: fromCents(iv),
    outV: fromCents(ov),
  };
}

export interface PostOutArgs {
  item: StockItem;
  qty: number;
  date: string;
  type: StockMove['type'];
  /** Source document key; the move id is `${src}-${item.id}-${type}`. */
  src: string;
  label: string;
  /** Counter account (COGS, write-off, supplier for returns…). `null`/missing = no journal lines (e.g. transfer out). */
  debitAccount?: string | null;
  wh?: string;
  /** Merged into the debit line (legacy `extra`, e.g. `{partner}` for supplier returns). */
  extra?: Partial<Pick<StockJournalLine, 'partner' | 'note'>>;
}

export type PostOutWarning =
  /** No stock: the last purchase price (or item cost) was used. */
  | { code: 'lastPrice'; price: number }
  /** No stock and no purchase price: issued without value. */
  | { code: 'noCost' };

export interface PostOutResult {
  move: StockMove;
  /** Cost value of the issue (whole denars, positive). */
  value: number;
  warning?: PostOutWarning;
}

/**
 * Legacy `postOut` (index.html 3415): issue at weighted-average cost, whole-denar rounding.
 * - Average = current balance at the location (all dates), else across all locations; with no stock the last
 *   purchase price (latest dated receipt) or `item.cost` is used and a warning returned.
 * - Raw-material items (`rawK`): no quantity move; valued at `costPrice` or `costPct`% of price; credit `rawK`.
 * - Location kept at retail value: D cost / D margin / D VAT, C retail stock at retail value.
 *
 * DELIBERATE FIX: for a non-VAT firm (`vatRegistered:false`) the retail split has no VAT (legacy always used the item
 * rate here while transfers already respected `firm.ddv`).
 */
export function postOut(ctx: StockContext, a: PostOutArgs): PostOutResult {
  const it = a.item;
  const qty = num(a.qty);
  const wh = a.wh || 'main';
  const s = stock(ctx, it.id, wh);
  const raw = String(it.rawK ?? '').trim();
  let val = r0(qty * (s.avg || stock(ctx, it.id).avg));
  let warning: PostOutWarning | undefined;
  if (!raw && !val && qty > 0) {
    let last: StockMove | undefined;
    for (const m of ctx.moves) {
      if (m.item === it.id && num(m.qty) > 0 && num(m.value) > 0 && m.date <= a.date && (!last || m.date >= last.date)) last = m;
    }
    const lp = last ? num(last.value) / num(last.qty) : num(it.cost);
    if (lp > 0) {
      val = r0(qty * lp);
      warning = { code: 'lastPrice', price: lp };
    } else warning = { code: 'noCost' };
  }
  let credit = stockAccount(ctx, wh, it);
  if (raw) {
    const uc = num(it.costPrice) || (num(it.costPct) * num(it.price)) / 100;
    val = r0(qty * uc);
    credit = raw;
  }
  const debitK = a.debitAccount || '';
  let lines: StockJournalLine[] =
    val && debitK
      ? [
          { account: debitK, debit: val, credit: 0 },
          { account: credit, debit: 0, credit: val },
        ]
      : [];
  if (debitK && retailOn(ctx, wh) && it.type === 'goods') {
    const rv = r0(qty * priceAt(ctx, it, wh, a.date));
    const rate = postingRate(ctx, it);
    const vt = rate ? r0((rv * rate) / (100 + rate)) : 0;
    const mg = rv - vt - val;
    lines = normalizeLines([
      { account: debitK, debit: val, credit: 0 },
      { account: retailAccount(ctx, wh, 'Marg'), debit: mg, credit: 0 },
      { account: retailAccount(ctx, wh, 'Vat'), debit: vt, credit: 0 },
      { account: retailAccount(ctx, wh, 'Stock'), debit: 0, credit: rv },
    ]);
  }
  if (a.extra && debitK) lines = lines.map((l) => (l.account === debitK && l.debit ? { ...l, ...a.extra } : l));
  const move: StockMove = {
    id: a.src + '-' + it.id + '-' + a.type,
    date: a.date,
    item: it.id,
    qty: raw ? 0 : -qty,
    value: raw ? 0 : -val,
    type: a.type,
    src: a.src,
    label: raw ? a.label + ' · ' + fqMk(qty) + ' ' + (it.unit || '') + ' (раздолжено од ' + raw + ')' : a.label,
    wh,
    lines,
  };
  return { move, value: val, warning };
}

export interface PostInArgs {
  item: StockItem;
  qty: number;
  date: string;
  src: string;
  label: string;
  /** Counter account credited (legacy `konto2` of a stock count: e.g. surplus income). */
  creditAccount: string;
  wh?: string;
  type?: StockMove['type'];
  /** Override the valuation (default: average at the location, else overall average, else item cost). */
  value?: number;
}

/**
 * Receipt valued at average cost (legacy stock-count surplus `popis-in`, index.html 5785):
 * D stock / C counter account; at a retail-value location D retail stock / C margin / C VAT / C counter.
 *
 * DELIBERATE FIX: the stock account is `stockAccount(wh, item)` (location override honoured) — legacy used
 * `STOCK_K[type]` here but `stockK(wh,it)` in `postOut`, so a surplus and a shortage at the same store hit different accounts.
 */
export function postIn(ctx: StockContext, a: PostInArgs): { move: StockMove; value: number } {
  const it = a.item;
  const q = num(a.qty);
  const wh = a.wh || 'main';
  const s = stock(ctx, it.id, wh);
  const val = a.value != null ? r0(a.value) : r0(q * (s.avg || stock(ctx, it.id).avg || num(it.cost)));
  let lines: StockJournalLine[] = [
    { account: stockAccount(ctx, wh, it), debit: val, credit: 0 },
    { account: a.creditAccount, debit: 0, credit: val },
  ];
  if (retailOn(ctx, wh) && it.type === 'goods') {
    const rv = r0(q * priceAt(ctx, it, wh, a.date));
    const rate = postingRate(ctx, it);
    const vt = rate ? r0((rv * rate) / (100 + rate)) : 0;
    lines = [
      { account: retailAccount(ctx, wh, 'Stock'), debit: rv, credit: 0 },
      { account: retailAccount(ctx, wh, 'Marg'), debit: 0, credit: rv - vt - val },
      { account: retailAccount(ctx, wh, 'Vat'), debit: 0, credit: vt },
      { account: a.creditAccount, debit: 0, credit: val },
    ];
  }
  const type = a.type ?? 'popis-in';
  return {
    move: {
      id: a.src + '-' + it.id + '-' + (type === 'popis-in' ? 'popis' : type),
      date: a.date,
      item: it.id,
      qty: q,
      value: val,
      type,
      src: a.src,
      label: a.label,
      wh,
      lines: normalizeLines(lines),
    },
    value: val,
  };
}

/**
 * Re-value journal lines of a move whose cost changed from `oldVal` to `newVal` (both positive).
 *
 * DELIBERATE FIX: legacy `reaverage` set every non-zero line to the new cost, which unbalanced the 4-line
 * retail-value postings (cost / margin / VAT / retail stock). Here the cost lines are replaced and, when only one
 * side carried the cost, the difference goes to the margin account so the entry stays balanced.
 */
export function revalueLines(
  lines: readonly StockJournalLine[],
  oldVal: number,
  newVal: number,
  marginAccount?: string,
): StockJournalLine[] {
  const o = cents(oldVal);
  const out = lines.map((l) => ({ ...l }));
  const di = out.findIndex((l) => cents(l.debit) === o);
  const ci = out.findIndex((l) => cents(l.credit) === o);
  if (di >= 0 && ci >= 0) {
    out[di]!.debit = newVal;
    out[ci]!.credit = newVal;
    return normalizeLines(out);
  }
  if (di < 0 && ci < 0) {
    // Unknown shape: legacy behaviour for the simple two-line case only.
    if (out.length === 2) return normalizeLines(out.map((l) => ({ ...l, debit: l.debit ? newVal : 0, credit: l.credit ? newVal : 0 })));
    return out;
  }
  const delta = newVal - oldVal;
  const side: 'debit' | 'credit' = di >= 0 ? 'debit' : 'credit';
  const idx = di >= 0 ? di : ci;
  out[idx]![side] = newVal;
  if (marginAccount) {
    const mi = out.findIndex((l, i) => i !== idx && l.account === marginAccount);
    // Keep Σ debit = Σ credit: the margin line on the same side absorbs −delta.
    if (mi >= 0) out[mi]![side] = num(out[mi]![side]) - delta;
    else out.push({ account: marginAccount, debit: side === 'debit' ? -delta : 0, credit: side === 'credit' ? -delta : 0 });
  }
  return normalizeLines(out);
}

export interface ProductionRecord {
  id: string;
  date: string;
  product: string;
  qty: number;
  /** Material cost. */
  mat: number;
  /** Labour cost. */
  lab: number;
  unit?: number;
  [k: string]: unknown;
}

export interface ReaverageResult {
  /** All moves, with re-valued copies in place of changed ones (same order as the input). */
  moves: StockMove[];
  production: ProductionRecord[];
  /** Ids of moves whose value changed. */
  changedMoves: string[];
  /** Ids of production records whose cost changed. */
  changedProduction: string[];
}

/**
 * Legacy `reaverage()` (index.html 5101, ACT `runUprosek`): re-run the weighted average by date per item and
 * location, re-value every issue at the running average (2 decimals), fix the paired `transfer-in`, then re-cost
 * production and re-run for products.
 *
 * DELIBERATE FIXES:
 * - `pend` moves are ignored (as in `stock`); legacy averaged them in.
 * - the paired `transfer-in` is matched by `src` AND item (legacy took the first `transfer-in` of the document,
 *   so in a multi-item transfer every item overwrote the first item's value) and its journal lines are re-valued too.
 * - each item is iterated until stable, so a destination location processed before its source still gets the new
 *   transfer value (legacy single pass depended on move order).
 * - journal lines stay balanced (`revalueLines`); production uses scheme accounts, not hard-coded 6300/6000/4900.
 */
export function reaverage(ctx: StockContext, production: readonly ProductionRecord[] = []): ReaverageResult {
  const moves = ctx.moves.map((m) => ({ ...m }));
  const prods = production.map((p) => ({ ...p }));
  const changed = new Set<string>();
  const changedP: string[] = [];
  const live: StockContext = { ...ctx, moves };

  const setValue = (m: StockMove, nv: number, marginAcc?: string) => {
    const old = Math.abs(num(m.value));
    m.lines = revalueLines(m.lines ?? [], old, Math.abs(nv), marginAcc);
    m.value = nv;
    changed.add(m.id);
  };

  const pass = (types: string[]) => {
    for (const it of trackedItems(ctx).filter((i) => types.includes(String(i.type)))) {
      const mine = moves.filter((m) => m.item === it.id && !m.pend);
      const whs = [...new Set(mine.map(whOf))];
      for (let guard = 0, dirty = true; dirty && guard < 10; guard++) {
        dirty = false;
        for (const W of whs) {
          const mv = mine
            .filter((m) => whOf(m) === W)
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : +(num(b.qty) > 0) - +(num(a.qty) > 0)));
          let q = 0;
          let v = 0;
          for (const m of mv) {
            if (num(m.qty) > 0) {
              q += qunits(m.qty);
              v += cents(m.value);
              continue;
            }
            const avg = q > 0 ? (v * 100) / q : 0;
            const nv = r2(num(m.qty) * avg);
            if (Math.abs(nv - num(m.value)) > 0.009) {
              setValue(m, nv, retailOn(live, W) ? retailAccount(live, W, 'Marg') : undefined);
              dirty = true;
            }
            q += qunits(m.qty);
            v += cents(nv);
            if (m.type === 'transfer') {
              const tin = moves.find((x) => x.src === m.src && x.type === 'transfer-in' && x.item === m.item && !x.pend);
              if (tin && Math.abs(num(tin.value) + nv) > 0.009) {
                setValue(tin, -nv, retailAccount(live, tin.wh, 'Marg'));
                dirty = true;
              }
            }
          }
        }
      }
    }
  };

  pass(['goods', 'material']);
  const sch = stockScheme(ctx);
  for (const p of prods) {
    const outs = moves.filter((m) => m.src === p.id && m.type === 'prod-out' && !m.pend);
    const mat = fromCents(-outs.reduce((s, m) => s + cents(m.value), 0));
    if (Math.abs(mat - num(p.mat)) < 0.009) continue;
    const tot = r2(mat + num(p.lab));
    const pin = moves.find((m) => m.id === p.id + '-in');
    if (pin) {
      pin.value = tot;
      pin.lines = productionLines(sch, tot, num(p.lab));
      changed.add(pin.id);
    }
    p.mat = mat;
    p.unit = r2(tot / num(p.qty));
    changedP.push(p.id);
  }
  pass(['product']);
  return { moves, production: prods, changedMoves: [...changed], changedProduction: changedP };
}

/** COGS account for an item (re-exported convenience for issue callers). */
export const issueAccount = (ctx: StockContext, item: Pick<StockItem, 'type'>): string => cogsAccount(ctx, item);
