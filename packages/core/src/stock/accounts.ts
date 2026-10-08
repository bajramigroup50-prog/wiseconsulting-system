import type { StockContext, StockItem, StockJournalLine, StockLocation, StockScheme } from './types';
import { cents, fromCents, num } from './num';

/**
 * Defaults = legacy `SCH0` stock keys (index.html 3174), with two deliberate fixes:
 * - `whStock` was the 3-digit typo `'660'`; it is `'6600'` here.
 * - production accounts `prodWip`/`prodLabour` were hard-coded 6000/4900 in `runProd`/`reaverage`; they are scheme keys now.
 */
export const STOCK_SCHEME_DEFAULTS: Readonly<StockScheme> = Object.freeze({
  stock: '6600',
  material: '3100',
  product: '6300',
  cogs: '7010',
  cogsP: '7000',
  retailMethod: false,
  whSaleMethod: false,
  retailStock: '6630',
  retailMarg: '6694',
  retailVat: '6640',
  whStock: '6600',
  whMarg: '6690',
  whVat: '6640',
  prodWip: '6000',
  prodLabour: '4900',
});

export function stockScheme(ctx: Pick<StockContext, 'scheme'>): StockScheme {
  const out: StockScheme = { ...STOCK_SCHEME_DEFAULTS };
  const o = ctx.scheme ?? {};
  for (const k of Object.keys(out) as (keyof StockScheme)[]) {
    const v = o[k];
    if (v !== undefined && v !== '') (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Legacy `whOf`. */
export const whOf = (x: { wh?: string | null }): string => x.wh || 'main';

/** Legacy `locRow`: the configured row of a non-main location. */
export function locationRow(ctx: Pick<StockContext, 'locations'>, wh: string | undefined): StockLocation | undefined {
  return wh && wh !== 'main' ? (ctx.locations ?? []).find((l) => l.id === wh) : undefined;
}

/** Legacy `kindOf`: `'main'` and unknown ids are warehouses. */
export function locationKind(ctx: Pick<StockContext, 'locations'>, wh: string | undefined): 'warehouse' | 'store' {
  return locationRow(ctx, wh || 'main')?.kind ?? 'warehouse';
}

/** Legacy `retailOn`: is this location kept at retail value? */
export function retailOn(ctx: StockContext, wh: string | undefined): boolean {
  const s = stockScheme(ctx);
  return locationKind(ctx, wh) === 'store' ? !!s.retailMethod : !!s.whSaleMethod;
}

export type RetailAccountKey = 'Stock' | 'Marg' | 'Vat';

/** Legacy `rk(w,key)`: retail-value accounts of a location (override on the location row, else scheme by kind). */
export function retailAccount(ctx: StockContext, wh: string | undefined, key: RetailAccountKey): string {
  const row = locationRow(ctx, wh);
  const field = ({ Stock: 'konto', Marg: 'kMarg', Vat: 'kVat' } as const)[key];
  const ov = row ? String(row[field] ?? '').trim() : '';
  if (ov) return ov;
  const s = stockScheme(ctx);
  return locationKind(ctx, wh) === 'store' ? s[`retail${key}`] : s[`wh${key}`];
}

/** Legacy `STOCK_K[type]`. */
export function stockAccountForType(ctx: StockContext, type: string | undefined): string | undefined {
  const s = stockScheme(ctx);
  return type === 'goods' ? s.stock : type === 'material' ? s.material : type === 'product' ? s.product : undefined;
}

/** Legacy `COGS_K[type]` (goods/material → cogs, product → cogsP). Unknown types fall back to goods, like most callers. */
export function cogsAccount(ctx: StockContext, item: Pick<StockItem, 'type'>): string {
  const s = stockScheme(ctx);
  return item.type === 'product' ? s.cogsP : s.cogs;
}

/** Legacy `stockK(w,it)`: cost-value stock account of an item at a location. */
export function stockAccount(ctx: StockContext, wh: string | undefined, item?: Pick<StockItem, 'type'>): string {
  const row = locationRow(ctx, wh);
  const ov = row ? String(row.konto ?? '').trim() : '';
  if (ov && (!item || item.type === 'goods')) return ov;
  return stockAccountForType(ctx, item?.type) || '6600';
}

/** Legacy `posL`: move negative amounts to the other side, round to cents, drop empty lines. */
export function normalizeLines(lines: readonly StockJournalLine[]): StockJournalLine[] {
  return lines
    .map((l) => {
      let d = num(l.debit);
      let p = num(l.credit);
      if (d < 0) {
        p -= d;
        d = 0;
      }
      if (p < 0) {
        d -= p;
        p = 0;
      }
      return { ...l, debit: fromCents(cents(d)), credit: fromCents(cents(p)) };
    })
    .filter((l) => l.debit || l.credit);
}

/** Σ debit === Σ credit, compared in integer cents. */
export function stockLinesBalanced(lines: readonly StockJournalLine[]): boolean {
  let d = 0;
  let p = 0;
  for (const l of lines) {
    d += cents(l.debit);
    p += cents(l.credit);
  }
  return d === p;
}

/** Convert to/from the legacy `{k,d,p}` line shape (used by importers and golden tests). */
export const toLegacyLines = (lines: readonly StockJournalLine[]) =>
  lines.map(({ account, debit, credit, ...rest }) => ({ k: account, d: debit, p: credit, ...rest }));
export const fromLegacyLines = (lines: readonly { k: string; d: number; p: number; [x: string]: unknown }[]): StockJournalLine[] =>
  lines.map(({ k, d, p, ...rest }) => ({ ...(rest as object), account: String(k), debit: num(d), credit: num(p) }));
