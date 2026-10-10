'use server';
/**
 * Loan contracts (legacy `lnSave` 16836, `lnLinkBank`, `lnCreateSel` / `lnAutoRun` 16860, `lnIgnore` 16869):
 * every write checks `write` (delete: `del`) and writes `audit_log` in the same transaction.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { LOAN_KONTO, nextLoanNo, type LoanDir } from '@wise/core/finance';
import { audit, bankLines, fileLinks, files, firms, loans, partners, setLineKonto } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { loanData } from './data';

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function saveLoanAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('lnSave');
    const id = s(f, 'id');
    const dir: LoanDir = s(f, 'dir') === 'received' ? 'received' : 'given';
    const partnerId = s(f, 'partnerId');
    if (!/^[0-9a-f-]{36}$/i.test(partnerId)) return { error: 'Изберете комитент.' };
    const [p] = await db().select({ id: partners.id }).from(partners).where(and(eq(partners.id, partnerId), eq(partners.firmId, firm.id))).limit(1);
    if (!p) return { error: 'Изберете комитент.' };
    const date = s(f, 'date');
    if (!isDate(date)) return { error: 'Внесете датум.' };
    const amount = Number(s(f, 'amount').replace(',', '.'));
    if (!(amount > 0)) return { error: 'Внесете износ.' };
    const termDate = s(f, 'termDate') || null;
    if (termDate && (!isDate(termDate) || termDate < date)) return { error: 'Рокот е пред датумот на договорот.' };
    const rate = Number(s(f, 'rate').replace(',', '.')) || 0;
    if (rate < 0 || rate > 100) return { error: 'Каматата мора да е 0–100%.' };
    const konto = s(f, 'konto') || LOAN_KONTO[dir];
    if (!/^\d{3,10}$/.test(konto)) return { error: 'Контото мора да има 3–10 цифри.' };
    const row = {
      dir, partnerId, partnerName: null, number: s(f, 'number') || null, date, amount: amount.toFixed(2), rate: String(rate), termDate,
      installments: Math.max(1, Math.round(Number(s(f, 'installments')) || 1)), purpose: s(f, 'purpose') || null, cash: f.get('cash') === '1', signed: f.get('signed') === '1',
      konto, moveIds: f.getAll('mv').map(String).filter((x) => /^[\w:.-]{1,80}$/.test(x)),
    };
    await db().transaction(async (tx) => {
      let lid = id;
      if (id) {
        const [x] = await tx.update(loans).set(row).where(and(eq(loans.id, id), eq(loans.firmId, firm.id))).returning({ id: loans.id });
        if (!x) throw new Error('Договорот не постои.');
      } else lid = (await tx.insert(loans).values({ ...row, firmId: firm.id, createdBy: u.id }).returning({ id: loans.id }))[0]!.id;
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnSave', entityType: 'loan', entityId: lid, data: { dir, number: row.number, amount: row.amount } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'Договорот не постои.') return { error: e.message };
    return actionError(e);
  }
  revalidatePath('/pozajmici');
  redirect('/pozajmici');
}

export async function deleteLoanAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('del');
    await db().transaction(async (tx) => {
      const [x] = await tx.delete(loans).where(and(eq(loans.id, id), eq(loans.firmId, firm.id))).returning({ id: loans.id, number: loans.number });
      if (x) await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnDel', entityType: 'loan', entityId: id, data: { number: x.number } });
    });
    revalidatePath('/pozajmici');
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}

/** Legacy `lnCreateSel` → `lnAutoRun`: one unsigned contract per selected disbursement without a contract. */
export async function createLoansAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('lnCreateSel');
    const sel = new Set(f.getAll('mv').map(String));
    if (!sel.size) return { error: 'Означете ги позајмиците за кои треба договор.' };
    const D = await loanData(firm, year);
    const todo = D.unlinked.filter((r) => sel.has(r.id));
    let n = 0, np = 0;
    await db().transaction(async (tx) => {
      const made: { number: string | null; date: string }[] = D.loans.map((l) => ({ number: l.number, date: l.date }));
      for (const r of todo) {
        const y = r.date.slice(0, 4);
        const number = nextLoanNo(made.map((m) => ({ no: m.number, date: m.date })), y);
        made.push({ number, date: r.date });
        await tx.insert(loans).values({
          firmId: firm.id, dir: r.dir, partnerId: r.partnerId || null, partnerName: r.partnerId ? null : r.desc.slice(0, 120) || null, number, date: r.date,
          amount: r.amt.toFixed(2), rate: '0', termDate: `${y}-12-31`, installments: 1, konto: r.konto, moveIds: [r.id], auto: true, signed: false, createdBy: u.id,
        });
        n++; if (!r.partnerId) np++;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnCreateSel', entityType: 'loan', data: { created: n } });
    });
    revalidatePath('/pozajmici');
    return { ok: `📝 Креирани: ${n} договори за позајмица (непотпишани)${np ? ' · ' + np + ' без комитент – дополнете' : ''}.` };
  } catch (e) { return actionError(e); }
}

/** Legacy `lnIgnore` 16869: „не е позајмица“ (or undo) — stored on the firm (`settings.lnIgnore`). */
export async function ignoreMoveAction(moveId: string, undo: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('lnIgnore');
    await db().transaction(async (tx) => {
      const [x] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
      const S = (x?.settings ?? {}) as Record<string, unknown>;
      const cur = new Set((S.lnIgnore as string[] | undefined) ?? []);
      if (undo) cur.delete(moveId); else cur.add(moveId);
      await tx.update(firms).set({ settings: { ...S, lnIgnore: [...cur] } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnIgnore', entityType: 'firm', entityId: firm.id, data: { moveId, undo } });
    });
    revalidatePath('/pozajmici');
    return { ok: undo ? 'Вратено во листата.' : 'Означено како враќање / не е позајмица.' };
  } catch (e) { return actionError(e); }
}

/** Legacy „🔧 Прекнижи на 1620/2620“ (`lnMisK` 16843–16856): statement lines that are loans, booked on other kontos. */
export async function rebookLoansAction(): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('lnSave');
    const D = await loanData(firm, year);
    let n = 0;
    await db().transaction(async (tx) => {
      for (const m of D.misK) {
        const lineId = m.id.replace(/^B:/, '').replace(/:x$/, '');
        const [l] = await tx.select({ id: bankLines.id, partnerId: bankLines.partnerId }).from(bankLines).where(and(eq(bankLines.id, lineId), eq(bankLines.firmId, firm.id))).limit(1);
        if (!l) continue;
        await setLineKonto(tx, { firmId: firm.id, userId: u.id, lineId, konto: LOAN_KONTO[m.dir], partnerId: l.partnerId, learn: false });
        n++;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnMisK', entityType: 'bank_line', data: { n } });
    });
    revalidatePath('/pozajmici');
    revalidatePath('/banka');
    return { ok: `Прекнижани ${n} ставки на 1620 / 2620.` };
  } catch (e) {
    if (e instanceof Error && e.name === 'BankError') return { error: e.message };
    return actionError(e);
  }
}

/** Legacy ACT `lnLinkBank` 16747: link a disbursement to the latest contract of the same partner and direction. */
export async function linkMoveAction(moveId: string): Promise<ActionState> {
  try {
    const { u, firm, year } = await firmAction('lnSave');
    const D = await loanData(firm, year);
    const m = D.flows.find((r) => r.id === moveId);
    if (!m) return { error: 'Ставката не постои.' };
    const C = D.loans.filter((l) => l.dir === m.dir && l.partnerId === m.partnerId).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!C) return { error: 'Нема договор за овој комитент – направете нов.' };
    await db().transaction(async (tx) => {
      await tx.update(loans).set({ moveIds: [...new Set([...C.moveIds, moveId])] }).where(eq(loans.id, C.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnLinkBank', entityType: 'loan', entityId: C.id, data: { moveId } });
    });
    revalidatePath('/pozajmici');
    const diff = Math.abs(Number(C.amount) - m.amt) > 0.5;
    return { ok: `Поврзано со договор ${C.number ?? ''}.${diff ? ' Износот на исплатата се разликува од договорот – проверете.' : ''}` };
  } catch (e) { return actionError(e); }
}

/** Legacy ACT `lnAtt` 16755: attach the signed contract (sets „потпишан“). */
export async function attachSignedAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('lnSave');
    const id = String(f.get('id') ?? '');
    const ids = f.getAll('fileIds').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) return { error: 'Прикачете го потпишаниот договор.' };
    await db().transaction(async (tx) => {
      const [l] = await tx.select({ id: loans.id }).from(loans).where(and(eq(loans.id, id), eq(loans.firmId, firm.id))).limit(1);
      if (!l) throw new Error('Договорот не постои.');
      const F = await tx.select({ id: files.id }).from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, ids)));
      for (const x of F) await tx.insert(fileLinks).values({ fileId: x.id, entityType: 'loan', entityId: id, role: 'signed' }).onConflictDoNothing();
      await tx.update(loans).set({ signed: true }).where(eq(loans.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'lnAtt', entityType: 'loan', entityId: id, data: { files: F.length } });
    });
    revalidatePath('/pozajmici');
    return { ok: 'Потпишаниот договор е прикачен.' };
  } catch (e) {
    if (e instanceof Error && e.message === 'Договорот не постои.') return { error: e.message };
    return actionError(e);
  }
}
