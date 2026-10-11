/**
 * Stock / production parity helpers (legacy features the first port left out). Pure; persisted by `@wise/db`
 * `parity-stock.ts`.
 *
 * - `pnbPlan` — legacy 13922: a work order without a normativ issues materials worth `qty × sale price × pct%`, spread
 *   over the materials on stock in proportion to their stock value (never more than the stock).
 * - `maxProducible` / `bomHint` — legacy v439 hint (13919): per-unit normativ, stock, "enough for" and the maximum
 *   quantity that can be produced at a location.
 * - `transferMarginPrice` — legacy `prMargin` (PR_ACT 5589): retail price = average cost × (1 + margin%) × (1 + VAT%),
 *   rounded to the chosen step (prices below 5 steps are rounded to 0.01).
 * - `parseQuickLines` — legacy `pcQuickAdd` (13979): pasted lines „шифра количина“.
 * - `transferFromCalc` — legacy `prAddCalc` 5577: lines of a purchase calculation, limited to the stock at the source.
 * - `lagerExportRows` — legacy `lagAoa` 4959: the stock-list Excel layout (Р.б., Шифра, Баркод, Назив, Ед., Вид, …).
 */
import type { StockContext, StockItem } from './stock/types';
import { stock, stockAt } from './stock/average';
import { num, r2, r4 } from './stock/num';

/** Items whose stock can be issued without a normativ (legacy `rnItems`): active materials and goods, materials first. */
export function rnItems<T extends Pick<StockItem, 'type' | 'name'> & { active?: boolean | null }>(items: readonly T[]): T[] {
  return items.filter((i) => i.active !== false && (i.type === 'material' || i.type === 'goods'))
    .sort((a, b) => (a.type === 'material' ? 0 : 1) - (b.type === 'material' ? 0 : 1) || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'mk'));
}

export interface PnbLine { itemId: string; qty: number; value: number; have: number; avg: number }
export interface PnbPlan { total: number; lines: PnbLine[]; short: number }

/** Legacy `pnbPlan(p, q, wh, pct)`. `materials` = `rnItems(...)`. */
export function pnbPlan(ctx: StockContext, product: Pick<StockItem, 'price'>, qty: number, wh: string, pct: number, materials: readonly Pick<StockItem, 'id'>[]): PnbPlan {
  const total = r2(num(qty) * num(product.price) * num(pct) / 100);
  const M = materials.map((it) => {
    const s = stock(ctx, it.id, wh);
    return { id: it.id, s, av: r2(Math.max(0, s.qty) * (s.avg || 0)) };
  }).filter((x) => x.av > 0);
  const sv = M.reduce((a, x) => a + x.av, 0);
  const lines = M.map((x) => {
    const v = sv ? r2(Math.min(x.av, (total * x.av) / sv)) : 0;
    return { itemId: x.id, value: v, qty: x.s.avg > 0 ? r4(v / x.s.avg) : 0, have: x.s.qty, avg: x.s.avg };
  }).filter((x) => x.qty > 0);
  return { total, lines, short: r2(total - lines.reduce((a, x) => a + x.value, 0)) };
}

export interface BomHintRow { itemId: string; perUnit: number; have: number; enough: number | null }

/** Legacy v439 hint table and „Најмногу може да се произведе“. */
export function bomHint(ctx: StockContext, product: Pick<StockItem, 'bom'>, wh: string): { rows: BomHintRow[]; max: number } {
  const rows = (product.bom ?? []).filter((b) => ctx.items?.some((i) => i.id === b.item)).map((b) => {
    const have = stock(ctx, b.item, wh).qty;
    const per = num(b.qty);
    return { itemId: b.item, perUnit: per, have, enough: per > 0 ? Math.floor(have / per) : null };
  });
  const lim = rows.map((r) => (r.enough == null ? Infinity : r.enough));
  const max = rows.length ? Math.max(0, Math.min(...lim)) : 0;
  return { rows, max: Number.isFinite(max) ? max : 0 };
}
export const maxProducible = (ctx: StockContext, product: Pick<StockItem, 'bom'>, wh: string): number => bomHint(ctx, product, wh).max;

/** Legacy `prMargin`: retail price incl. VAT from the average cost, margin % and the rounding step. */
export function transferMarginPrice(avg: number, ratePct: number, marginPct: number, step: number): number {
  if (!(avg > 0)) return 0;
  const sp = avg * (1 + marginPct / 100) * (1 + ratePct / 100);
  const rr = sp < step * 5 ? 0.01 : step;
  return r2(Math.round(sp / rr) * rr);
}

/** Legacy `pcQuickAdd` line split: `code qty` per line (tab, `;`, 2+ spaces or the last number). */
export function parseQuickLines(text: string): { code: string; qty: string }[] {
  return text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const p = x.split(/[\t;]+|\s{2,}|\s+(?=[\d.,]+\s*$)/).map((s) => s.trim()).filter(Boolean);
    return { code: p[0] ?? '', qty: p[p.length - 1] ?? '' };
  }).filter((l) => l.code && l.qty && l.code !== l.qty);
}

/** Legacy `prAddCalc(p)`: calculation lines → transfer lines limited to the stock at the source on the date. */
export function transferFromCalc(ctx: StockContext, stockLines: readonly { item: string | null; qty: number; sp?: number | string | null }[], from: string, to: string, date: string): { itemId: string; qty: number; sp: number | null }[] {
  const out: { itemId: string; qty: number; sp: number | null }[] = [];
  for (const s of stockLines) {
    if (!s.item || !num(s.qty)) continue;
    const it = ctx.items?.find((i) => i.id === s.item);
    if (!it || it.type === 'service') continue;
    const have = stockAt(ctx, { item: s.item, wh: from, date }).qty;
    const q = r4(Math.max(0, Math.min(num(s.qty), have)));
    const ex = out.find((l) => l.itemId === s.item);
    if (ex) { ex.qty = r4(ex.qty + q); continue; }
    const cur = (it.sp ?? {})[to];
    out.push({ itemId: s.item, qty: q, sp: cur != null && cur !== '' ? num(cur) : s.sp != null && s.sp !== '' ? num(s.sp) : null });
  }
  return out;
}

export const ITEM_TYPES: Readonly<Record<string, string>> = { service: 'Услуга', goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };

/**
 * Legacy `lagAoa(v)`: `[Р.б., Шифра, Баркод, Назив, Ед., Вид, …columns]`; blank columns (`b`) stay empty, other
 * values as numbers (`+x || 0`).
 */
export function lagerExportRows<C extends { label: string; kind: string }>(cols: readonly C[], rows: readonly { code?: string | null; barcode?: string | null; name?: string | null; unit?: string | null; type?: string | null; values: readonly (number | string)[] }[]): (string | number)[][] {
  return [
    ['Р.б.', 'Шифра', 'Баркод', 'Назив', 'Ед.', 'Вид', ...cols.map((c) => c.label)],
    ...rows.map((r, i) => [i + 1, r.code ?? '', r.barcode ?? '', r.name ?? '', r.unit ?? '', ITEM_TYPES[String(r.type ?? '')] ?? '',
      ...cols.map((c, k) => { const x = r.values[k]; return x === '' || c.kind === 'b' ? '' : Number(x) || 0; })]),
  ];
}
