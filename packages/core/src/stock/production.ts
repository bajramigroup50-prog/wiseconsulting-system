/**
 * Production with a bill of materials (legacy `unitCost` 5629, `VIEWS.prod` 5647, `runProd` 5669).
 */
import type { StockContext, StockItem, StockMove } from './types';
import { num, r2, r4 } from './num';
import { stockScheme } from './accounts';
import { itemById } from './retail';
import { postOut, stock, type PostOutWarning, type ProductionRecord } from './average';
import { productionLines } from './journal';

const baseCost = (ctx: StockContext, it: StockItem): number => stock(ctx, it.id).avg || num(it.cost) || 0;

/**
 * Legacy `unitCost(it)`: cost of one unit — for a product with a BOM Σ component qty × component unit cost + labour
 * (2 decimals), otherwise the overall weighted average (or `item.cost`).
 *
 * DELIBERATE FIX (LEGACY-MAP §7.4 item 13): legacy recursed without a guard, so a BOM that contains itself (directly or
 * through another product) overflowed the stack and broke the normativ / prod / kalkCalc screens. A component already
 * on the current path is valued at its stock cost instead of being expanded again.
 */
export function unitCost(ctx: StockContext, item: StockItem | undefined, path: ReadonlySet<string> = new Set()): number {
  if (!item) return 0;
  const bom = item.bom ?? [];
  if (item.type === 'product' && bom.length && !path.has(item.id)) {
    const p = new Set(path).add(item.id);
    return r2(bom.reduce((s, b) => s + num(b.qty) * unitCost(ctx, itemById(ctx, b.item) ?? ({ id: b.item } as StockItem), p), 0) + num(item.labor));
  }
  return baseCost(ctx, item);
}

/**
 * The first cycle in a product's BOM, as the list of item ids `[product, …, product]`, or `null`.
 * Used to refuse saving a cyclic normativ.
 */
export function bomCycle(ctx: StockContext, productId: string, bomOverride?: StockItem['bom']): string[] | null {
  const visit = (id: string, path: string[]): string[] | null => {
    if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
    const it = itemById(ctx, id);
    const bom = id === productId && bomOverride ? bomOverride : it?.bom ?? [];
    if (!bom.length || (it && it.type !== 'product' && id !== productId)) return null;
    for (const b of bom) {
      const c = visit(b.item, [...path, id]);
      if (c) return c;
    }
    return null;
  };
  return visit(productId, []);
}

export interface ProductionNeed {
  item: StockItem;
  /** Quantity needed (4 decimals). */
  need: number;
  have: number;
  avg: number;
  value: number;
  short: boolean;
}

/** Material needs of a work order at a location (legacy `VIEWS.prod` table). */
export function productionNeeds(ctx: StockContext, product: StockItem, qty: number, wh?: string): { lines: ProductionNeed[]; mat: number; lab: number; total: number } {
  const q = num(qty);
  const lines = (product.bom ?? []).map((b) => {
    const it = itemById(ctx, b.item) ?? ({ id: b.item, name: '?' } as StockItem);
    const s = itemById(ctx, b.item) ? stock(ctx, it.id, wh || 'main') : { qty: 0, avg: 0 };
    const need = r4(num(b.qty) * q);
    return { item: it, need, have: s.qty, avg: s.avg, value: r2(need * s.avg), short: need > s.qty + 1e-9 };
  });
  const mat = r2(lines.reduce((s, x) => s + x.value, 0));
  const lab = r2(num(product.labor) * q);
  return { lines, mat, lab, total: r2(mat + lab) };
}

export interface RunProductionArgs {
  /** Work-order id; moves get `src = id`, the receipt `${id}-in` (legacy `prod-<uid>`). */
  id: string;
  product: StockItem;
  qty: number;
  date: string;
  wh?: string;
}

export interface RunProductionResult {
  /** Issues of every BOM component (`prod-out`) followed by the product receipt (`prod-in`). */
  moves: StockMove[];
  record: ProductionRecord;
  warnings: { item: string; warning: PostOutWarning }[];
}

/**
 * Legacy `runProd` (5669): issue every BOM component at weighted average (D production-in-progress / C stock), then
 * receive the product at material + labour cost (D product / C in-progress, D in-progress / C labour).
 *
 * DELIBERATE FIX (LEGACY-MAP §7.4 item 8): the accounts come from the scheme (`prodWip`, `prodLabour`, `product`)
 * instead of hard-coded 6000 / 4900 / 6300. Components are issued one after another against the running stock, like
 * the legacy sequential `await postOut`, so an item listed twice is valued correctly.
 */
export function runProduction(ctx: StockContext, a: RunProductionArgs): RunProductionResult {
  const q = num(a.qty);
  const p = a.product;
  const sch = stockScheme(ctx);
  const label = 'Производство ' + (p.name ?? '');
  const moves: StockMove[] = [];
  const warnings: RunProductionResult['warnings'] = [];
  let live: StockContext = ctx;
  let mat = 0;
  for (const b of p.bom ?? []) {
    const it = itemById(ctx, b.item);
    if (!it) continue;
    const r = postOut(live, { item: it, qty: r4(num(b.qty) * q), date: a.date, type: 'prod-out', src: a.id, label, debitAccount: sch.prodWip, wh: a.wh });
    if (r.warning) warnings.push({ item: it.id, warning: r.warning });
    mat += r.value;
    // Same id for the same component twice: legacy `save` overwrote the earlier move; keep both by suffixing.
    const dup = moves.filter((m) => m.id === r.move.id || m.id.startsWith(r.move.id + '#')).length;
    const mv = dup ? { ...r.move, id: r.move.id + '#' + dup } : r.move;
    moves.push(mv);
    live = { ...live, moves: [...live.moves, mv] };
  }
  mat = r2(mat);
  const lab = r2(num(p.labor) * q);
  const tot = r2(mat + lab);
  moves.push({
    id: a.id + '-in',
    wh: a.wh || 'main',
    date: a.date,
    item: p.id,
    qty: q,
    value: tot,
    type: 'prod-in',
    src: a.id,
    label,
    lines: productionLines(sch, tot, lab),
  });
  return { moves, record: { id: a.id, date: a.date, product: p.id, qty: q, mat, lab, unit: q ? r2(tot / q) : 0 }, warnings };
}
