/**
 * Read side of the ledger: effective chart of accounts and journal lines as `@wise/core` `LedgerLine`s,
 * ready for `trialBalance`, `accountCard`, `closeYearLines`, `openYearLines`.
 */
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { LedgerLine } from '@wise/core';
import type { Tx } from './audit';
import { accounts, journalLines, journals } from './schema/index';

export interface ChartEntry { code: string; name: string; nameSq: string | null; global: boolean; overridden: boolean }

/**
 * Effective chart for a firm (legacy `ACC()` 3278): built-in accounts, renamed/added by firm overrides,
 * minus hidden ones. Sorted by code.
 */
export async function effectiveChart(db: Tx, firmId: string | null): Promise<ChartEntry[]> {
  const rows = await db.select().from(accounts)
    .where(firmId ? or(isNull(accounts.firmId), eq(accounts.firmId, firmId)) : isNull(accounts.firmId));
  const M = new Map<string, ChartEntry>();
  for (const r of rows.filter((x) => x.firmId == null)) M.set(r.code, { code: r.code, name: r.name, nameSq: r.nameSq, global: true, overridden: false });
  for (const r of rows.filter((x) => x.firmId != null)) {
    if (r.hidden) { M.delete(r.code); continue; }
    M.set(r.code, { code: r.code, name: r.name, nameSq: r.nameSq, global: M.has(r.code), overridden: true });
  }
  return [...M.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Journal lines of a firm in [from, to], in booking order (date, journal number, line number). */
export async function loadLedgerLines(db: Tx, firmId: string, from: string, to: string): Promise<LedgerLine[]> {
  const rows = await db.select({
    account: journalLines.account, debit: journalLines.debit, credit: journalLines.credit, partnerId: journalLines.partnerId,
    note: journalLines.note, doc: journalLines.doc, lineNo: journalLines.lineNo,
    date: journals.date, kind: journals.kind, journalId: journals.id, number: journals.number, description: journals.description,
  }).from(journalLines)
    .innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), sql`${journals.date} between ${from} and ${to}`))
    .orderBy(asc(journals.date), asc(journals.createdAt), asc(journals.id), asc(journalLines.lineNo));
  return rows.map((r) => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
}
