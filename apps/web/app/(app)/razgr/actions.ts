'use server';
/** 📆 Временски разграничувања: schedules (firms.settings.deferrals) and the monthly journals. */
import { revalidatePath } from 'next/cache';
import { YM_RE, type DeferralKind } from '@wise/core/deferrals';
import { deleteDeferral, postDeferralsDue, saveDeferral, stopDeferral, undoDeferralMonth } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';

const str = (v: FormDataEntryValue | null) => String(v ?? '').trim();
const num = (v: FormDataEntryValue | null) => Number(str(v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;

export async function saveDeferralAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('deferralSave');
    const id = str(form.get('id')) || null;
    const d = await db().transaction((tx) => saveDeferral(tx, {
      firmId: firm.id, userId: u.id, id,
      d: {
        name: str(form.get('name')), kind: (str(form.get('kind')) as DeferralKind) || 'cost', amount: num(form.get('amount')),
        from: str(form.get('from')), months: Math.floor(num(form.get('months'))), konto: str(form.get('konto')), defKonto: str(form.get('defKonto')),
        doc: str(form.get('doc')) || null,
      },
    }));
    revalidatePath('/razgr');
    return { ok: `Распоредот „${d.name}“ е зачуван (${d.months} месеци × ~${fmt(d.amount / d.months)} ден.).` };
  } catch (e) { return actionError(e); }
}

export async function postDeferralsAction(uptoYm: string, id?: string): Promise<ActionState> {
  try {
    if (!YM_RE.test(uptoYm)) return { error: 'Неважечки месец.' };
    const { u, firm } = await firmAction('deferralPost');
    const r = await db().transaction((tx) => postDeferralsDue(tx, { firmId: firm.id, userId: u.id, uptoYm, id: id ?? null }));
    revalidatePath('/razgr');
    if (!r.n && !r.skipped.length) return { error: 'Нема месеци за книжење.' };
    return { ok: `Книжени ${r.n} налози, вкупно ${fmt(r.total)} ден.${r.skipped.length ? ` · прескокнати (заклучен период): ${r.skipped.join(', ')}` : ''}` };
  } catch (e) { return actionError(e); }
}

export async function stopDeferralAction(id: string, stopped: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('deferralSave');
    await db().transaction((tx) => stopDeferral(tx, { firmId: firm.id, userId: u.id, id, stopped }));
    revalidatePath('/razgr');
    return { ok: stopped ? 'Распоредот е запрен.' : 'Распоредот продолжува.' };
  } catch (e) { return actionError(e); }
}

export async function deleteDeferralAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('nalDel');
    await db().transaction((tx) => deleteDeferral(tx, { firmId: firm.id, userId: u.id, id }));
    revalidatePath('/razgr');
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}

export async function undoDeferralMonthAction(id: string, ym: string): Promise<ActionState> {
  try {
    if (!YM_RE.test(ym)) return { error: 'Неважечки месец.' };
    const { u, firm } = await firmAction('nalDel');
    const n = await db().transaction((tx) => undoDeferralMonth(tx, { firmId: firm.id, userId: u.id, id, ym }));
    revalidatePath('/razgr');
    return n ? { ok: 'Месецот е поништен.' } : { error: 'Месецот не е книжен.' };
  } catch (e) { return actionError(e); }
}
