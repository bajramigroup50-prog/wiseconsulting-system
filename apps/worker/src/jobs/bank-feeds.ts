/**
 * `bank.feeds` — „🏦 Изводи од банка (автоматски)“: every 15 minutes the connections whose evening time („at“) came
 * fetch the new statement files from the bank, and „Преземи сега“ / „Тест на врската“ run one connection at once.
 *
 * Channels: SFTP host-to-host (the office SSH key or a password, from the server's fixed IP), an e-mail mailbox the
 * bank sends the statements to (IMAP, attachments of unseen messages), or a folder on the server. Each new file is
 * stored, read (XML Халк / camt.053, MT940, КБ, CSV, a text PDF that reconciles – no AI) and put in the inbox matched
 * to its firm (`ingestFeedFile`): it waits for the office's approval unless the connection books automatically.
 * Nothing is deleted at the bank. The job never throws: the result is on the connection („последно преземање“).
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { statementsFromRead } from '@wise/core/ai/bank';
import { brandCustom } from '@wise/core';
import { detectIncoming } from '@wise/core/office';
import type { Statement } from '@wise/core/bank-parsers';
import {
  BANKFEED_JOB, feedDue, feedFileSeen, feedNameOk, feedPrivateKeys, feedRunResult, feedSha, feedWithSecret, ingestFeedFile, listFeeds,
  type BankFeed, type DB, type Tx,
} from '@wise/db';
import { defineJob } from '../job';
import { s3Store, storeFile } from '../storage';
import { freeAccepted, freeRead } from '../ai/free-read';

export interface FeedItem { name: string; bytes: Uint8Array; ref?: string }
type Feed = BankFeed & { password: string | null };

const MAX = 200;
const isPdf = (n: string) => /\.pdf$/i.test(n);
const mimeOf = (n: string) => (/\.xml$/i.test(n) ? 'application/xml' : isPdf(n) ? 'application/pdf' : /\.csv$/i.test(n) ? 'text/csv' : /\.xlsx?$/i.test(n) ? 'application/vnd.ms-excel' : 'application/octet-stream');
const extOf = (n: string) => (n.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'bin').toLowerCase();

/** The statements of a fetched file (no AI): structured formats exactly, a text PDF only when it reconciles. */
export async function feedStatements(name: string, bytes: Uint8Array): Promise<{ statements: Statement[]; format: string; note?: string }> {
  const f = { name, mime: mimeOf(name) };
  const d = detectIncoming(f, bytes);
  if (d.statements?.length) return { statements: d.statements, format: d.format ?? '' };
  if (isPdf(name)) {
    const fr = await freeRead('bank', f as never, bytes).catch(() => null);
    if (freeAccepted('bank', fr)) return { statements: statementsFromRead(fr), format: 'pdf' };
    return { statements: [], format: '', note: 'PDF изводот не се чита без AI (скениран или салдата не се совпаѓаат) – отворете го и увезете го во Изводи.' };
  }
  return { statements: [], format: '', note: 'Датотеката не е препознаена како извод.' };
}

/* ------------------------------------------------------------------ channels */

export async function sftpItems(f: Feed, key: string | string[] | null, seen: Set<string>, listOnly: boolean): Promise<{ items: FeedItem[]; listed: number }> {
  const { default: Client } = await import('ssh2-sftp-client');
  // the office keys in turn (ed25519, then RSA-4096 for the banks that accept only ssh-rsa); a password wins
  const keys = f.password ? [null] : (Array.isArray(key) ? key : [key]).filter((k) => k !== undefined);
  let c = new Client('wise-bank');
  for (let i = 0; ; i++) {
    const k = keys[i] ?? null;
    try {
      await c.connect({
        host: f.host, port: f.port || 22, username: f.username, readyTimeout: 20000,
        ...(f.password ? { password: f.password } : k ? { privateKey: k } : {}),
      });
      break;
    } catch (e) {
      if (i + 1 >= keys.length || !/authentication/i.test(String((e as Error)?.message ?? e))) throw e;
      await c.end().catch(() => undefined);
      c = new Client('wise-bank');
    }
  }
  try {
    const dir = f.path || '.';
    const L = (await c.list(dir)).filter((x) => x.type === '-' && feedNameOk(f.pattern, x.name)).sort((a, b) => a.modifyTime - b.modifyTime);
    if (listOnly) return { items: [], listed: L.length };
    const items: FeedItem[] = [];
    for (const x of L) {
      const ref = `${x.name}|${x.size}|${x.modifyTime}`;
      if (seen.has(ref)) continue;
      if (items.length >= MAX) break;
      const b = await c.get(dir.replace(/\/$/, '') + '/' + x.name);
      items.push({ name: x.name, bytes: new Uint8Array(b as Buffer), ref });
    }
    return { items, listed: L.length };
  } finally { await c.end().catch(() => {}); }
}

async function imapItems(f: Feed, listOnly: boolean): Promise<{ items: FeedItem[]; listed: number }> {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const c = new ImapFlow({ host: f.host, port: f.port || 993, secure: (f.port || 993) === 993, auth: { user: f.username, pass: f.password ?? '' }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock(f.path || 'INBOX');
  try {
    const uids = (await c.search({ seen: false, since: new Date(Date.now() - 30 * 86400_000) }, { uid: true })) || [];
    if (listOnly) return { items: [], listed: uids.length };
    const items: FeedItem[] = [];
    for (const uid of uids) {
      if (items.length >= MAX) break;
      const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!m || !m.source) continue;
      const mail = await simpleParser(m.source);
      for (const a of mail.attachments ?? []) {
        const name = a.filename || `izvod-${uid}.${a.contentType?.split('/')[1] ?? 'bin'}`;
        if (feedNameOk(f.pattern, name)) items.push({ name, bytes: new Uint8Array(a.content), ref: `mail:${uid}:${name}` });
      }
      await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    }
    return { items, listed: uids.length };
  } finally { lock.release(); await c.logout().catch(() => {}); }
}

async function folderItems(f: Feed, seen: Set<string>, listOnly: boolean): Promise<{ items: FeedItem[]; listed: number }> {
  const dir = f.path;
  if (!dir) throw new Error('Внесете папка.');
  const names = (await readdir(dir)).filter((n) => feedNameOk(f.pattern, n));
  if (listOnly) return { items: [], listed: names.length };
  const items: FeedItem[] = [];
  for (const n of names) {
    const s = await stat(join(dir, n));
    if (!s.isFile()) continue;
    const ref = `${n}|${s.size}|${s.mtimeMs}`;
    if (seen.has(ref)) continue;
    if (items.length >= MAX) break;
    items.push({ name: n, bytes: new Uint8Array(await readFile(join(dir, n))), ref });
  }
  return { items, listed: names.length };
}

/** Fetch the new files of one connection (exported for tests: `channel` replaces the network). */
export async function fetchFeed(db: DB, f: Feed, listOnly: boolean, channel?: (f: Feed) => Promise<{ items: FeedItem[]; listed: number }>): Promise<{ items: FeedItem[]; listed: number }> {
  const seen = new Set(f.seen ?? []);
  if (channel) return channel(f);
  if (f.method === 'sftp') return sftpItems(f, f.password ? null : await feedPrivateKeys(db), seen, listOnly);
  if (f.method === 'imap') return imapItems(f, listOnly);
  return folderItems(f, seen, listOnly);
}

/** One connection: fetch, store, read and put every new file in the inbox. Returns the summary line. */
export async function runFeed(db: DB, id: string, o: { test?: boolean; log?: (m: string) => void; channel?: (f: Feed) => Promise<{ items: FeedItem[]; listed: number }> } = {}): Promise<string> {
  const log = o.log ?? (() => {});
  const f = await feedWithSecret(db, id);
  if (!f) return 'Врската не постои.';
  try {
    const { items, listed } = await fetchFeed(db, f, !!o.test, o.channel);
    if (o.test) {
      const msg = `✓ Врската работи – на серверот има ${listed} ${f.method === 'imap' ? 'непрочитани пораки' : 'датотеки'}.`;
      await feedRunResult(db, id, true, msg);
      return msg;
    }
    let neu = 0, wait = 0, booked = 0, dup = 0;
    const seen = [...(f.seen ?? [])];
    for (const it of items) {
      const sha = feedSha(it.bytes);
      if (it.ref) seen.push(it.ref);
      if (await feedFileSeen(db, f.id, sha)) { dup++; continue; }
      const { statements, format, note } = await feedStatements(it.name, it.bytes);
      const fileId = await storeFile(db, s3Store, { firmId: null, name: it.name, mime: mimeOf(it.name), ext: extOf(it.name), body: it.bytes });
      const r = await db.transaction((tx) => ingestFeedFile(tx as unknown as Tx, { feed: f, fileId, name: it.name, sha, statements, format, note }));
      neu++;
      if (r.status === 'done') booked++; else wait++;
      log(`${f.name}: ${it.name} → ${r.status} ${r.result}`);
    }
    const msg = items.length ? `✓ Преземени ${neu} нови извод(и)${wait ? `, ${wait} чекаат одобрување` : ''}${booked ? `, ${booked} автоматски прокнижени` : ''}${dup ? `, ${dup} веќе преземени` : ''}.` : `✓ Нема нови изводи (на серверот: ${listed}).`;
    await feedRunResult(db, id, true, msg, seen);
    return msg;
  } catch (e) {
    const msg = '✕ ' + (e instanceof Error ? e.message : String(e));
    await feedRunResult(db, id, false, msg);
    log(`${f.name}: ${msg}`);
    return msg;
  }
}

export const bankFeeds = defineJob<{ feedId?: string; test?: boolean }>({
  name: BANKFEED_JOB,
  cron: '*/15 * * * *',
  queue: { retryLimit: 0, expireInSeconds: 30 * 60 },
  async run(data, { db, log }) {
    // the bank connection runs on the office's own (WISE) server only, never on another installation (Фејкан)
    if (brandCustom()) return;
    if (data?.feedId) { await runFeed(db as unknown as DB, data.feedId, { test: !!data.test, log }); return; }
    const now = new Date();
    for (const f of await listFeeds(db as unknown as DB)) if (feedDue(f, now)) await runFeed(db as unknown as DB, f.id, { log });
  },
});
