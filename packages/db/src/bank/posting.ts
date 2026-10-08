/**
 * Posting of bank statements: one journal per statement (kind `bank`, numbered per bank account and
 * period — 6/66… or 7/77…), lines from `bankEntries` (FX differences 7810/4810, salary splits, the neutral
 * FX side of a currency conversion). A statement with unbooked lines stays a draft without a journal.
 */
import { and, asc, eq } from 'drizzle-orm';
import { BKPK_RE, bankEffKonto, bankEntries, fxDifference, type BankTxn } from '@wise/core';
import type { Tx } from '../audit';
import { assertOpenPeriod, postJournal, PostingError, unpostSource, type PostLineInput } from '../posting';
import { bankAccounts, bankLines, bankStatements, journals, type BankLine, type BankStatement } from '../schema/index';
import { cents, den, loadBankEnv, loadFirm, type BankEnv } from './context';
import { BANK_SOURCE_TYPE } from './open-items';
import { toBankRow } from './rows';

const dmy = (d: string) => d.split('-').reverse().join('.');

/** Why a line cannot be posted yet ('' = ok). */
export function lineProblem(l: BankLine, fx: boolean): string {
  const r = toBankRow(l);
  if (!r.amount && !(fx && r.amountCur)) return '';
  if (fx && !r.amount) return 'нема курс (износ во денари)';
  if (!l.konto && !l.refId && !(l.split && l.split.length)) return 'непрокнижено';
  if (BKPK_RE.test(bankEffKonto(r)) && !l.partnerId) return 'нема комитент';
  return '';
}

/** Journal lines of a statement (exported for tests / the nalog preview). */
export function statementJournalLines(env: BankEnv, acct: { konto: string; cur: string }, lines: BankLine[]): PostLineInput[] {
  const fx = (acct.cur || 'MKD') !== 'MKD';
  const out: PostLineInput[] = [];
  for (const l of lines) {
    const r = toBankRow(l);
    const txn: BankTxn = {
      id: l.id, date: l.date, amount: den(r.amount), konto: r.konto, partner: r.partner,
      ref: r.ref ?? null, settle: r.settle != null ? den(r.settle) : null,
      split: r.split?.map((x) => ({ k: x.k, a: den(x.a), n: x.n })), conv: r.conv,
    };
    const J = bankEntries(txn, env.posting, { konto: acct.konto, cur: acct.cur });
    const note = (l.name || l.description || '').slice(0, 200);
    for (const j of J) {
      const onBank = j.account === acct.konto;
      out.push({
        account: j.account, debit: j.debit, credit: j.credit, partnerId: j.partnerId || null,
        note: j.note || note, doc: l.refLabel || l.bref || null,
        ...(fx && onBank && l.amountCur != null ? { currency: acct.cur, amountCur: Math.abs(Number(l.amountCur)) } : {}),
      });
    }
  }
  return out;
}

export interface PostStatementResult { status: 'draft' | 'posted'; number?: string; problems: { lineId: string; lineNo: number; problem: string }[] }

/**
 * (Re-)post one statement inside the caller's transaction: complete → journal replaced in place; incomplete →
 * journal removed and the statement goes back to `draft`. Period lock: throws `PostingError('locked')`.
 */
export async function postStatement(tx: Tx, statementId: string, userId: string | null, env?: BankEnv): Promise<PostStatementResult> {
  const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, statementId)).limit(1);
  if (!st) throw new Error('Изводот не постои.');
  const E = env ?? (await loadBankEnv(tx, st.firmId));
  const [acct] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, st.bankAccountId)).limit(1);
  const L = await tx.select().from(bankLines).where(eq(bankLines.statementId, st.id)).orderBy(asc(bankLines.lineNo));
  const fx = (acct!.cur || 'MKD') !== 'MKD';
  const problems = L.map((l) => ({ lineId: l.id, lineNo: l.lineNo, problem: lineProblem(l, fx) })).filter((p) => p.problem);
  const src = { firmId: st.firmId, sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId };
  const lines = problems.length ? [] : statementJournalLines(E, { konto: acct!.konto, cur: acct!.cur }, L);
  if (problems.length || !lines.length) {
    await unpostSource(tx, src);
    const status = problems.length ? 'draft' : 'posted';
    if (st.status !== status) await tx.update(bankStatements).set({ status }).where(eq(bankStatements.id, st.id));
    return { status, problems };
  }
  const j = await postJournal(tx, {
    firmId: st.firmId, date: st.date, kind: 'bank', sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId,
    description: `Извод бр. ${st.number || '—'} од ${dmy(st.date)} – ${acct!.name}`,
    numbering: { bankAccountId: acct!.id }, lines,
    meta: { bankAccountId: acct!.id, statementNo: st.number },
    auditAction: 'postStatement',
  });
  if (st.status !== 'posted') await tx.update(bankStatements).set({ status: 'posted' }).where(eq(bankStatements.id, st.id));
  return { status: 'posted', number: j.number, problems: [] };
}

/** Re-post several statements (after matching / import), each once. */
export async function postStatements(tx: Tx, ids: Iterable<string>, userId: string | null, env?: BankEnv): Promise<Map<string, PostStatementResult>> {
  const out = new Map<string, PostStatementResult>();
  for (const id of new Set(ids)) out.set(id, await postStatement(tx, id, userId, env));
  return out;
}

/** Guard for every change to a statement or its lines: the firm's period lock and posted-journal locks. */
export async function assertStatementOpen(tx: Tx, st: Pick<BankStatement, 'id' | 'firmId' | 'date'>): Promise<void> {
  const f = await loadFirm(tx, st.firmId);
  assertOpenPeriod(f, st.date);
  const [j] = await tx.select({ locked: journals.locked, number: journals.number }).from(journals)
    .where(and(eq(journals.firmId, st.firmId), eq(journals.sourceType, BANK_SOURCE_TYPE), eq(journals.sourceId, st.id))).limit(1);
  if (j?.locked) throw new PostingError('locked', `Налогот ${j.number} е заклучен.`);
}

/** FX difference of a line in denars for display (7810 / 4810). */
export function lineFxDifference(l: BankLine): { konto: string; amount: number } | null {
  const r = toBankRow(l);
  const d = fxDifference(r);
  return d ? { konto: d.konto, amount: den(d.amount) } : null;
}

