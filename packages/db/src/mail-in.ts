/**
 * „✉ Е-пошта → WISE“: the office mailbox (info@…, IMAP) read by the worker (`mail.in`, apps/worker/src/jobs/mail-in.ts).
 * Every kept attachment becomes a row of „📥 Пристигнати документи“ (`incoming_docs`, source `mail`) of the firm it
 * belongs to (`@wise/core/office` `mailMatch`), or of the office (no firm) when it is not certain — the office picks
 * the firm there and the sender is remembered (`mailInLearn`, called by `assignIncomingFirm`).
 *
 * The connection is ONE office setting (`app_settings` `mailin.cfg`), the password sealed (`sealSecret`), never shown.
 * The mailbox is only read: no message is marked, moved or deleted (people keep using info@ in their mail program);
 * the worker remembers the last IMAP UID instead.
 */
import { and, eq, sql } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
import { mailAddr, MAILIN_DEFAULT_DAYS, type MailFirm, type MailMatchHow } from '@wise/core/office';
import { audit, type Tx } from './audit';
import { appSettings, files, firms, incomingDocs, userFirms, users } from './schema/index';
import { openSecret, sealSecret } from './social';

export const MAILIN_SOURCE = 'mail';
const CFG = 'mailin.cfg';
const SENDERS = 'mailin.senders';

export class MailInError extends Error { override name = 'MailInError'; }

export interface MailInConfig {
  on: boolean; host: string; port: number; user: string; folder: string; days: number;
  /** the office's own addresses that forward mail here (vbkonsalting@hotmail.com → info@): the client is read from the text */
  forwarders: string[];
  /** the IMAP cursor: UIDVALIDITY of the folder and the last UID read */
  uidValidity?: string | null; lastUid?: number;
  lastRun?: string | null; ok?: boolean | null; result?: string | null;
  hasPass: boolean;
}
type Stored = Omit<MailInConfig, 'hasPass'> & { pass?: string | null };

const DEF: Stored = { on: false, host: '', port: 993, user: '', folder: 'INBOX', days: MAILIN_DEFAULT_DAYS, forwarders: [] };

async function stored(tx: Pick<Tx, 'select'>): Promise<Stored> {
  const [r] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CFG)).limit(1);
  return { ...DEF, ...((r?.value as Partial<Stored> | undefined) ?? {}) };
}
async function put(tx: Pick<Tx, 'insert'>, key: string, value: unknown, userId: string | null): Promise<void> {
  await tx.insert(appSettings).values({ key, value, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId } });
}

/** The connection as the screen shows it (no password). */
export async function mailInConfig(tx: Pick<Tx, 'select'>): Promise<MailInConfig> {
  const { pass, ...c } = await stored(tx);
  return { ...c, hasPass: !!pass };
}

/** The connection with the password (worker only). */
export async function mailInSecret(tx: Pick<Tx, 'select'>): Promise<(MailInConfig & { pass: string | null })> {
  const s = await stored(tx);
  return { ...s, hasPass: !!s.pass, pass: openSecret(s.pass) };
}

export interface MailInInput { on: boolean; host: string; port?: number | null; user: string; pass?: string | null; folder?: string; days?: number | null; forwarders?: string | null }

/** Save the connection (owner). An empty password keeps the stored one; a changed mailbox / folder starts the cursor again. */
export async function saveMailIn(tx: Tx, a: MailInInput, userId: string | null): Promise<void> {
  const host = a.host.trim().toLowerCase(), user = a.user.trim(), folder = (a.folder || 'INBOX').trim() || 'INBOX';
  if (a.on && (!host || !user)) throw new MailInError('Внесете сервер и корисничко име (е-пошта).');
  if (host && !/^[a-z0-9.-]+$/.test(host)) throw new MailInError('Серверот не е исправен (на пр. arya.mk-host.mk).');
  const port = Number(a.port) || 993;
  if (port < 1 || port > 65535) throw new MailInError('Портата не е исправна.');
  const days = Math.min(365 * 3, Math.max(1, Number(a.days) || MAILIN_DEFAULT_DAYS));
  const old = await stored(tx);
  const moved = old.host !== host || old.user !== user || old.folder !== folder;
  const pass = a.pass ? sealSecret(a.pass) : old.pass ?? null;
  if (a.on && !pass) throw new MailInError('Внесете ја лозинката на сандачето.');
  const forwarders = [...new Set(String(a.forwarders ?? '').split(/[;,\s]+/).map((x) => mailAddr(x)).filter(Boolean))].slice(0, 20);
  const v: Stored = { ...old, on: a.on, host, port, user, folder, days, pass, forwarders, ...(moved ? { uidValidity: null, lastUid: 0 } : {}) };
  await put(tx, CFG, v, userId);
  await audit(tx, { userId, firmId: null, action: 'mailInSave', entityType: 'app_setting', data: { on: a.on, host, user, folder, days, pass: !!a.pass } });
}

/** After a run: the result line and (when given) the new cursor. */
export async function mailInResult(tx: Tx, ok: boolean, result: string, cursor?: { uidValidity: string; lastUid: number }): Promise<void> {
  const s = await stored(tx);
  await put(tx, CFG, { ...s, ok, result, lastRun: new Date().toISOString(), ...(cursor ?? {}) }, null);
}

/** Read every mail again from „days“ back (the office asked: e.g. after the first test). */
export async function mailInRestart(tx: Tx, userId: string | null): Promise<void> {
  const s = await stored(tx);
  await put(tx, CFG, { ...s, uidValidity: null, lastUid: 0 }, userId);
}

/* ------------------------------------------------------------------ who is who */

export async function mailInSenders(tx: Pick<Tx, 'select'>): Promise<Record<string, string>> {
  const [r] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SENDERS)).limit(1);
  return { ...((r?.value as Record<string, string> | undefined) ?? {}) };
}

/** Remember: mails from this address belong to this firm (the office gave one to it). */
export async function mailInLearn(tx: Tx, from: string, firmId: string, userId: string | null): Promise<void> {
  const a = mailAddr(from);
  if (!a) return;
  // the office's own addresses (the mailbox, the forwarders) never belong to one client
  const c = await stored(tx);
  if (a === mailAddr(c.user) || (c.forwarders ?? []).includes(a)) return;
  const S = await mailInSenders(tx);
  if (S[a] === firmId) return;
  S[a] = firmId;
  await put(tx, SENDERS, S, userId);
}

/** Forget a sender (the screen: „заборави“). */
export async function mailInForget(tx: Tx, from: string, userId: string | null): Promise<void> {
  const S = await mailInSenders(tx);
  delete S[mailAddr(from)];
  await put(tx, SENDERS, S, userId);
}

export interface MailInContext { firms: MailFirm[]; userFirms: Map<string, string[]>; learned: Record<string, string>; ownEdb: string | null; ownAddr: string; office: string[] }

/** Everything `mailMatch` needs: the real (not demo) active firms, client users' addresses, the learned senders. */
export async function mailInContext(tx: Pick<Tx, 'select'>): Promise<MailInContext> {
  const F = (await tx.select({ id: firms.id, name: firms.name, edb: firms.edb, email: firms.email, settings: firms.settings, active: firms.active }).from(firms))
    .filter((f) => f.active !== false && !isDemoFirm(f));
  const office = F.find((f) => (f.settings as { officeFirm?: boolean } | null)?.officeFirm);
  const U = await tx.select({ email: users.email, firmId: userFirms.firmId }).from(users).innerJoin(userFirms, eq(userFirms.userId, users.id))
    .where(and(eq(users.role, 'klient'), eq(users.active, true), sql`coalesce(${users.email}, '') <> ''`));
  const uf = new Map<string, string[]>();
  for (const u of U) { const a = mailAddr(u.email); if (a) uf.set(a, [...(uf.get(a) ?? []), u.firmId]); }
  const cfg = await stored(tx);
  const learned = await mailInSenders(tx);
  return {
    // the office firm is included (WISE = БАЈРАМИ ГРОУП): its own documents go to it (`mailMatch` keeps its ЕДБ last)
    firms: F.map((f) => ({ id: f.id, name: f.name, edb: f.edb, email: f.email, short: (f.settings as { short?: string } | null)?.short ?? null })),
    userFirms: uf, learned, ownEdb: office?.edb ?? null, ownAddr: mailAddr(cfg.user), office: [mailAddr(cfg.user), ...(cfg.forwarders ?? [])].filter(Boolean),
  };
}

/* ------------------------------------------------------------------ into the inbox */

export interface MailFileIn {
  fileId: string; name: string; sha: string; firmId: string | null; how?: MailMatchHow | null; candidates?: { id: string; name: string }[];
  mail: { from: string; fromName?: string | null; via?: string | null; subject: string; date: string | null; msgId: string | null; uid: number };
}

/** This file of this mail is already in the inbox (the same message read again after a restart). */
export async function mailFileSeen(tx: Pick<Tx, 'select'>, msgId: string | null, sha: string): Promise<boolean> {
  const [r] = await tx.select({ id: incomingDocs.id }).from(incomingDocs)
    .where(and(eq(incomingDocs.source, MAILIN_SOURCE), sql`${incomingDocs.detect}->>'sha' = ${sha}`, msgId ? sql`${incomingDocs.detect}->'mail'->>'msgId' = ${msgId}` : sql`true`)).limit(1);
  return !!r;
}

/** One kept attachment into „Пристигнати документи“ (unread; the caller enqueues `incoming.detect`). */
export async function ingestMailFile(tx: Tx, a: MailFileIn): Promise<string> {
  const subj = a.mail.subject.trim().slice(0, 200);
  const result = a.firmId ? null : a.candidates?.length ? 'Е-пошта: повеќе можни фирми – изберете фирма.' : 'Е-пошта: фирмата не е препознаена – изберете фирма (испраќачот ќе се запамети).';
  const [row] = await tx.insert(incomingDocs).values({
    firmId: a.firmId, fileId: a.fileId, source: MAILIN_SOURCE, what: subj || a.name, status: 'unread', result,
    detect: { sha: a.sha, mail: a.mail, ...(a.how ? { mailHow: a.how } : {}), ...(a.candidates?.length ? { proposed: a.candidates } : {}) },
  }).returning({ id: incomingDocs.id });
  if (a.firmId) await tx.update(files).set({ firmId: a.firmId }).where(and(eq(files.id, a.fileId), sql`${files.firmId} is null`));
  return row!.id;
}
