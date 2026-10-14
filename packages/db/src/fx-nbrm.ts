/**
 * „💱 Курсна листа НБРМ“: storing the official NBRM middle rates in the office rate list (`fx_rates`, `source = 'nbrm'`).
 * `fxRate` (firm codebook → this list → `FX_DEF`) then uses them automatically as the default rate of foreign-currency
 * invoices, import purchases, bank statements and cash vouchers; weekends / holidays take the last published list.
 *
 * A rate entered by hand (Курсна листа, Excel import — `source = 'manual'`) is never overwritten by the daily fetch;
 * deleting that day's manual list lets the next fetch fill it.
 */
import { and, asc, gte, lte, ne, sql } from 'drizzle-orm';
import { nbrmChunks, nbrmUrl, parseNbrm, type NbrmRate } from '@wise/core/bank/nbrm';
import { addDays, todaySkopje } from '@wise/core/office';
import { audit, type Tx } from './audit';
import { fxRates } from './schema/index';

export interface NbrmSaveResult { saved: number; skippedManual: number; dates: number }

/** Upsert the NBRM rows; manual rates of the same day and currency stay. */
export async function saveNbrmRates(tx: Tx, rows: readonly NbrmRate[], o: { userId?: string | null; audit?: boolean } = {}): Promise<NbrmSaveResult> {
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await tx.insert(fxRates).values(chunk.map((x) => ({ date: x.date, cur: x.cur, rate: x.rate.toFixed(6), source: 'nbrm', updatedBy: o.userId ?? null })))
      .onConflictDoUpdate({ target: [fxRates.date, fxRates.cur], set: { rate: sql`excluded.rate`, updatedBy: sql`excluded.updated_by` }, setWhere: ne(fxRates.source, 'manual') })
      .returning({ id: fxRates.id });
    saved += r.length;
  }
  const dates = new Set(rows.map((r) => r.date)).size;
  if (o.audit !== false && rows.length) {
    await audit(tx, { userId: o.userId ?? null, firmId: null, action: 'fxNbrm', entityType: 'fx_rates', entityId: rows[0]!.date, data: { from: rows[0]!.date, to: rows[rows.length - 1]!.date, rates: saved, skippedManual: rows.length - saved } });
  }
  return { saved, skippedManual: rows.length - saved, dates };
}

export type FetchText = (url: string) => Promise<string>;
const httpText: FetchText = async (url) => {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`НБРМ: HTTP ${r.status}`);
  return r.text();
};

/**
 * Fetch the NBRM lists of `[from, to]` (31-day chunks) and store them. Default window: the last 7 days up to tomorrow
 * (the next day's list is published in the afternoon). Used by the worker `nbrm.rates` and „⬇ Преземи од НБРМ“.
 */
export async function runNbrm(db: Tx, d: { from?: string; to?: string; userId?: string | null } = {}, fetchText: FetchText = httpText) {
  const today = todaySkopje();
  const from = d.from ?? addDays(today, -7), to = d.to ?? addDays(today, 1);
  const all: NbrmRate[] = [];
  for (const [a, b] of nbrmChunks(from, to, 31)) all.push(...parseNbrm(await fetchText(nbrmUrl(a, b))));
  const r = all.length ? await db.transaction((tx) => saveNbrmRates(tx, all, { userId: d.userId ?? null })) : { saved: 0, skippedManual: 0, dates: 0 };
  return { from, to, fetched: all.length, ...r };
}

/** Dates in `[from, to]` that have at least one stored rate (to report gaps after a backfill). */
export async function fxDatesIn(tx: Tx, from: string, to: string): Promise<string[]> {
  const R = await tx.selectDistinct({ date: fxRates.date }).from(fxRates).where(and(gte(fxRates.date, from), lte(fxRates.date, to))).orderBy(asc(fxRates.date));
  return R.map((r) => r.date);
}
