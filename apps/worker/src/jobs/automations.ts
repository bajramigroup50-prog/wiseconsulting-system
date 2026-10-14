/**
 * Office automations:
 * - `nbrm.rates` (daily 08:30, 13:30, 17:30 and on demand `{from, to}`): the official NBRM middle rates of every
 *   currency into the office rate list (`fx_rates`, `source = 'nbrm'`) — manual rates are never overwritten.
 * - `rokovi` (daily 07:10): refresh „📅 Календар на рокови“ for all firms (automatic „направено“), then the reminders —
 *   e-mail to the responsible colleagues (only when SMTP is configured) and the client reminders (portal + e-mail),
 *   delivered through `dispatchReminders` / `mail.send`.
 * - `fee.invoices` (daily 06:40): on the billing day, when „автоматски“ is on, the monthly invoices for the accounting
 *   services; every day the polite overdue reminders.
 * - `fee.deliver` `{feeId}`: the invoice PDF into the client's portal message and, with SMTP and an address, by e-mail.
 */
import { todaySkopje } from '@wise/core/office';
import { feeAutoPeriod } from '@wise/core/firms/kdfee';
import {
  dispatchReminders, dispatchRokReminders, FEE_DELIVER_JOB, feeContext, feeInvoices, feePortalItem, issueFeeInvoices, OFFICE_FILE_ENTITY, rokWindow,
  runFeeReminders, runNbrm, syncRokovi, textMailHtml, type DB,
} from '@wise/db';
import { eq } from 'drizzle-orm';
import { defineJob } from '../job';
import { mailerFromEnv, type Mailer } from '../mail/mailer';
import { readS3File, s3Configured } from '../mail/files';
import { sendLoggedMail, type MailDeps } from '../mail/send';
import { sendQueuedMail } from './reminders';
import { renderInvoicePdf, type InvoiceMailDeps } from './invoice-mail';

let mailer: Mailer | null | undefined;
const mailDeps = (): MailDeps => {
  if (mailer === undefined) mailer = mailerFromEnv();
  return { mailer, ...(s3Configured() ? { readFile: readS3File } : {}) };
};
/** SMTP configured (e-mails are only written when they can be sent). */
const canMail = () => !!mailDeps().mailer;

/* ---------------- NBRM ---------------- */

export const nbrmRates = defineJob<{ from?: string; to?: string; userId?: string | null }>({
  name: 'nbrm.rates',
  cron: '30 8,13,17 * * *',
  queue: { retryLimit: 3, expireInSeconds: 600 },
  async run(data, { db, log }) {
    const r = await runNbrm(db, data ?? {});
    log(`${r.from}…${r.to}: ${r.saved} rates on ${r.dates} days (manual kept ${r.skippedManual})`);
  },
});

/* ---------------- 📅 deadlines ---------------- */

export const rokoviJob = defineJob<{ today?: string }>({
  name: 'rokovi',
  cron: '10 7 * * *',
  async run(data, ctx) {
    const today = data?.today ?? todaySkopje();
    const s = await syncRokovi(ctx.db, rokWindow(today));
    const r = await dispatchRokReminders(ctx.db, { today, mail: canMail() });
    const d = await dispatchReminders(ctx.db);
    const m = await sendQueuedMail(ctx, d.mailIds);
    ctx.log(`firms ${s.firms}, deadlines ${s.rows} (auto done ${s.autoDone}, undone ${s.autoUndone}, gone ${s.gone}); reminders colleague ${r.colleague}, client ${r.client}; delivered ${d.sent}, e-mails ${d.mailIds.length} (queued ${m})`);
  },
});

/* ---------------- 🧾 fee invoices ---------------- */

export const feeInvoicesJob = defineJob<{ today?: string }>({
  name: 'fee.invoices',
  cron: '40 6 * * *',
  async run(data, ctx) {
    const today = data?.today ?? todaySkopje();
    const c = await feeContext(ctx.db);
    if (!c) { ctx.log('no office firm'); return; }
    const ym = feeAutoPeriod(today, c.S);
    if (ym) {
      const r = await issueFeeInvoices(ctx.db, { ym, date: today, userId: null, role: 'admin', source: 'auto' });
      if (ctx.send) for (const x of r.issued) await ctx.send(FEE_DELIVER_JOB, { feeId: x.feeId });
      for (const e of r.errors) ctx.log(`${e.name}: ${e.error}`);
      ctx.log(`${ym}: issued ${r.issued.length}, skipped ${r.skipped}, errors ${r.errors.length}`);
    }
    const rem = await runFeeReminders(ctx.db, { today, mail: canMail() });
    await sendQueuedMail(ctx, rem.mailIds);
    ctx.log(`overdue reminders ${rem.sent}`);
  },
});

/** Separated for tests: portal message + PDF, then the e-mail when possible. */
export async function runFeeDeliver(db: DB, feeId: string, deps: InvoiceMailDeps) {
  const p = await db.transaction((tx) => feePortalItem(tx, feeId));
  if (!p) return null;
  const r = await renderInvoicePdf(db, p.invoiceId, deps, {
    firmId: p.clientFirmId, ...(p.itemId ? { link: { entityType: OFFICE_FILE_ENTITY.inbox, entityId: p.itemId, replace: true } } : {}),
  });
  if (!r) return null;
  let mail = null;
  if (p.to && deps.mail.mailer) {
    mail = await sendLoggedMail(db, { firmId: p.clientFirmId, to: p.to, subject: p.subject, html: textMailHtml(p.body), attachments: [r.fileId], entityType: 'fee_invoice', entityId: feeId }, deps.mail);
    if (mail.status === 'sent') await db.update(feeInvoices).set({ mailedAt: new Date() }).where(eq(feeInvoices.id, feeId));
  }
  return { fileId: r.fileId, portal: p.itemId, mail };
}

export const feeDeliver = defineJob<{ feeId: string }>({
  name: FEE_DELIVER_JOB,
  queue: { retryLimit: 2 },
  async run(data, { db, log }) {
    const r = data?.feeId ? await runFeeDeliver(db, data.feeId, { mail: mailDeps() }) : null;
    log(r ? `${data.feeId}: PDF ${r.fileId}${r.portal ? ' → портал' : ''}${r.mail ? ` → ${r.mail.to.join(', ')} ${r.mail.status}` : ''}` : `${data?.feeId}: not found`);
  },
});
