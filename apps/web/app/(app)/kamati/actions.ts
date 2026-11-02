'use server';
/**
 * Legacy `ACT.kamNote` 7240: book penalty interest on a late invoice (Д 1200 купувач / П 7800), journal kind `kamata`.
 * The amount is the Helix „каматна листа“ (`kamInvoice`): dated payments and the office rate table (`kamRates`).
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { interestLines, type KamRate } from '@wise/core/finance';
import { appSettings, audit, deleteJournal, invoices, journals, postJournal } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { kamInvoice, kamRates } from './kam';

export async function kamNoteAction(invoiceId: string, ratePct: number, asOf: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('kamNote');
    if (!isDate(asOf)) return { error: 'Неважечки датум.' };
    if (ratePct < 0 || ratePct > 100) return { error: 'Стапката мора да е 0–100 %.' };
    const rates = ratePct > 0 ? [] : await kamRates();
    if (!(ratePct > 0) && !rates.length) return { error: 'Внесете годишна стапка или пополнете ја табелата со стапки.' };
    const [inv] = await db().select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.firmId, firm.id))).limit(1);
    if (!inv || inv.kind !== 'invoice' || !inv.due) return { error: 'Фактурата не постои.' };
    const k = await db().transaction(async (tx) => {
      const x = (await kamInvoice(tx, firm.id, [{ id: inv.id, due: inv.due! }], asOf, ratePct, rates)).get(inv.id);
      const amt = x?.k ?? 0;
      if (!(amt > 0)) throw Object.assign(new Error('nothing'), { kam: true });
      const days = x!.segs.reduce((a, g) => a + g.days, 0);
      await postJournal(tx, {
        firmId: firm.id, date: asOf, kind: 'kamata', description: `Камата ф-ра ${inv.number}, ${days} дена, ${ratePct > 0 ? ratePct + '%' : 'по табела на стапки'}`,
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

/** Office rate table (app setting `kamRates`): rows „од датум / стапка %“, e.g. every 1 Jan and 1 Jul (ЗОО). */
export async function kamRatesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const u = await requireUser();
    if (['klient', 'teren', 'view'].includes(u.role)) return { error: 'Само канцеларијата ги менува стапките.' };
    const F = form.getAll('from').map(String), R = form.getAll('rate').map(String);
    const rows: KamRate[] = [];
    for (let i = 0; i < F.length; i++) {
      const f = F[i]!.trim(), r = +(R[i] ?? '').replace(',', '.');
      if (!f && !R[i]?.trim()) continue;
      if (!isDate(f)) return { error: `Ред ${i + 1}: внесете датум „од“.` };
      if (!(r > 0 && r < 100)) return { error: `Ред ${i + 1}: стапката мора да е меѓу 0 и 100 %.` };
      rows.push({ from: f, rate: r });
    }
    rows.sort((a, b) => a.from.localeCompare(b.from));
    await db().transaction(async (tx) => {
      await tx.insert(appSettings).values({ key: 'kamRates', value: rows, updatedBy: u.id }).onConflictDoUpdate({ target: appSettings.key, set: { value: rows, updatedBy: u.id } });
      await audit(tx, { userId: u.id, action: 'kamRates', entityType: 'app_settings', entityId: 'kamRates', data: { n: rows.length } });
    });
    revalidatePath('/kamati');
    return { ok: `Зачувани ${rows.length} стапки.` };
  } catch (e) { return actionError(e); }
}

