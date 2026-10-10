'use server';
/** Legacy `ACT.kamNote` 7240: book penalty interest on a late invoice (Д 1200 купувач / П 7800), journal kind `kamata`. */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { daysLate, interestLines, penaltyInterest } from '@wise/core/finance';
import { deleteJournal, documentPayments, invoices, journals, postJournal } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';

export async function kamNoteAction(invoiceId: string, ratePct: number, asOf: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('kamNote');
    if (!isDate(asOf)) return { error: 'Неважечки датум.' };
    if (!(ratePct > 0) || ratePct > 100) return { error: 'Внесете годишна стапка на казнена камата.' };
    const [inv] = await db().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.firmId, firm.id))).limit(1);
    if (!inv || inv.kind !== 'invoice') return { error: 'Фактурата не постои.' };
    const k = await db().transaction(async (tx) => {
      const pay = (await documentPayments(tx, firm.id, { invoiceIds: [inv.id] })).get(inv.id);
      const days = daysLate(inv.due, asOf);
      const amt = penaltyInterest(pay?.remaining ?? 0, ratePct, days);
      if (!(amt > 0)) throw Object.assign(new Error('nothing'), { kam: true });
      await postJournal(tx, {
        firmId: firm.id, date: asOf, kind: 'kamata', description: `Камата ф-ра ${inv.number}, ${days} дена, ${ratePct}%`,
        sourceType: 'kamata', sourceId: `${inv.id}:${asOf}`,
        lines: interestLines(amt, inv.partnerId).map((l) => ({ ...l, doc: inv.number })), userId: u.id, auditAction: 'kamNote',
      });
      return amt;
    });
    revalidatePath('/kamati');
    return { ok: `Каматата од ${k.toFixed(2)} ден. е фактурирана.` };
  } catch (e) {
    if ((e as { kam?: boolean })?.kam) return { error: 'Нема камата за фактурирање (фактурата е платена или не е задоцнета).' };
    return actionError(e);
  }
}

/** Delete a booked interest journal (legacy: the `kamata` journal is deleted from the nalog, needs `del`). */
export async function kamDelAction(journalId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('nalDel');
    const [j] = await db().select().from(journals).where(and(eq(journals.id, journalId), eq(journals.firmId, firm.id))).limit(1);
    if (!j || j.kind !== 'kamata') return { error: 'Налогот не постои.' };
    await db().transaction((tx) => deleteJournal(tx, { firmId: firm.id, journalId, userId: u.id }));
    revalidatePath('/kamati');
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}
