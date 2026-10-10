import 'server-only';
/**
 * E-mail with a server-rendered PDF attached (legacy `pdfBlob(html)` + Gmail attachment: `opMailGo`, `opMailAll`,
 * `kdRepMail`). Like `lib/mail.ts`:
 *
 *   const jobs = await db().transaction(async (tx) => { …; return [await queuePdfMail(tx, msg, { html, title })]; });
 *   await dispatchPdfMail(jobs);                 // after COMMIT
 *
 * `queuePdfMail` writes the `mail_log` row (with the pre-allocated PDF file id as its attachment) inside the caller's
 * transaction; the worker's `pdf.mail` renders the PDF into that id and sends the row (`mail.flush` waits for it).
 */
import { randomUUID } from 'node:crypto';
import { PDFDOC_CSS } from '@wise/core/print-css';
import { PDF_MAIL_JOB, type PdfMailJob, type Tx } from '@wise/db';
import { enqueue } from './jobs';
import { queueMail, type MailMessage } from './mail';

export async function queuePdfMail(tx: Tx, m: MailMessage, pdf: { html: string; title: string; css?: string; landscape?: boolean }): Promise<PdfMailJob> {
  const fileId = randomUUID();
  const logId = await queueMail(tx, { ...m, attachments: [...(m.attachments ?? []), fileId] });
  return { logId, fileId, html: pdf.html, css: pdf.css ?? PDFDOC_CSS, title: pdf.title, landscape: pdf.landscape ?? false, firmId: m.firmId, userId: m.userId };
}

/** Hand the jobs to the worker. Returns how many could not be queued (their rows fail after 30 minutes in `mail.flush`). */
export async function dispatchPdfMail(jobs: readonly PdfMailJob[]): Promise<number> {
  let failed = 0;
  for (const j of jobs) {
    try {
      await Promise.race([enqueue(PDF_MAIL_JOB, j), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000))]);
    } catch (e) {
      failed++;
      console.warn('[pdf.mail] queue unavailable:', (e as Error).message);
    }
  }
  return failed;
}

/** Legacy `fn()` for attachment names: letters, digits and dashes only. */
export const pdfFileTitle = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join('_').replace(/[^\p{L}\p{N}.-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 100) || 'dokument';
