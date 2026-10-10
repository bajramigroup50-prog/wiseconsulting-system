/**
 * E-mail jobs (Phase 6 owns the shared mail infrastructure):
 * - `mail.send` `{firmId, to, subject, html, attachments?: fileIds}` or `{logId}` — sends one message, logged in `mail_log`.
 * - `mail.flush` (every 5 min) — sends rows still `queued` after 2 minutes (e.g. the web helper could not reach
 *   pg-boss), at most 3 attempts per row; a row whose PDF attachment is still being rendered (`pdf.mail`) waits up
 *   to 30 minutes (`mailWaitsForAttachments`).
 */
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { files, mailLog, mailWaitsForAttachments } from '@wise/db';
import { defineJob } from '../job';
import { mailerFromEnv, type Mailer } from '../mail/mailer';
import { readS3File, s3Configured } from '../mail/files';
import { sendLoggedMail, type MailDeps, type MailSendData } from '../mail/send';

let mailer: Mailer | null | undefined;
const deps = (): MailDeps => {
  if (mailer === undefined) mailer = mailerFromEnv();
  return { mailer, ...(s3Configured() ? { readFile: readS3File } : {}) };
};

export const mailSend = defineJob<MailSendData>({
  name: 'mail.send',
  async run(data, { db, log }) {
    const r = await sendLoggedMail(db, data, deps());
    log(`${r.id} → ${r.to.join(', ')}: ${r.status}${r.error ? ' (' + r.error + ')' : ''}`);
  },
});

export const mailFlush = defineJob({
  name: 'mail.flush',
  cron: '*/5 * * * *',
  async run(_data, { db, log }) {
    const R = await db.select({ id: mailLog.id, attachments: mailLog.attachments, createdAt: mailLog.createdAt }).from(mailLog)
      .where(and(eq(mailLog.status, 'queued'), lt(mailLog.createdAt, new Date(Date.now() - 120_000)), lt(mailLog.attempts, 3)))
      .orderBy(asc(mailLog.createdAt)).limit(100);
    const att = [...new Set(R.flatMap((r) => r.attachments))];
    const ready = new Set(att.length ? (await db.select({ id: files.id }).from(files).where(and(inArray(files.id, att), eq(files.status, 'ready')))).map((f) => f.id) : []);
    const now = new Date();
    const rows = R.filter((r) => !mailWaitsForAttachments(r, ready, now));
    for (const r of rows) await sendLoggedMail(db, { logId: r.id }, deps());
    if (rows.length) log(`flushed ${rows.length} queued message(s)`);
  },
});
