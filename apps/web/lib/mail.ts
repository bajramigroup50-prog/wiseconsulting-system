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
import { queueMailRow, type Tx } from '@wise/db';
import { db } from './db';
import { enqueue } from './jobs';

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

/** Insert the `mail_log` row (status `queued`) in the caller's transaction; returns its id (`@wise/db` `queueMailRow`). */
export const queueMail = (tx: Tx, m: MailMessage): Promise<string> => queueMailRow(tx, m);

/** Send queued rows to the `mail.send` queue. Never throws — undelivered ids are picked up by `mail.flush`. */
export async function dispatchMail(ids: readonly string[]): Promise<{ queued: number; deferred: number }> {
  if (!ids.length) return { queued: 0, deferred: 0 };
  try {
    // Never let an unreachable queue hold up the user's action: give up after 5 s (rows stay `queued`).
    await Promise.race([
      (async () => { for (const logId of ids) await enqueue(MAIL_JOB, { logId }); })(),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000)),
    ]);
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
