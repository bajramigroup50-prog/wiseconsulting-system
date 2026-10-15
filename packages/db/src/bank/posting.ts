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
import { BankError, den, loadBankEnv, loadFirm, type BankEnv } from './context';
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

/** Bank konto layout of the statement journal (`firms.settings.bankJournal`): `sum` (default) or `line` (legacy, per line). */
export type BankJournalLayout = 'sum' | 'line';
export const bankJournalLayout = (f: Pick<BankEnv['firm'], 'settings'>): BankJournalLayout =>
  ((f.settings ?? {}) as { bankJournal?: unknown }).bankJournal === 'line' ? 'line' : 'sum';

const C = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100);

/**
 * Journal lines of a statement (exported for tests / the nalog preview).
 *
 * Layout `sum` (the classic nalog, default): FIRST the bank konto once: „D = Σ приливи“ and „P = Σ одливи“ (one
 * line when there is only one side), noted „Извод бр. X од DD.MM.YYYY“; then every counter line in statement order
 * (konto, partner, document, note, its own side). FX accounts: per currency, Σ amount_cur and Σ of the lines' MKD amounts
 * (cents), so the journal balances exactly and the bank konto balance (MKD and currency) equals the per-line layout.
 * Layout `line` (legacy): every statement line paired with its own bank konto line.
 */
export function statementJournalLines(env: BankEnv, acct: { konto: string; cur: string }, lines: BankLine[], st?: { number?: string | null; date: string }, layout: BankJournalLayout = bankJournalLayout(env.firm)): PostLineInput[] {
  const fx = (acct.cur || 'MKD') !== 'MKD';
  const out: PostLineInput[] = [];
  // aggregated bank lines per currency ('' = denars only) and side, in cents
  const agg = new Map<string, { d: number; p: number; dCur: number; pCur: number; nd: number; np: number }>();
  for (const l of lines) {
    const r = toBankRow(l);
    const txn: BankTxn = {
      id: l.id, date: l.date, amount: den(r.amount), konto: r.konto, partner: r.partner,
      ref: r.ref ?? null, settle: r.settle != null ? den(r.settle) : null,
      split: r.split?.map((x) => ({ k: x.k, a: den(x.a), n: x.n })), conv: r.conv,
    };
    const J = bankEntries(txn, env.posting, { konto: acct.konto, cur: acct.cur });
    const note = (l.name || l.description || '').slice(0, 200);
    // the bank side of the line: the first bank-konto row of an inflow / the last of an outflow (a counter konto may equal it)
    const bi = r.amount >= 0 ? J.findIndex((j) => j.account === acct.konto) : J.map((j) => j.account).lastIndexOf(acct.konto);
    J.forEach((j, i) => {
      const onBank = i === bi;
      const withCur = fx && onBank && l.amountCur != null;
      if (onBank && layout === 'sum') {
        const key = withCur ? acct.cur : '';
        const a = agg.get(key) ?? { d: 0, p: 0, dCur: 0, pCur: 0, nd: 0, np: 0 };
        const cur = withCur ? C(Math.abs(Number(l.amountCur))) : 0;
        if (C(j.debit)) { a.d += C(j.debit); a.dCur += cur; a.nd++; }
        if (C(j.credit)) { a.p += C(j.credit); a.pCur += cur; a.np++; }
        agg.set(key, a);
        return;
      }
      out.push({
        account: j.account, debit: j.debit, credit: j.credit, partnerId: j.partnerId || null,
        note: j.note || note, doc: l.refLabel || l.bref || null,
        ...(withCur ? { currency: acct.cur, amountCur: Math.abs(Number(l.amountCur)) } : {}),
      });
    });
  }
  if (layout === 'sum') {
    const izv = st ? `Извод бр. ${st.number || '—'} од ${dmy(st.date)}` : 'Извод';
    const head: PostLineInput[] = [];
    for (const [cur, a] of agg) {
      const c = cur ? { currency: cur } : {};
      if (a.nd) head.push({ account: acct.konto, debit: a.d / 100, credit: 0, partnerId: null, note: izv, doc: st?.number || null, ...c, ...(cur ? { amountCur: a.dCur / 100 } : {}) });
      if (a.np) head.push({ account: acct.konto, debit: 0, credit: a.p / 100, partnerId: null, note: izv, doc: st?.number || null, ...c, ...(cur ? { amountCur: a.pCur / 100 } : {}) });
    }
    return [...head, ...out];
  }
  return out;
}

export interface PostStatementResult {
  status: 'draft' | 'posted'; number?: string;
  /** Lines in the journal (the others are listed in `problems`). */
  booked?: number;
  problems: { lineId: string; lineNo: number; problem: string }[];
}

/** Nalog number a statement is posted into (chosen when it was imported inside a nalog); null = automatic. */
export const statementNalog = (st: Pick<BankStatement, 'meta'>): string | null => {
  const n = (st.meta as { nalog?: unknown } | null)?.nalog;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
};

/**
 * (Re-)post one statement inside the caller's transaction. The journal is dated on the statement date and numbered
 * in the bank series of its period (6/4-6 …) or into the nalog the statement was imported into. Every booked line
 * is posted at once („Прокнижи…“ on one line shows in the nalog immediately); lines still without a counter konto
 * stay out and keep the statement a `draft`. No booked line → no journal. Period lock: `PostingError('locked')`.
 */
export async function postStatement(tx: Tx, statementId: string, userId: string | null, env?: BankEnv): Promise<PostStatementResult> {
  const [st] = await tx.select().from(bankStatements).where(eq(bankStatements.id, statementId)).limit(1);
  if (!st) throw new BankError('Изводот не постои.');
  const E = env ?? (await loadBankEnv(tx, st.firmId));
  const [acct] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, st.bankAccountId)).limit(1);
  const L = await tx.select().from(bankLines).where(eq(bankLines.statementId, st.id)).orderBy(asc(bankLines.lineNo));
  const fx = (acct!.cur || 'MKD') !== 'MKD';
  const problems = L.map((l) => ({ lineId: l.id, lineNo: l.lineNo, problem: lineProblem(l, fx) })).filter((p) => p.problem);
  const bad = new Set(problems.map((p) => p.lineId));
  const ok = L.filter((l) => !bad.has(l.id));
  const src = { firmId: st.firmId, sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId };
  const lines = statementJournalLines(E, { konto: acct!.konto, cur: acct!.cur }, ok, st);
  const status = problems.length ? 'draft' : 'posted';
  if (!lines.length) {
    await unpostSource(tx, src);
    if (st.status !== status) await tx.update(bankStatements).set({ status }).where(eq(bankStatements.id, st.id));
    return { status, booked: 0, problems };
  }
  const j = await postJournal(tx, {
    firmId: st.firmId, date: st.date, kind: 'bank', sourceType: BANK_SOURCE_TYPE, sourceId: st.id, userId,
    description: `Извод бр. ${st.number || '—'} од ${dmy(st.date)} – ${acct!.name}`,
    number: statementNalog(st),
    numbering: { bankAccountId: acct!.id }, lines,
    meta: { bankAccountId: acct!.id, statementNo: st.number, ...(problems.length ? { open: problems.length } : {}) },
    auditAction: 'postStatement',
  });
  if (st.status !== status) await tx.update(bankStatements).set({ status }).where(eq(bankStatements.id, st.id));
  return { status, number: j.number, booked: ok.length, problems };
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

export interface AccountRepost {
  statements: number;
  skipped: { statementId: string; number: string | null; date: string; why: string }[];
}

/**
 * Re-post the statements of one bank account (after its konto changed — „Прекнижи ги изводите на оваа сметка“):
 * only statements with a journal or booked lines in OPEN periods; a locked period / locked nalog is skipped and listed.
 */
export async function repostAccountStatements(tx: Tx, a: { firmId: string; userId: string | null; accountId: string }): Promise<AccountRepost> {
  const out: AccountRepost = { statements: 0, skipped: [] };
  const S = await tx.select().from(bankStatements).where(and(eq(bankStatements.firmId, a.firmId), eq(bankStatements.bankAccountId, a.accountId))).orderBy(asc(bankStatements.date));
  if (!S.length) return out;
  const env = await loadBankEnv(tx, a.firmId);
  for (const st of S) {
    try { await assertStatementOpen(tx, st); } catch (e) {
      if (!(e instanceof PostingError)) throw e;
      out.skipped.push({ statementId: st.id, number: st.number, date: st.date, why: e.message });
      continue;
    }
    await postStatement(tx, st.id, a.userId, env);
    out.statements++;
  }
  return out;
}

/** FX difference of a line in denars for display (7810 / 4810). */
export function lineFxDifference(l: BankLine): { konto: string; amount: number } | null {
  const r = toBankRow(l);
  const d = fxDifference(r);
  return d ? { konto: d.konto, amount: den(d.amount) } : null;
}

