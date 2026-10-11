/**
 * Shared PGlite harness of the workflow tests (`src/flows/*.test.ts`): migrated + seeded database, transaction
 * helper and ledger readers. The flows drive the same services the server actions call.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, gte, lte } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '../schema/index';
import { seedReference } from '../seed/reference';

export function harness() {
  const db = drizzle(new PGlite(), { schema });
  type DB = typeof db;
  const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
  const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
  const setup = async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)) });
    await seedReference(db);
  };
  /** Journal of a source with its lines and the net balance per account (debit − credit). */
  const journal = async (sourceType: string, sourceId: string) => {
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
    if (!j) return null;
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(schema.journalLines.lineNo);
    const by: Record<string, number> = {};
    for (const l of L) by[l.account] = r2((by[l.account] ?? 0) + Number(l.debit) - Number(l.credit));
    const debit = r2(L.reduce((s, l) => s + Number(l.debit), 0)), credit = r2(L.reduce((s, l) => s + Number(l.credit), 0));
    return { j, L, by, debit, credit };
  };
  /** Trial balance of a firm: net balance per account over a date range, plus total debit / credit turnover. */
  const trial = async (firmId: string, from = '1900-01-01', to = '2999-12-31') => {
    const L = await db.select({ a: schema.journalLines.account, d: schema.journalLines.debit, c: schema.journalLines.credit })
      .from(schema.journalLines).innerJoin(schema.journals, eq(schema.journals.id, schema.journalLines.journalId))
      .where(and(eq(schema.journals.firmId, firmId), gte(schema.journals.date, from), lte(schema.journals.date, to)));
    const by: Record<string, number> = {};
    let debit = 0, credit = 0;
    for (const l of L) { by[l.a] = r2((by[l.a] ?? 0) + Number(l.d) - Number(l.c)); debit += Number(l.d); credit += Number(l.c); }
    return { by, debit: r2(debit), credit: r2(credit) };
  };
  /** Sum of balances of the accounts starting with a prefix. */
  const sumPrefix = (by: Record<string, number>, p: string) => r2(Object.entries(by).filter(([a]) => a.startsWith(p)).reduce((s, [, v]) => s + v, 0));
  return { db, tx, err, setup, journal, trial, sumPrefix };
}

export const r2 = (v: number) => Math.round(v * 100) / 100;
