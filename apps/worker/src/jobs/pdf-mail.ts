/**
 * `pdf.mail` `{ logId, fileId, html, css?, title, landscape?, firmId, userId? }` — legacy `pdfBlob(...)` + Gmail with
 * the PDF attached (`opMailGo` / `opMailAll` dunning letters, `kdRepMail` client report): render the HTML into the
 * pre-allocated `files.id` and send the `mail_log` row the web action queued (its `attachments` already name that
 * file, so the row, its audit entry and e.g. `dunning_letters.mail_id` are written in the user's transaction).
 * Same render path as `invoice.mail`. A retried job does not render twice (the file already exists).
 */
import { eq } from 'drizzle-orm';
import { files, PDF_MAIL_JOB, type DB, type PdfMailJob } from '@wise/db';
import { defineJob } from '../job';
import type { PdfInput } from '../pdf/document';
import { mailerFromEnv, type Mailer } from '../mail/mailer';
import { readS3File, s3Configured } from '../mail/files';
import { sendLoggedMail, type MailDeps } from '../mail/send';
import type { ObjectStore } from '../storage';
import { renderPdfToFile } from './pdf';

export interface PdfMailDeps { mail: MailDeps; render?: (p: PdfInput) => Promise<Uint8Array>; store?: ObjectStore }

export async function runPdfMail(db: DB, d: PdfMailJob, deps: PdfMailDeps) {
  if (!d?.logId || !d.fileId || !d.html) throw new Error('pdf.mail: logId, fileId and html are required');
  const [have] = await db.select({ id: files.id }).from(files).where(eq(files.id, d.fileId)).limit(1);
  if (!have) {
    await renderPdfToFile(db, { html: d.html, css: d.css, title: d.title, landscape: d.landscape, firmId: d.firmId, userId: d.userId ?? null, fileId: d.fileId },
      { render: deps.render, store: deps.store });
  }
  return sendLoggedMail(db, { logId: d.logId }, deps.mail);
}

let mailer: Mailer | null | undefined;

export const pdfMail = defineJob<PdfMailJob>({
  name: PDF_MAIL_JOB,
  async run(data, { db, log }) {
    if (mailer === undefined) mailer = mailerFromEnv();
    const r = await runPdfMail(db, data, { mail: { mailer, ...(s3Configured() ? { readFile: readS3File } : {}) } });
    log(`${r.id} (${data.title}) → ${r.to.join(', ')}: ${r.status}${r.error ? ' (' + r.error + ')' : ''}`);
  },
});
