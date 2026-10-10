/**
 * The one place a `mail_log` row is queued (Phase 6 mail infrastructure). Services in `@wise/db` call it inside
 * their transaction and return the id; the caller hands it to the queue after COMMIT (web `dispatchMail(ids)`,
 * worker `mail.send`), and rows that never reach the queue are sent by the worker's `mail.flush` sweep.
 * `apps/web/lib/mail.ts` `queueMail` delegates here.
 */
import { eq } from 'drizzle-orm';
import { mailSigCfg, mailSigKey, signMailHtml, type MailSig } from '@wise/core/mailsig';
import type { Tx } from './audit';
import { appSettings, mailLog, users } from './schema/index';

/** Append the user's saved e-mail signature (only users who saved one in „Потпис и напомена“). */
async function signForUser(tx: Tx, userId: string, html: string): Promise<string> {
  const [s] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, mailSigKey(userId))).limit(1);
  if (!s) return html;
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const stamp = new Date().toLocaleString('mk-MK', { timeZone: 'Europe/Skopje', dateStyle: 'short', timeStyle: 'short' });
  return signMailHtml(html, mailSigCfg(s.v as Partial<MailSig>, u?.name ?? ''), stamp);
}

export interface MailRow {
  firmId: string | null;
  to: string | string[];
  subject: string;
  html: string;
  /** `files.id` values of uploaded documents to attach. */
  attachments?: string[];
  entityType?: string;
  entityId?: string;
  userId: string | null;
}

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

export const splitMailAddresses = (to: string | string[] | null | undefined): string[] =>
  (Array.isArray(to) ? to : String(to ?? '').split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);

/** First valid address of a free-text field (`a@x.mk; b@y.mk` → `a@x.mk`), or null. */
export const firstMailAddress = (to: string | null | undefined): string | null => splitMailAddresses(to).find((x) => EMAIL_RE.test(x)) ?? null;

/** Insert the `mail_log` row (status `queued`) in the caller's transaction; returns its id. */
export async function queueMailRow(tx: Tx, m: MailRow): Promise<string> {
  // „✏ Потпис и напомена за е-пошта“ (legacy `msSign`): the sender's saved signature + notice, when set.
  const html = m.userId ? await signForUser(tx, m.userId, m.html) : m.html;
  const [r] = await tx.insert(mailLog).values({
    firmId: m.firmId, to: splitMailAddresses(m.to), subject: m.subject, html, attachments: m.attachments ?? [],
    entityType: m.entityType ?? null, entityId: m.entityId ?? null, createdBy: m.userId,
  }).returning({ id: mailLog.id });
  return r!.id;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text (portal message body) → minimal HTML e-mail body. */
export const textMailHtml = (text: string): string =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`;
