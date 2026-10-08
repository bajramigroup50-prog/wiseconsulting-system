import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { LedgerLine } from '@wise/core';
import { journalLines, journals } from '@wise/db';
import { db } from './db';

/**
 * Journal lines of [from, to] pre-aggregated in SQL by account × partner × kind class
 * (open / close / bbimp / other). The result is a valid `LedgerLine[]` input for `trialBalance`
 * (dates collapse to `from`, which is inside the period), without loading every line of a large firm.
 */
export async function aggregatedLines(firmId: string, from: string, to: string): Promise<LedgerLine[]> {
  const kindClass = sql<string>`case when ${journals.kind} in ('open','close','bbimp') then ${journals.kind} else 't' end`;
  const rows = await db().select({
    account: journalLines.account, partnerId: journalLines.partnerId, kind: kindClass,
    debit: sql<string>`sum(${journalLines.debit})`, credit: sql<string>`sum(${journalLines.credit})`,
  }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), sql`${journals.date} between ${from} and ${to}`))
    .groupBy(journalLines.account, journalLines.partnerId, kindClass);
  return rows.map((r) => ({ account: r.account, partnerId: r.partnerId, kind: r.kind, date: from, debit: Number(r.debit), credit: Number(r.credit) }));
}
