'use server';
/**
 * Legacy `sendMail` / `sendMailGo` 7041 (Gmail with the PDF attached): queue the worker's `invoice.mail` job, which
 * renders this document with the print template, stores the PDF and sends it through the office mailer (`mail_log`).
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { audit, INVOICE_MAIL_JOB, invoices, partners } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { splitAddresses, validAddresses } from '@/lib/mail';

/** Payload of the worker job: `InvoiceMailRequest` (`@wise/db`) + the edited subject / text. */
interface InvoiceMailJob { invoiceId: string; to?: string; userId?: string | null; subject?: string; body?: string }

/** Legacy `sendMailGo` (ACT_NEED: `write`). */
export async function sendInvoiceMail(invoiceId: string, _p: ActionState, f: FormData): Promise<ActionState> {
  let job: InvoiceMailJob;
  try {
    const [inv] = /^[0-9a-f-]{36}$/i.test(invoiceId)
      ? await db().select({ id: invoices.id, firmId: invoices.firmId, kind: invoices.kind, status: invoices.status, number: invoices.number, partnerId: invoices.partnerId })
        .from(invoices).where(eq(invoices.id, invoiceId)).limit(1)
      : [];
    if (!inv) return { error: 'Документот не постои.' };
    const u = await requireCan('sendMailGo', inv.firmId);
    if (!['invoice', 'credit', 'proforma'].includes(inv.kind) || inv.status !== 'posted') return { error: 'Овој документ не може да се испрати по е-пошта.' };
    const to = splitAddresses(String(f.get('to') ?? ''));
    if (!validAddresses(to)) return { error: 'Внесете валидна е-пошта.' };
    const subject = String(f.get('subject') ?? '').trim().slice(0, 300);
    const body = String(f.get('body') ?? '').slice(0, 20_000);
    job = { invoiceId: inv.id, to: to.join(', '), userId: u.id, ...(subject ? { subject } : {}), ...(body.trim() ? { body } : {}) };
    await db().transaction(async (tx) => {
      // legacy: a buyer without an e-mail keeps the address the document was sent to
      if (inv.partnerId) {
        await tx.update(partners).set({ email: to[0]! })
          .where(and(eq(partners.id, inv.partnerId), eq(partners.firmId, inv.firmId), or(isNull(partners.email), eq(partners.email, ''))));
      }
      await audit(tx, { userId: u.id, firmId: inv.firmId, action: 'sendMailGo', entityType: 'invoice', entityId: inv.id, data: { number: inv.number, to } });
    });
  } catch (e) { return actionError(e); }
  try {
    await enqueue(INVOICE_MAIL_JOB, job);
  } catch {
    return { error: 'Редот за испраќање е недостапен – обидете се повторно за неколку минути.' };
  }
  return { ok: `Се подготвува PDF и се испраќа на ${job.to}.` };
}
