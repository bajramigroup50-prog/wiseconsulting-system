'use server';
/** Legacy `kdRepMail` (14982): e-mail the business report to the client (report in the body, through the mail queue). */
import { revalidatePath } from 'next/cache';
import { isKdPer, kdRange } from '@wise/core/firms/dash';
import { audit, getOfficeProfile, textMailHtml } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { officeAction, officeError, today } from '@/lib/office';
import { kdData } from './data';
import { kdReportHtml } from './report';

export async function mailReport(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const to = String(f.get('to') ?? '').trim();
    if (!validAddresses(to)) return { error: 'Неточна е-пошта.' };
    const year = await currentYear();
    const p = String(f.get('p') ?? 'ytd');
    const [from, t2, pl] = kdRange(year, isKdPer(p) ? p : 'ytd', today(), String(f.get('f') ?? ''), String(f.get('t') ?? ''));
    const R = await kdData(firm, year, from, t2);
    const O = await getOfficeProfile(db());
    const html = kdReportHtml(R, firm, pl, from, t2, [O.name, u.name].filter(Boolean).join(' – '), today());
    const dm = (d: string) => d.split('-').reverse().join('.');
    const ids = await db().transaction(async (tx) => {
      const id = await queueMail(tx, {
        firmId: firm.id, to, subject: `Извештај за работењето – ${firm.name} – ${dm(from)} до ${dm(t2)}`,
        html: textMailHtml(`Почитувани,\n\nВо продолжение е извештајот за работењето на ${firm.name} за периодот ${dm(from)} – ${dm(t2)} (${pl}).`) + '<hr>' + html,
        entityType: 'kd_report', entityId: firm.id, userId: u.id,
      });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdRepMail', entityType: 'firm', entityId: firm.id, data: { to, from, to2: t2 } });
      return [id];
    });
    await dispatchMail(ids);
    revalidatePath('/mailhist');
    return { ok: `✓ Извештајот е испратен на ${to}.` };
  } catch (e) { return officeError(e); }
}
