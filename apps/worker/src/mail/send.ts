/**
 * Send one message and keep `mail_log` in step. Used by the `mail.send` job and the `mail.flush` sweep.
 * Never throws for delivery problems: the row ends as `failed` with the reason (no SMTP config, bad address,
 * missing attachment, SMTP error), so pg-boss does not retry blindly and the UI can offer "send again".
 */
import { and, eq, inArray } from 'drizzle-orm';
import { DEMO_OFF_MSG } from '@wise/core/demo';
import { files, firms, isDemoFirmId, isDemoUserId, mailLog, type DB, type MailLog } from '@wise/db';
import type { MailAttachment, Mailer } from './mailer';

/** Job payload of `mail.send`. Either `logId` (row created by the web helper) or the message itself. */
export interface MailSendData {
  logId?: string;
  firmId?: string | null;
  to?: string | string[];
  subject?: string;
  html?: string;
  /** `files.id` values. */
  attachments?: string[];
  entityType?: string | null;
  entityId?: string | null;
  userId?: string | null;
}

export interface MailDeps {
  mailer: Mailer | null;
  /** Reads an uploaded file (MinIO). Without it, messages with attachments fail. */
  readFile?: (bucketKey: string) => Promise<Buffer>;
}

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
export const splitAddresses = (to: string | string[] | undefined): string[] =>
  (Array.isArray(to) ? to : String(to ?? '').split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);

async function ensureRow(db: DB, d: MailSendData): Promise<MailLog> {
  if (d.logId) {
    const [r] = await db.select().from(mailLog).where(eq(mailLog.id, d.logId)).limit(1);
    if (!r) throw new Error(`mail_log ${d.logId} not found`);
    return r;
  }
  const [r] = await db.insert(mailLog).values({
    firmId: d.firmId ?? null, to: splitAddresses(d.to), subject: d.subject ?? '', html: d.html ?? '', attachments: d.attachments ?? [],
    entityType: d.entityType ?? null, entityId: d.entityId ?? null, createdBy: d.userId ?? null,
  }).returning();
  return r!;
}

async function finish(db: DB, id: string, patch: Partial<MailLog>): Promise<MailLog> {
  const [r] = await db.update(mailLog).set(patch).where(eq(mailLog.id, id)).returning();
  return r!;
}

/**
 * An invoice goes out in the name of the firm that issued it: the sender's name is the firm's name (the address stays
 * the program's – only that mailbox may send) and replies go to the firm's own e-mail (Податоци за фирмата).
 */
async function invoiceSender(db: DB, row: MailLog, from: string): Promise<{ from: string; replyTo?: string }> {
  if (row.entityType !== 'invoice' || !row.firmId) return { from };
  const [f] = await db.select({ name: firms.name, email: firms.email }).from(firms).where(eq(firms.id, row.firmId)).limit(1);
  if (!f) return { from };
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
  const name = String(f.name ?? '').replace(/["<>\\\r\n]/g, '').trim();
  const reply = splitAddresses(f.email ?? '').find((x) => EMAIL_RE.test(x));
  return { from: name ? `"${name}" <${addr}>` : from, ...(reply ? { replyTo: reply } : {}) };
}

export async function sendLoggedMail(db: DB, d: MailSendData, deps: MailDeps): Promise<MailLog> {
  const row = await ensureRow(db, d);
  if (row.status === 'sent') return row; // idempotent: a retried job does not send twice
  const attempts = row.attempts + 1;
  const fail = (error: string) => finish(db, row.id, { status: 'failed', error, attempts });
  // 🎭 never mail anything of a demo firm or a demo user (second line of defence; the web refuses to queue it)
  if (await isDemoFirmId(db, row.firmId) || await isDemoUserId(db, row.createdBy)) return fail(DEMO_OFF_MSG);
  if (!deps.mailer) return fail('Е-поштата не е подесена (SMTP_HOST / SMTP_URL) – пораката не е испратена.');
  if (!deps.mailer.from) return fail('Недостасува адреса на испраќачот (MAIL_FROM).');
  const to = row.to.filter(Boolean);
  if (!to.length || !to.every((x) => EMAIL_RE.test(x))) return fail('Неважечка е-пошта на примачот: ' + (to.join(', ') || '—'));
  const attachments: MailAttachment[] = [];
  if (row.attachments.length) {
    if (!deps.readFile) return fail('Прилозите не можат да се вчитаат (нема пристап до складот за документи).');
    const F = await db.select().from(files).where(and(inArray(files.id, row.attachments), eq(files.status, 'ready')));
    const own = F.filter((f) => !row.firmId || f.firmId === row.firmId || f.firmId == null);
    if (own.length !== row.attachments.length) return fail('Прилогот не постои или не припаѓа на фирмата.');
    try {
      for (const f of own) attachments.push({ filename: f.name, content: await deps.readFile(f.bucketKey), contentType: f.mime });
    } catch (e) {
      return fail('Прилогот не може да се вчита: ' + (e as Error).message);
    }
  }
  try {
    const who = await invoiceSender(db, row, deps.mailer.from);
    const r = await deps.mailer.transport.sendMail({ from: who.from, ...(who.replyTo ? { replyTo: who.replyTo } : {}), to, subject: row.subject, html: row.html, ...(attachments.length ? { attachments } : {}) });
    return finish(db, row.id, { status: 'sent', error: null, messageId: r.messageId ?? null, attempts, sentAt: new Date() });
  } catch (e) {
    return fail('SMTP: ' + ((e as Error).message || String(e)).slice(0, 500));
  }
}
