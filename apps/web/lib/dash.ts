import 'server-only';
/** Ledger / document aggregates for the control dashboard (`home`) and the analysis board (`klDash`). */
import { and, eq, ne, sql } from 'drizzle-orm';
import { Stock } from '@wise/core';
import type { AcctMonth } from '@wise/core/firms/dash';
import { bankAccounts, journalLines, journals, loadStockContext, type Tx } from '@wise/db';
import { db } from './db';

/** Journal lines of the business year per account × month (year-close journal excluded, legacy `ledger({excl:['close']})`). */
export async function acctMonths(firmId: string, year: number, tx: Tx = db()): Promise<AcctMonth[]> {
  const R = await tx.select({
    account: journalLines.account, month: sql<number>`extract(month from ${journals.date})::int`,
    debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})`,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), ne(journals.kind, 'close'), sql`${journals.date} between ${`${year}-01-01`} and ${`${year}-12-31`}`))
    .groupBy(journalLines.account, sql`extract(month from ${journals.date})`);
  return R.map((r) => ({ account: r.account, month: r.month, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
}

/** Legacy `bankKontos()` + 1020. */
export async function cashKontos(firmId: string, tx: Tx = db()): Promise<Set<string>> {
  const B = await tx.select({ k: bankAccounts.konto }).from(bankAccounts).where(eq(bankAccounts.firmId, firmId));
  return new Set([...B.map((b) => b.k), '1020']);
}

/** Journal lines of a date range per account × day (klDash expenses). */
export async function acctDays(firmId: string, from: string, to: string, tx: Tx = db()) {
  const R = await tx.select({ account: journalLines.account, date: journals.date, debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})` })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), ne(journals.kind, 'close'), sql`${journals.date} between ${from} and ${to}`))
    .groupBy(journalLines.account, journals.date);
  return R.map((r) => ({ account: r.account, date: r.date, debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
}

/** Balance (debit − credit) of accounts starting with `prefix` up to `to` within the year (klDash `bal`). */
export async function prefixBalance(firmId: string, prefix: string, year: number, to: string, tx: Tx = db()): Promise<number> {
  const [r] = await tx.select({ b: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), ne(journals.kind, 'close'), sql`${journalLines.account} like ${prefix + '%'}`, sql`${journals.date} between ${`${year}-01-01`} and ${to}`));
  return Math.round((Number(r?.b) || 0) * 100) / 100;
}

/** Stock value (purchase value) in warehouses and stores, items below minimum, items with negative stock. */
export async function stockSummary(firmId: string, tx: Tx = db()) {
  const L = await loadStockContext(tx, firmId);
  let wh = 0, st = 0, neg = 0, low = 0;
  const locs = [{ id: 'main', kind: 'warehouse' as const }, ...L.locations.filter((l) => l.id !== 'main')];
  for (const it of Stock.trackedItems(L.ctx)) {
    let q = 0, n = false;
    for (const l of locs) {
      const b = Stock.stock(L.ctx, it.id, l.id);
      if (l.kind === 'store') st += b.value; else wh += b.value;
      q += b.qty;
      if (b.qty < -1e-6) n = true;
    }
    if (n) neg++;
    const min = Number(L.items.get(it.id)?.minStock ?? 0);
    if (min && q < min) low++;
  }
  return { wh: Math.round(wh * 100) / 100, st: Math.round(st * 100) / 100, neg, low };
}
