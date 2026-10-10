'use server';
/**
 * Legacy `kdRepMail` (14982): e-mail the business report to the client — as legacy, the report is a PDF attachment
 * (`Izvestaj_<од>_<до>.pdf`, worker `pdf.mail`, same markup as `/klDash/pecati`) with a short text in the body.
 */
import { revalidatePath } from 'next/cache';
import { isKdPer, kdRange } from '@wise/core/firms/dash';
import { audit, getOfficeProfile, textMailHtml } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { splitAddresses, validAddresses } from '@/lib/mail';
import { officeAction, officeError, today } from '@/lib/office';
import { dispatchPdfMail, pdfFileTitle, queuePdfMail } from '@/lib/pdf-mail';
import { kdData } from './data';
import { kdReportHtml } from './report';

export async function mailReport(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const to = splitAddresses(String(f.get('to') ?? ''));
    if (!validAddresses(to)) return { error: 'Неточна е-пошта.' };
    const year = await currentYear();
    const p = String(f.get('p') ?? 'ytd');
    const [from, t2, pl] = kdRange(year, isKdPer(p) ? p : 'ytd', today(), String(f.get('f') ?? ''), String(f.get('t') ?? ''));
    const R = await kdData(firm, year, from, t2);
    const O = await getOfficeProfile(db());
    const html = kdReportHtml(R, firm, pl, from, t2, [O.name, u.name].filter(Boolean).join(' – '), today());
    const dm = (d: string) => d.split('-').reverse().join('.');
    const jobs = await db().transaction(async (tx) => {
      const job = await queuePdfMail(tx, {
        firmId: firm.id, to, subject: `Извештај за работењето – ${firm.name} – ${dm(from)} до ${dm(t2)}`,
        html: textMailHtml(`Почитувани,\n\nВо прилог е извештајот за работењето на ${firm.name} за периодот ${dm(from)} – ${dm(t2)} (${pl}).\n\nСо почит,\n${u.name}`),
        entityType: 'kd_report', entityId: firm.id, userId: u.id,
      }, { html: `<div class="pdfdoc">${html}</div>`, title: pdfFileTitle('Izvestaj', from, t2) });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kdRepMail', entityType: 'firm', entityId: firm.id, data: { to, from, to2: t2, mailId: job.logId } });
      return [job];
    });
    const failed = await dispatchPdfMail(jobs);
    revalidatePath('/mailhist');
    return failed ? { error: 'Редот за PDF е недостапен – пораката чека; проверете во „Историја на праќања“.' } : { ok: `✓ Извештајот (PDF) се испраќа на ${to.join(', ')}.` };
  } catch (e) { return officeError(e); }
}
