/**
 * „🗑 Избриши ги сите изводи“ — delete every statement of one bank account (or of all accounts) in a date range,
 * draft and posted alike (their journals are removed by `deleteStatement`). Statements in a locked period (firm
 * lock date) or with a locked nalog are skipped and listed. One transaction (the caller's), one audit row.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { audit, type Tx } from '../audit';
import { PostingError } from '../posting';
import { bankAccounts, bankLines, bankStatements, journals } from '../schema/index';
import { BankError, cents, den } from './context';
import { BANK_SOURCE_TYPE } from './open-items';
import { assertStatementOpen } from './posting';
import { deleteStatement } from './lines';

export interface BulkStatementsFilter {
  firmId: string;
  /** Bank account ids to include (already narrowed by the caller, e.g. the MKD or FX accounts of the view). */
  accountIds: string[];
  from: string;
  to: string;
}

export interface BulkAccountSummary {
  accountId: string;
  name: string;
  /** Statements that will be deleted (open period). */
  count: number;
  posted: number;
  firstNo: string | null; firstDate: string | null;
  lastNo: string | null; lastDate: string | null;
  /** Denars of the deletable statements. */
  inflow: number;
  outflow: number;
  lines: number;
}

export interface BulkSkipped { statementId: string; accountId: string; number: string | null; date: string; why: string }

export interface BulkStatementsPlan {
  accounts: BulkAccountSummary[];
  skipped: BulkSkipped[];
  /** Ids of the deletable statements (in date order). */
  ids: string[];
  total: number;
  posted: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Preview: what „Избриши ги сите изводи“ would delete, per account, and which statements are locked. */
export async function bulkDeleteStatementsPlan(tx: Tx, f: BulkStatementsFilter): Promise<BulkStatementsPlan> {
  if (!DATE_RE.test(f.from) || !DATE_RE.test(f.to) || f.from > f.to) throw new BankError('Неважечки период.');
  const out: BulkStatementsPlan = { accounts: [], skipped: [], ids: [], total: 0, posted: 0 };
  if (!f.accountIds.length) return out;
  const A = await tx.select({ id: bankAccounts.id, name: bankAccounts.name, sort: bankAccounts.sort }).from(bankAccounts)
    .where(and(eq(bankAccounts.firmId, f.firmId), inArray(bankAccounts.id, f.accountIds))).orderBy(asc(bankAccounts.sort), asc(bankAccounts.name));
  if (!A.length) return out;
  const S = await tx.select().from(bankStatements)
    .where(and(eq(bankStatements.firmId, f.firmId), inArray(bankStatements.bankAccountId, A.map((a) => a.id)), sql`${bankStatements.date} between ${f.from} and ${f.to}`))
    .orderBy(asc(bankStatements.date));
  if (!S.length) return out;
  const ids = S.map((s) => s.id);
  const sums = await tx.select({
    id: bankLines.statementId,
    inflow: sql<string>`coalesce(sum(case when ${bankLines.amount} > 0 then ${bankLines.amount} else 0 end), 0)`,
    outflow: sql<string>`coalesce(sum(case when ${bankLines.amount} < 0 then -${bankLines.amount} else 0 end), 0)`,
    n: sql<number>`count(*)::int`,
  }).from(bankLines).where(inArray(bankLines.statementId, ids)).groupBy(bankLines.statementId);
  const sumOf = new Map(sums.map((x) => [x.id, x]));
  const J = await tx.select({ id: journals.sourceId }).from(journals)
    .where(and(eq(journals.firmId, f.firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), inArray(journals.sourceId, ids)));
  const hasJ = new Set(J.map((j) => j.id));
  const byAcct = new Map<string, BulkAccountSummary>(A.map((a) => [a.id, {
    accountId: a.id, name: a.name, count: 0, posted: 0, firstNo: null, firstDate: null, lastNo: null, lastDate: null, inflow: 0, outflow: 0, lines: 0,
  }]));
  for (const st of S) {
    try { await assertStatementOpen(tx, st); } catch (e) {
      if (!(e instanceof PostingError)) throw e;
      out.skipped.push({ statementId: st.id, accountId: st.bankAccountId, number: st.number, date: st.date, why: e.message });
      continue;
    }
    const a = byAcct.get(st.bankAccountId)!;
    const x = sumOf.get(st.id);
    const posted = st.status === 'posted' || hasJ.has(st.id);
    a.count++;
    if (posted) a.posted++;
    if (!a.firstDate) { a.firstDate = st.date; a.firstNo = st.number; }
    a.lastDate = st.date; a.lastNo = st.number;
    a.inflow += cents(x?.inflow); a.outflow += cents(x?.outflow); a.lines += x?.n ?? 0;
    out.ids.push(st.id);
  }
  out.accounts = [...byAcct.values()].filter((a) => a.count).map((a) => ({ ...a, inflow: den(a.inflow), outflow: den(a.outflow) }));
  out.total = out.ids.length;
  out.posted = out.accounts.reduce((s, a) => s + a.posted, 0);
  return out;
}

/**
 * Delete every statement of the plan through `deleteStatement` (journals unposted), skipping the locked ones.
 * Writes ONE audit row (`delStatements`) with the range, the counts and the skipped statements.
 */
export async function bulkDeleteStatements(tx: Tx, f: BulkStatementsFilter & { userId: string | null }): Promise<BulkStatementsPlan> {
  const plan = await bulkDeleteStatementsPlan(tx, f);
  for (const id of plan.ids) await deleteStatement(tx, { firmId: f.firmId, userId: f.userId, statementId: id, audit: false });
  if (plan.total || plan.skipped.length) {
    await audit(tx, {
      userId: f.userId, firmId: f.firmId, action: 'delStatements', entityType: 'bank_statement',
      data: {
        from: f.from, to: f.to, accounts: f.accountIds, deleted: plan.total, posted: plan.posted,
        perAccount: plan.accounts.map((a) => ({ id: a.accountId, n: a.count, first: a.firstNo, last: a.lastNo })),
        skipped: plan.skipped.map((s) => ({ id: s.statementId, number: s.number, date: s.date })),
      },
    });
  }
  return plan;
}
