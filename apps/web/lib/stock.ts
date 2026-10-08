import 'server-only';
/**
 * Shared server helpers for the Phase 7 stock & retail pages: page guard with the firm's stock context, date ranges
 * within the business year (legacy `rangeOf`), location options, and the server-action wrapper.
 */
import { revalidatePath } from 'next/cache';
import { retailPrice, stock } from '@wise/core';
import type { ItemOpt } from '@/app/(app)/_stock/editors';
import { PostingError, StockDocError, loadStockContext, MAIN_LOCATION, type LoadedStock, type Tx } from '@wise/db';
import { Forbidden } from './auth';
import { actionError, booksPage, firmAction, type ActionState, type BooksCtx } from './books';
import { db } from './db';

export interface StockCtx extends BooksCtx { L: LoadedStock | null }

/** Page guard + stock context of the current firm (null when no firm is selected). */
export async function stockPage(view: string): Promise<StockCtx> {
  const c = await booksPage(view);
  return { ...c, L: c.firm ? await loadStockContext(db(), c.firm.id) : null };
}

/** Today in Skopje, `YYYY-MM-DD`. */
export const todayIso = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Skopje' });

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Default "to" date of the business year: today when it is the current year, else 31.12. */
export const yearEnd = (year: number): string => {
  const t = todayIso();
  return t.startsWith(String(year)) ? t : `${year}-12-31`;
};

/** Legacy `rangeOf(p)`: from/to within the business year, defaults 01.01 – today (or 31.12). */
export function rangeOf(sp: { from?: string; to?: string }, year: number): [string, string] {
  const y = String(year);
  const from = sp.from && ISO.test(sp.from) && sp.from.startsWith(y) ? sp.from : `${y}-01-01`;
  const to = sp.to && ISO.test(sp.to) && sp.to.startsWith(y) ? sp.to : yearEnd(year);
  return [from, to];
}

/** A date within the business year, else the default (legacy `lagDate`). */
export const dateInYear = (v: string | undefined, year: number): string => (v && ISO.test(v) && v.startsWith(String(year)) ? v : yearEnd(year));

export interface LocOpt { id: string; name: string; kind: 'warehouse' | 'store' }

/** Locations (legacy `locs()`): the main warehouse first, then the firm's warehouses and stores. */
export const locOptions = (L: LoadedStock, kind?: 'warehouse' | 'store'): LocOpt[] =>
  [MAIN_LOCATION, ...L.locations].filter((l) => !kind || l.kind === kind).map((l) => ({ id: l.id, name: l.name ?? l.id, kind: l.kind }));

/** A known location id from a query value (empty = all). */
export const pickLoc = (L: LoadedStock, v: string | undefined): string => (v && (v === 'main' || L.locations.some((l) => l.id === v)) ? v : '');

/**
 * Server-action wrapper: guard (`requireCan(action, firm)`), one transaction, user errors → `{ error }`,
 * revalidate the given paths.
 */
export async function stockAction<T>(action: string, paths: string[], f: (tx: Tx, a: { firmId: string; userId: string }) => Promise<T>): Promise<ActionState & { data?: T }> {
  try {
    const { u, firm } = await firmAction(action);
    const data = await db().transaction((tx) => f(tx as unknown as Tx, { firmId: firm.id, userId: u.id }));
    for (const p of paths) revalidatePath(p);
    return { ok: 'Зачувано.', data };
  } catch (e) {
    if (e instanceof StockDocError || e instanceof PostingError || e instanceof Forbidden) return { error: e.message };
    return actionError(e);
  }
}

/** Items for the client editors: retail price and current stock per location, overall average cost. */
export function itemOptions(L: LoadedStock, opts: { services?: boolean } = {}): ItemOpt[] {
  const locs = ['main', ...L.locations.map((l) => l.id)];
  return (L.ctx.items ?? [])
    .filter((i) => opts.services || (i.type && i.type !== 'service'))
    .map((it) => ({
      id: it.id, code: it.code ?? '', name: it.name ?? '', unit: it.unit ?? '', type: String(it.type ?? ''), rate: Number(it.rate ?? 18),
      sp: Object.fromEntries(locs.map((w) => [w, retailPrice(it, w)])),
      have: Object.fromEntries(locs.map((w) => [w, stock(L.ctx, it.id, w).qty])),
      avg: stock(L.ctx, it.id).avg,
    }))
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name, 'mk', { numeric: true }));
}

/** Number from a form value (`1.234,5` or `1234.5`). */
export const numIn = (v: unknown): number => {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  const x = Number(/,\d*$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(x) ? x : NaN;
};
