import 'server-only';
/**
 * Enqueue e-mail from server actions (Phase 6 owns the mail infrastructure; the worker job `mail.send` sends).
 *
 *   const ids = await db().transaction(async (tx) => { …; return [await queueMail(tx, msg)]; });
 *   await dispatchMail(ids);                    // after COMMIT
 *
 * `queueMail` writes the `mail_log` row inside the caller's transaction (together with its audit row), so a
 * rolled-back action sends nothing. `dispatchMail` hands the ids to pg-boss; if the queue cannot be reached the
 * rows stay `queued` and the worker's `mail.flush` sweep sends them a few minutes later.
 */
import { PgBoss } from 'pg-boss';
import { mailLog, type Tx } from '@wise/db';
import { db } from './db';

export interface MailMessage {
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

export const MAIL_JOB = 'mail.send';
const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

export const splitAddresses = (to: string | string[]): string[] =>
  (Array.isArray(to) ? to : to.split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean);
export const validAddresses = (to: string | string[]): boolean => {
  const L = splitAddresses(to);
  return L.length > 0 && L.every((x) => EMAIL_RE.test(x));
};

/** Insert the `mail_log` row (status `queued`) in the caller's transaction; returns its id. */
export async function queueMail(tx: Tx, m: MailMessage): Promise<string> {
  const [r] = await tx.insert(mailLog).values({
    firmId: m.firmId, to: splitAddresses(m.to), subject: m.subject, html: m.html, attachments: m.attachments ?? [],
    entityType: m.entityType ?? null, entityId: m.entityId ?? null, createdBy: m.userId,
  }).returning({ id: mailLog.id });
  return r!.id;
}

let boss: Promise<PgBoss> | undefined;
function getBoss(): Promise<PgBoss> {
  boss ??= (async () => {
    // Producer only: the worker owns the schema, maintenance and cron.
    const b = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2, supervise: false, schedule: false, migrate: false });
    b.on('error', (e) => console.error('[pg-boss]', e));
    await b.start();
    return b;
  })().catch((e) => { boss = undefined; throw e; });
  return boss;
}

/** Send queued rows to the `mail.send` queue. Never throws — undelivered ids are picked up by `mail.flush`. */
export async function dispatchMail(ids: readonly string[]): Promise<{ queued: number; deferred: number }> {
  if (!ids.length) return { queued: 0, deferred: 0 };
  try {
    const b = await getBoss();
    for (const logId of ids) await b.send(MAIL_JOB, { logId });
    return { queued: ids.length, deferred: 0 };
  } catch (e) {
    console.warn('[mail] queue unavailable, rows stay queued for mail.flush:', (e as Error).message);
    return { queued: 0, deferred: ids.length };
  }
}

/** Convenience for a single message outside a larger transaction. */
export async function enqueueMail(m: MailMessage): Promise<string> {
  const id = await queueMail(db(), m);
  await dispatchMail([id]);
  return id;
}
