'use server';
/**
 * Firm chart-of-accounts overrides (legacy `saveAcc` 7387 / `delAcc` 7388).
 * FIX(#14): legacy wrote `firm.accounts` directly — no role check and no audit. Every change here goes
 * through `requireCan('write', firm)` and writes `audit_log` in the same transaction.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NEW_ACCOUNT_CODE_RE } from '@wise/core';
import { accounts, audit, journalLines } from '@wise/db';
import { missingVatAccounts } from '@/lib/parity-fin';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function saveAccount(_prev: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  const isEdit = form.get('edit') === '1';
  if (!isEdit && !NEW_ACCOUNT_CODE_RE.test(code)) return { error: 'Бројот на контото мора да има 3–8 цифри.' };
  if (!name) return { error: 'Внесете назив на контото.' };
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction(async (tx) => {
      await tx.insert(accounts).values({ firmId: firm.id, code, name })
        .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { name, hidden: false } });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveAcc', entityType: 'account', entityId: code, data: { name } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/konto');
  redirect(`/konto?q=${encodeURIComponent(code)}`);
}

/**
 * Remove an account from the firm's chart.
 * FIX(#13): legacy only checked usage in the current year's ledger; any posted line in any year blocks deletion.
 */
export async function deleteAccount(code: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const msg = await db().transaction(async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(journalLines)
        .where(and(eq(journalLines.firmId, firm.id), eq(journalLines.account, code)))) as [{ n: number }];
      if (n) return `Контото ${code} има ${n} книжења и не може да се избрише.`;
      const [global] = await tx.select({ id: accounts.id }).from(accounts).where(and(isNull(accounts.firmId), eq(accounts.code, code))).limit(1);
      if (global) {
        await tx.insert(accounts).values({ firmId: firm.id, code, name: code, hidden: true })
          .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { hidden: true } });
      } else {
        await tx.delete(accounts).where(and(eq(accounts.firmId, firm.id), eq(accounts.code, code)));
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'delAcc', entityType: 'account', entityId: code });
      return null;
    });
    if (msg) return { error: msg };
  } catch (e) { return actionError(e); }
  revalidatePath('/konto');
  return { ok: 'Контото е избришано.' };
}

export async function addVatAccounts(): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const M = await missingVatAccounts(firm);
    if (!M.length) return { ok: 'Сите ДДВ конта се во контниот план.' };
    await db().transaction(async (tx) => {
      for (const a of M) {
        await tx.insert(accounts).values({ firmId: firm.id, code: a.code, name: a.name })
          .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { name: a.name, hidden: false } });
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveAcc', entityType: 'account', entityId: M.map((a) => a.code).join(','), data: { vat: M } });
    });
    revalidatePath('/konto');
    return { ok: `Додадени ${M.length} ДДВ конта.` };
  } catch (e) { return actionError(e); }
}

/** Excel/CSV import of firm accounts (columns Конто, Назив): new analytic kontos or renamed ones. Needs `write`. */
export async function importAccounts(rows: (string | number | null)[][]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    const hi = rows.findIndex((r) => r.some((c) => /конто|konto|сметка/i.test(String(c ?? ''))));
    const head = hi >= 0 ? rows[hi]!.map((c) => String(c ?? '').toLowerCase()) : [];
    const cK = hi >= 0 ? head.findIndex((c) => /конто|konto|сметка/.test(c)) : 0;
    const cN = hi >= 0 ? head.findIndex((c) => /назив|опис|name/.test(c)) : 1;
    const L = rows.slice(hi + 1).map((r) => ({ code: String(r[cK] ?? '').replace(/\D/g, ''), name: String(r[cN < 0 ? 1 : cN] ?? '').trim() }))
      .filter((r) => r.code && r.name);
    const bad = L.find((r) => !NEW_ACCOUNT_CODE_RE.test(r.code));
    if (bad) return { error: `Контото „${bad.code}“ не е валидно (3–8 цифри).` };
    if (!L.length) return { error: 'Не се најдени редови со „Конто“ и „Назив“.' };
    await db().transaction(async (tx) => {
      for (const a of L) {
        await tx.insert(accounts).values({ firmId: firm.id, code: a.code, name: a.name.slice(0, 300) })
          .onConflictDoUpdate({ target: [accounts.firmId, accounts.code], targetWhere: sql`${accounts.firmId} is not null`, set: { name: a.name.slice(0, 300), hidden: false } });
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'importAcc', entityType: 'account', data: { n: L.length } });
    });
    revalidatePath('/konto');
    return { ok: `Увезени ${L.length} конта.` };
  } catch (e) { return actionError(e); }
}

/** Drop the firm override of a built-in account (back to the standard name / visible again). */
export async function resetAccount(code: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction(async (tx) => {
      await tx.delete(accounts).where(and(eq(accounts.firmId, firm.id), eq(accounts.code, code)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'resetAcc', entityType: 'account', entityId: code });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/konto');
  return { ok: 'Вратено.' };
}
