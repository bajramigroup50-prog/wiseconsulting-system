/**
 * Finance parity — statement screen services that legacy had and the first port did not:
 * - `bkpFix` 12433: link statement lines on 120–128 / 220–228 to the partner named in the statement (create missing)
 * - `posFee` 13078: book the POS terminal fee (D 4460 / P POS konto with the POS partner)
 * - `bookSaldoCur` 12652 inputs: FX balance by statement chain
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { bkCore } from '@wise/core';
import { bookSaldoCur, partnerFixPlan, posBoxState, posFeeLines, posFeeValid, posSaldo, statementNumberSuggestions, type PartnerFixPlan, type PosSaldo } from '@wise/core/bank/parity';
import { audit, type Tx } from '../audit';
import { postJournal } from '../posting';
import { bankLines, bankStatements, journalLines, journals, partners } from '../schema/index';
import { BankError, cents, loadBankEnv } from './context';
import { postStatements } from './posting';
import { toBankRow } from './rows';

/** Lines of the year without a partner (or with a wrongly opened one) that can be linked (legacy `bkpNoP`). */
export async function bankPartnerFixPlan(tx: Tx, firmId: string, year: number): Promise<PartnerFixPlan[]> {
  const L = await tx.select().from(bankLines).where(and(eq(bankLines.firmId, firmId), sql`${bankLines.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const P = await tx.select({ id: partners.id, name: partners.name, edb: partners.edb, embs: partners.embs, code: partners.code }).from(partners).where(eq(partners.firmId, firmId));
  return partnerFixPlan(L.map(toBankRow), {
    year, partners: P.map((p) => ({ id: p.id, name: p.name, edb: p.edb ?? undefined, embs: p.embs ?? undefined, code: p.code ?? undefined })),
    refPartner: () => '', partnerKey: bkCore,
  });
}

/** Legacy `ACT.bkpFix` 12433: link the lines, creating the partners that do not exist yet; re-post the statements. */
export async function applyBankPartnerFix(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<{ linked: number; created: number }> {
  const plan = await bankPartnerFixPlan(tx, a.firmId, a.year);
  if (!plan.length) return { linked: 0, created: 0 };
  const made = new Map<string, string>();
  let created = 0;
  const touched = new Set<string>();
  for (const x of plan) {
    let pid = x.partner;
    if (!pid) {
      const key = bkCore(x.name);
      pid = made.get(key) ?? '';
      if (!pid) {
        const [p] = await tx.insert(partners).values({ firmId: a.firmId, name: x.name }).returning({ id: partners.id });
        pid = p!.id;
        made.set(key, pid);
        created++;
        await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bkpMkP', entityType: 'partner', entityId: pid, data: { name: x.name } });
      }
    }
    const [r] = await tx.update(bankLines).set({ partnerId: pid, newPartner: null }).where(and(eq(bankLines.id, x.id), eq(bankLines.firmId, a.firmId))).returning({ st: bankLines.statementId });
    if (r) touched.add(r.st);
  }
  await postStatements(tx, touched, a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'bkpFix', entityType: 'bank_line', data: { linked: plan.length, created } });
  return { linked: plan.length, created };
}

/** Legacy `posSaldo` 13075 over the ledger: card sales on the POS konto vs money received from the bank. */
export async function posBalance(tx: Tx, firmId: string, year: number): Promise<PosSaldo & { state: ReturnType<typeof posBoxState>; posPartner: string | null }> {
  const env = await loadBankEnv(tx, firmId);
  const posK = env.konta.pos;
  const L = await tx.select({ date: journals.date, d: journalLines.debit, p: journalLines.credit }).from(journalLines).innerJoin(journals, eq(journals.id, journalLines.journalId))
    .where(and(eq(journalLines.firmId, firmId), eq(journalLines.account, posK), sql`${journals.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const x = posSaldo(L.map((l) => ({ k: posK, date: l.date, d: cents(l.d), p: cents(l.p) })), posK);
  return { ...x, state: posBoxState(x), posPartner: env.posPartner ?? null };
}

/** Legacy ACT `posFee` 13078: „Книжи провизија 4460“ — amount (cents) ≤ open POS balance. */
export async function bookBankPosFee(tx: Tx, a: { firmId: string; userId: string | null; year: number; amount: number; date: string }): Promise<string> {
  const x = await posBalance(tx, a.firmId, a.year);
  if (!posFeeValid(a.amount, x)) throw new BankError(`Износот мора да е поголем од 0 и најмногу ${(x.s / 100).toFixed(2)} (отворено на ${x.k}).`);
  const env = await loadBankEnv(tx, a.firmId);
  const L = posFeeLines(a.amount, x.k, x.posPartner, env.konta.fee);
  const j = await postJournal(tx, {
    firmId: a.firmId, date: a.date, kind: 'pos', description: 'Провизија за плаќања со картички (POS)', userId: a.userId,
    lines: L.map((l) => ({ account: l.k, debit: (l.d / 100).toFixed(2), credit: (l.p / 100).toFixed(2), partnerId: l.partner ?? null })),
    auditAction: 'posFee',
  });
  return j.number;
}

/** Legacy `bookSaldoCur` 12652: balance of an FX account in its currency at `date` by the statement chain (cents). */
export async function fxStatementBalance(tx: Tx, bankAccountId: string, date: string): Promise<number | null> {
  const S = await tx.select({ id: bankStatements.id, date: bankStatements.date, opening: bankStatements.opening }).from(bankStatements)
    .where(and(eq(bankStatements.bankAccountId, bankAccountId), sql`${bankStatements.date} <= ${date}`)).orderBy(asc(bankStatements.date));
  const withBal = S.filter((s) => s.opening != null);
  if (!withBal.length) return null;
  const L = await tx.select({ date: bankLines.date, amount: bankLines.amount, amountCur: bankLines.amountCur }).from(bankLines)
    .where(and(eq(bankLines.bankAccountId, bankAccountId), inArray(bankLines.statementId, S.map((s) => s.id))));
  return bookSaldoCur(withBal.map((s) => ({ date: s.date, opening: cents(s.opening) })), L.map((l) => ({ date: l.date, amount: cents(l.amount), amountCur: l.amountCur == null ? null : cents(l.amountCur) })), date);
}

/** Legacy `izvSugg` 12392: suggested numbers of the year's statements without a number, keyed by statement id. */
export async function statementNoSuggestions(tx: Tx, firmId: string, year: number): Promise<Map<string, string>> {
  const S = await tx.select({ id: bankStatements.id, acct: bankStatements.bankAccountId, date: bankStatements.date, no: bankStatements.number }).from(bankStatements)
    .where(and(eq(bankStatements.firmId, firmId), sql`${bankStatements.date} between ${year + '-01-01'} and ${year + '-12-31'}`));
  const M = statementNumberSuggestions(S.map((s) => ({ acct: s.acct, date: s.date, no: s.no })));
  const out = new Map<string, string>();
  for (const s of S) if (!s.no && M[s.acct + '|' + s.date]) out.set(s.id, M[s.acct + '|' + s.date]!);
  return out;
}

/** Legacy ACT `izvFill` 12400: fill the empty statement numbers with the suggestions (previous number + 1 …). */
export async function fillStatementNumbers(tx: Tx, a: { firmId: string; userId: string | null; year: number }): Promise<number> {
  const M = await statementNoSuggestions(tx, a.firmId, a.year);
  for (const [id, no] of M) await tx.update(bankStatements).set({ number: no }).where(eq(bankStatements.id, id));
  if (M.size) await postStatements(tx, M.keys(), a.userId);
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'izvFill', entityType: 'bank_statement', data: { n: M.size } });
  return M.size;
}
