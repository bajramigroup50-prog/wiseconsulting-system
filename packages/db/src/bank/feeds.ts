/**
 * „🏦 Изводи од банка (автоматски)“ — the office's bank connections (`bank_feeds`) and the statements they bring.
 *
 * A fetched file becomes an inbox row (`incoming_docs`, source `bankfeed`, kind `bank`) with the parsed statements in
 * `detect.full`, matched to the firm by the statement account / IBAN across all real firms. With `hold` (default) it
 * waits („чека одобрување“) until the office approves it — then THE existing import books it (`incomingBankImport`:
 * reconciliation block, duplicates, the bank nalog). Without `hold` a certain match is booked right away.
 *
 * The office SSH key for SFTP (host-to-host) is generated here (ed25519, OpenSSH format) and kept sealed in
 * `app_settings` (`bankfeed.key`); only the public key is ever shown, to send to the bank.
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { statementProblems, type Statement } from '@wise/core/bank-parsers';
import { isDemoFirm } from '@wise/core/demo';
import { bankMatch, statementBriefs, type FirmAccounts } from '@wise/core/office';
import { audit, type Tx } from '../audit';
import { appSettings, bankAccounts, bankFeeds, files, firms, incomingDocs, type BankFeed, type BankFeedMethod, type IncomingDoc } from '../schema/index';
import { incomingBankImport, type BankImportOutcome } from '../incoming';
import { openSecret, sealSecret } from '../social';

export const BANKFEED_SOURCE = 'bankfeed';
export const BANKFEED_JOB = 'bank.feeds';
const KEY = 'bankfeed.key';

export class FeedError extends Error { override name = 'FeedError'; }

/* ------------------------------------------------------------------ the office SSH key */

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const sshStr = (b: Buffer | string) => { const x = typeof b === 'string' ? Buffer.from(b) : b; return Buffer.concat([u32(x.length), x]); };

/** A new ed25519 key: `pub` = „ssh-ed25519 AAAA… WISE“, `priv` = the OpenSSH private key (unencrypted PEM). */
export function newSshKey(comment = 'WISE-bank'): { pub: string; priv: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const rawPriv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const blob = Buffer.concat([sshStr('ssh-ed25519'), sshStr(rawPub)]);
  const check = randomBytes(4);
  let sec = Buffer.concat([check, check, sshStr('ssh-ed25519'), sshStr(rawPub), sshStr(Buffer.concat([rawPriv, rawPub])), sshStr(comment)]);
  const pad: number[] = [];
  for (let i = 1; (sec.length + pad.length) % 8; i++) pad.push(i);
  sec = Buffer.concat([sec, Buffer.from(pad)]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), sshStr('none'), sshStr('none'), sshStr(''), u32(1), sshStr(blob), sshStr(sec)]);
  const b64 = body.toString('base64').replace(/.{1,70}/g, '$&\n');
  return { pub: `ssh-ed25519 ${blob.toString('base64')} ${comment}`, priv: `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}-----END OPENSSH PRIVATE KEY-----\n` };
}

/** The office public key ('' when none was made yet). */
export async function feedPublicKey(tx: Pick<Tx, 'select'>): Promise<string> {
  const [r] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  return String((r?.value as { pub?: string } | undefined)?.pub ?? '');
}

/** The office private key (worker only). */
export async function feedPrivateKey(tx: Pick<Tx, 'select'>): Promise<string | null> {
  const [r] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
  return openSecret((r?.value as { priv?: string } | undefined)?.priv);
}

/** Make the key once (an existing key is kept unless `renew`). Returns the public key. */
export async function ensureFeedKey(tx: Tx, userId: string | null, renew = false): Promise<string> {
  const old = await feedPublicKey(tx);
  if (old && !renew) return old;
  const k = newSshKey();
  const value = { pub: k.pub, priv: sealSecret(k.priv), at: new Date().toISOString() };
  await tx.insert(appSettings).values({ key: KEY, value, updatedBy: userId }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date(), updatedBy: userId } });
  await audit(tx, { userId, firmId: null, action: renew ? 'feedKeyRenew' : 'feedKey', entityType: 'bank_feed', data: {} });
  return k.pub;
}

/* ------------------------------------------------------------------ connections */

export interface FeedInput {
  id?: string | null; name: string; bank?: string; method: BankFeedMethod; host?: string; port?: number | null; username?: string;
  path?: string; pattern?: string; password?: string | null; clearPassword?: boolean; hold?: boolean; at?: string; active?: boolean;
}

const METHODS: readonly BankFeedMethod[] = ['sftp', 'imap', 'folder'];

export async function listFeeds(tx: Pick<Tx, 'select'>): Promise<BankFeed[]> {
  return tx.select().from(bankFeeds).orderBy(bankFeeds.name);
}

export async function saveFeed(tx: Tx, f: FeedInput, userId: string | null): Promise<string> {
  const name = f.name.trim();
  if (!name) throw new FeedError('Внесете назив на врската.');
  if (!METHODS.includes(f.method)) throw new FeedError('Непознат начин на поврзување.');
  if (f.method !== 'folder' && !String(f.host ?? '').trim()) throw new FeedError('Внесете адреса на серверот (host).');
  const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(f.at ?? '')) ? String(f.at) : '20:00';
  const port = f.port && f.port > 0 && f.port < 65536 ? Math.trunc(f.port) : null;
  const v = {
    name, bank: String(f.bank ?? '').trim(), method: f.method, host: String(f.host ?? '').trim(), port, username: String(f.username ?? '').trim(),
    path: String(f.path ?? '').trim(), pattern: String(f.pattern ?? '').trim(), hold: f.hold !== false, at, active: f.active !== false,
    ...(f.password ? { secret: sealSecret(f.password) } : f.clearPassword ? { secret: null } : {}),
  };
  let id = f.id ?? null;
  if (id) await tx.update(bankFeeds).set(v).where(eq(bankFeeds.id, id));
  else id = (await tx.insert(bankFeeds).values({ ...v, createdBy: userId }).returning({ id: bankFeeds.id }))[0]!.id;
  await audit(tx, { userId, firmId: null, action: 'feedSave', entityType: 'bank_feed', entityId: id, data: { name, method: f.method, host: v.host, hold: v.hold } });
  return id;
}

export async function deleteFeed(tx: Tx, id: string, userId: string | null): Promise<void> {
  await tx.delete(bankFeeds).where(eq(bankFeeds.id, id));
  await audit(tx, { userId, firmId: null, action: 'feedDelete', entityType: 'bank_feed', entityId: id, data: {} });
}

/** The connection with its password opened (worker only). */
export async function feedWithSecret(tx: Pick<Tx, 'select'>, id: string): Promise<(BankFeed & { password: string | null }) | null> {
  const [f] = await tx.select().from(bankFeeds).where(eq(bankFeeds.id, id)).limit(1);
  return f ? { ...f, password: openSecret(f.secret) } : null;
}

export async function feedRunResult(tx: Pick<Tx, 'update'>, id: string, ok: boolean, result: string, seen?: string[]): Promise<void> {
  await tx.update(bankFeeds).set({ lastRunAt: new Date(), lastOk: ok, lastResult: result.slice(0, 1000), ...(seen ? { seen: seen.slice(-3000) } : {}) }).where(eq(bankFeeds.id, id));
}

/** `*.xml;*.sta` → the file name matches ('' = any). */
export function feedNameOk(pattern: string, name: string): boolean {
  const P = pattern.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
  if (!P.length) return true;
  return P.some((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(name));
}

/** Is it time for the nightly run of `at` (HH:MM, Skopje) – once per day, within the hour after. */
export function feedDue(f: Pick<BankFeed, 'at' | 'lastRunAt' | 'active'>, now: Date): boolean {
  if (!f.active) return false;
  const sk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Skopje' }));
  const [h, m] = (f.at || '20:00').split(':').map(Number) as [number, number];
  const due = new Date(sk); due.setHours(h, m, 0, 0);
  if (sk < due || sk.getTime() - due.getTime() > 3600_000) return false;
  if (!f.lastRunAt) return true;
  const last = new Date(new Date(f.lastRunAt).toLocaleString('en-US', { timeZone: 'Europe/Skopje' }));
  return last < due;
}

/* ------------------------------------------------------------------ fetched files */

/** Every real firm with its bank accounts (the office's statements may belong to any client). */
export async function allFirmAccounts(tx: Pick<Tx, 'select'>): Promise<FirmAccounts[]> {
  const F = (await tx.select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(eq(firms.active, true))).filter((f) => !isDemoFirm(f));
  if (!F.length) return [];
  const B = await tx.select({ id: bankAccounts.id, firmId: bankAccounts.firmId, account: bankAccounts.account, iban: bankAccounts.iban, cur: bankAccounts.cur })
    .from(bankAccounts).where(inArray(bankAccounts.firmId, F.map((f) => f.id)));
  return F.map((f) => ({ id: f.id, name: f.name, accounts: B.filter((b) => b.firmId === f.id) }));
}

/** The same file (by content) already came from this connection. */
export async function feedFileSeen(tx: Pick<Tx, 'select'>, feedId: string, sha: string): Promise<boolean> {
  const [r] = await tx.select({ id: incomingDocs.id }).from(incomingDocs)
    .where(and(eq(incomingDocs.source, BANKFEED_SOURCE), sql`${incomingDocs.detect}->>'feedId' = ${feedId}`, sql`${incomingDocs.detect}->>'sha' = ${sha}`)).limit(1);
  return !!r;
}

export interface FeedFileIn { feed: Pick<BankFeed, 'id' | 'name' | 'bank' | 'hold'>; fileId: string; name: string; sha: string; statements: Statement[]; format: string; note?: string }

/**
 * One fetched file into the inbox: matched to the firm, waiting for approval (or booked when the connection does
 * not hold and the firm is certain). A file that is not a readable statement waits with the reason.
 */
export async function ingestFeedFile(tx: Tx, a: FeedFileIn): Promise<{ id: string; firmId: string | null; status: string; result: string }> {
  const F = await allFirmAccounts(tx);
  const m = a.statements.length ? bankMatch(a.statements, null, F) : { mode: 'wait' as const };
  const firmId = m.mode === 'propose' && m.firms.length === 1 ? m.firms[0]!.id : null;
  const problems = [...new Set(a.statements.flatMap((s) => statementProblems(s)))];
  const result = !a.statements.length ? (a.note || 'Датотеката не е препознаена како извод.')
    : !firmId ? (m.mode === 'propose' ? `Сметката е кај повеќе фирми (${m.firms.map((f) => f.name).join(', ')}) – изберете фирма.` : 'Сметката од изводот не е пронајдена кај ниедна фирма – изберете фирма или додајте ја сметката.')
      : problems.length ? `Салдата не се совпаѓаат: ${problems.join(' ')}` : 'Чека одобрување за книжење.';
  const [row] = await tx.insert(incomingDocs).values({
    firmId, fileId: a.fileId, source: BANKFEED_SOURCE, kind: 'bank', how: 'bankfeed', what: a.name, status: 'read', result,
    detect: { feedId: a.feed.id, feed: a.feed.name, bank: a.feed.bank, sha: a.sha, format: a.format, statements: statementBriefs(a.statements), full: a.statements, ...(problems.length ? { problems } : {}), ...(m.mode === 'propose' ? { proposed: m.firms } : {}) },
  }).returning({ id: incomingDocs.id });
  const id = row!.id;
  if (firmId) await tx.update(files).set({ firmId }).where(and(eq(files.id, a.fileId), sql`${files.firmId} is null`));
  if (firmId && !a.feed.hold && !problems.length) {
    const out = await incomingBankImport(tx, { id, firmId, statements: a.statements, format: a.format, userId: null, auto: true });
    return { id, firmId, status: out.status, result: out.result };
  }
  return { id, firmId, status: 'read', result };
}

export type FeedDoc = IncomingDoc & { firmName: string | null; fileName: string | null };

/** The bank-feed inbox: waiting first (newest first), then the last decided ones. */
export async function feedDocs(tx: Pick<Tx, 'select'>, o: { waiting?: boolean; limit?: number } = {}): Promise<FeedDoc[]> {
  const R = await tx.select({ d: incomingDocs, firmName: firms.name, fileName: files.name }).from(incomingDocs)
    .leftJoin(firms, eq(firms.id, incomingDocs.firmId)).leftJoin(files, eq(files.id, incomingDocs.fileId))
    .where(and(eq(incomingDocs.source, BANKFEED_SOURCE), o.waiting ? eq(incomingDocs.status, 'read') : sql`true`))
    .orderBy(desc(incomingDocs.createdAt)).limit(o.limit ?? 300);
  return R.map((r) => ({ ...r.d, firmName: r.firmName, fileName: r.fileName }));
}

const docOf = async (tx: Tx, id: string) => {
  const [r] = await tx.select().from(incomingDocs).where(and(eq(incomingDocs.id, id), eq(incomingDocs.source, BANKFEED_SOURCE))).for('update').limit(1);
  if (!r) throw new FeedError('Изводот не постои.');
  return r;
};

/** Statements from the bank connections still waiting for approval, of one firm (the banner on its Изводи page). */
export async function feedWaitingFor(tx: Pick<Tx, 'select'>, firmId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(incomingDocs)
    .where(and(eq(incomingDocs.source, BANKFEED_SOURCE), eq(incomingDocs.status, 'read'), eq(incomingDocs.firmId, firmId)));
  return r?.n ?? 0;
}

/** Pick the firm of a waiting statement (the account was not found, or several firms share it). */
export async function feedSetFirm(tx: Tx, id: string, firmId: string, userId: string | null): Promise<void> {
  const r = await docOf(tx, id);
  if (r.status !== 'read') throw new FeedError('Изводот е веќе обработен.');
  await tx.update(incomingDocs).set({ firmId, result: 'Чека одобрување за книжење.' }).where(eq(incomingDocs.id, id));
  await tx.update(files).set({ firmId }).where(and(eq(files.id, r.fileId), sql`${files.firmId} is null`));
  await audit(tx, { userId, firmId, action: 'feedFirm', entityType: 'incoming_doc', entityId: id, data: {} });
}

/** „✓ Одобри и прокнижи“ — the existing import, booked into the bank nalog of each statement's period. */
export async function feedApprove(tx: Tx, id: string, userId: string): Promise<BankImportOutcome> {
  const r = await docOf(tx, id);
  if (r.status !== 'read') throw new FeedError('Изводот е веќе обработен.');
  if (!r.firmId) throw new FeedError('Прво изберете фирма за изводот.');
  const st = ((r.detect as { full?: Statement[] }).full ?? []) as Statement[];
  if (!st.length) throw new FeedError('Изводот не е прочитан – увезете го рачно во Изводи.');
  return incomingBankImport(tx, { id, firmId: r.firmId, statements: st, format: String((r.detect as { format?: string }).format ?? ''), userId, auto: false });
}

/** „✕ Отфрли“ — not booked (kept in the archive as skipped). */
export async function feedReject(tx: Tx, id: string, userId: string): Promise<void> {
  const r = await docOf(tx, id);
  if (r.status !== 'read') throw new FeedError('Изводот е веќе обработен.');
  await tx.update(incomingDocs).set({ status: 'skipped', result: 'Отфрлен – не е прокнижен.', doneBy: userId, doneAt: new Date() }).where(eq(incomingDocs.id, id));
  await audit(tx, { userId, firmId: r.firmId, action: 'feedReject', entityType: 'incoming_doc', entityId: id, data: {} });
}

/** Mark printed (the office keeps the paper copy) – shown in the list. */
export async function feedPrinted(tx: Tx, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.update(incomingDocs).set({ detect: sql`${incomingDocs.detect} || jsonb_build_object('printedAt', ${new Date().toISOString()}::text)` })
    .where(and(inArray(incomingDocs.id, ids), eq(incomingDocs.source, BANKFEED_SOURCE)));
}

export const feedSha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
