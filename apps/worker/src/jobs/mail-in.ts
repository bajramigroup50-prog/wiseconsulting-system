/**
 * `mail.in` — „✉ Е-пошта → WISE“: every 10 minutes read the office mailbox (IMAP, `mailin.cfg`, packages/db mail-in.ts)
 * and put each kept attachment of each new mail into „📥 Пристигнати документи“ of its firm (`mailMatch`), or of the
 * office when the firm is not certain; then `incoming.detect` finds the document type as for any uploaded file.
 *
 * Read only: no flag is set, nothing is moved or deleted. The cursor is the folder's UIDVALIDITY + the last UID; the
 * first run (or after „одново“) starts `days` back. At most MAX mails per run (the rest next time). Mails sent by the
 * mailbox itself and mails without a kept attachment are counted, not stored. Runs on the office's own server only.
 */
import { createHash } from 'node:crypto';
import { brandCustom } from '@wise/core';
import { INCOMING_JOB, mailAddr, mailFileWanted, MAILIN_JOB, mailMatch, mailOrigin, type MailMatch } from '@wise/core/office';
import { ingestMailFile, mailFileSeen, mailInContext, mailInResult, mailInSecret, type DB, type Tx } from '@wise/db';
import { pdfTextItems } from '../ai/pdf-text';
import { defineJob } from '../job';
import { s3Store, storeFile, type ObjectStore } from '../storage';

const MAX = 200;
const extOf = (n: string) => (/\.([a-z0-9]{1,8})$/i.exec(n)?.[1] ?? 'bin').toLowerCase();

export interface MailPart { name: string; mime: string; bytes: Uint8Array; inline?: boolean }
export interface MailMsg { uid: number; from: string; fromName: string | null; subject: string; text: string; date: string | null; msgId: string | null; parts: MailPart[] }
export interface MailChannel { uidValidity: string; messages: MailMsg[]; listed: number }

/** IMAP: messages with UID > lastUid (or since `days` back when the cursor is new / the folder changed). */
async function imapChannel(c: { host: string; port: number; user: string; pass: string; folder: string; days: number; uidValidity?: string | null; lastUid?: number }, test: boolean): Promise<MailChannel> {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({ host: c.host, port: c.port || 993, secure: (c.port || 993) === 993, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  try {
    const box = await client.mailboxOpen(c.folder || 'INBOX', { readOnly: true });
    const uv = String(box.uidValidity ?? '');
    const fresh = !c.uidValidity || c.uidValidity !== uv || !c.lastUid;
    const query = fresh ? { since: new Date(Date.now() - c.days * 86400_000) } : { uid: `${c.lastUid! + 1}:*` };
    const uids = ((await client.search(query, { uid: true })) || []).filter((u) => fresh || u > (c.lastUid ?? 0)).sort((a, b) => a - b);
    if (test) return { uidValidity: uv, messages: [], listed: uids.length };
    const messages: MailMsg[] = [];
    for (const uid of uids.slice(0, MAX)) {
      const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!m || !m.source) continue;
      const p = await simpleParser(m.source);
      const fromV = p.from?.value?.[0];
      messages.push({
        uid, from: fromV?.address ?? '', fromName: fromV?.name || null, subject: p.subject ?? '', text: (p.text ?? '').slice(0, 20_000),
        date: p.date ? p.date.toISOString() : null, msgId: p.messageId ?? null,
        parts: (p.attachments ?? []).map((a, i) => ({
          name: a.filename || `prilog-${uid}-${i + 1}.${a.contentType?.split('/')[1] ?? 'bin'}`, mime: a.contentType || 'application/octet-stream',
          bytes: new Uint8Array(a.content), inline: a.contentDisposition === 'inline' || !!a.cid,
        })),
      });
    }
    return { uidValidity: uv, messages, listed: uids.length };
  } finally {
    await client.logout().catch(() => {});
  }
}

/** The text layer of a PDF attachment (first pages), '' for other files, scans or a broken PDF. */
async function docText(p: MailPart): Promise<string> {
  const pdf = /pdf/i.test(p.mime) || /\.pdf$/i.test(p.name);
  if (!pdf) return '';
  try { return (await pdfTextItems(p.bytes, 5)).map((i) => i.s).join(' ').slice(0, 50_000); } catch { return ''; }
}

/** One run. `channel` replaces IMAP in tests. Returns the result line. */
export async function runMailIn(db: DB, o: { test?: boolean; log?: (m: string) => void; send?: (name: string, data: object) => Promise<unknown>; channel?: MailChannel; store?: ObjectStore } = {}): Promise<string> {
  const log = o.log ?? (() => {});
  const c = await mailInSecret(db as unknown as Tx);
  if (!o.channel && (!c.host || !c.user || !c.pass)) return 'Сандачето не е поставено.';
  try {
    const ch = o.channel ?? await imapChannel({ ...c, pass: c.pass! }, !!o.test);
    if (o.test) {
      const msg = `✓ Врската работи – ${ch.listed} пораки за читање (${c.lastUid ? 'нови' : `од последните ${c.days} дена`}).`;
      await mailInResult(db as unknown as Tx, true, msg);
      return msg;
    }
    const ctx = await mailInContext(db as unknown as Tx);
    const names = new Map(ctx.firms.map((f) => [f.id, f.name]));
    let mails = 0, docs = 0, toFirm = 0, waiting = 0, own = 0, empty = 0, dup = 0, last = c.uidValidity === ch.uidValidity ? (c.lastUid ?? 0) : 0;
    for (const m of ch.messages) {
      last = Math.max(last, m.uid);
      mails++;
      // a forwarded mail (Hotmail → info@, „Fw:“): the client is the sender written in the text
      const from = mailOrigin(m.from, m.subject, m.text, ctx.office);
      if (ctx.ownAddr && mailAddr(m.from) === ctx.ownAddr && from === ctx.ownAddr) { own++; continue; }
      const parts = m.parts.filter((p) => mailFileWanted({ name: p.name, mime: p.mime, size: p.bytes.byteLength, inline: p.inline }));
      if (!parts.length) { empty++; continue; }
      const base = { from, subject: m.subject, text: m.text, fileNames: parts.map((p) => p.name), learned: ctx.learned, userFirms: ctx.userFirms, firms: ctx.firms, ownEdb: ctx.ownEdb };
      const mailM: MailMatch = mailMatch(base);
      let match: MailMatch = mailM;
      for (const p of parts) {
        // the document's own text: it may come from anyone (a supplier, the bank) for one of our firms
        const content = await docText(p);
        match = content ? mailMatch({ ...base, content }) : mailM;
        const sha = createHash('sha256').update(p.bytes).digest('hex');
        if (await mailFileSeen(db as unknown as Tx, m.msgId, sha)) { dup++; continue; }
        const fileId = await storeFile(db, o.store ?? s3Store, { firmId: match.firmId, name: p.name, mime: p.mime, ext: extOf(p.name), body: p.bytes });
        const id = await db.transaction((tx) => ingestMailFile(tx as unknown as Tx, {
          fileId, name: p.name, sha, firmId: match.firmId, how: 'how' in match ? match.how : null,
          candidates: 'candidates' in match ? match.candidates.map((x: string) => ({ id: x, name: names.get(x) ?? '' })) : undefined,
          mail: { from, fromName: from === mailAddr(m.from) ? m.fromName : null, via: from === mailAddr(m.from) ? null : mailAddr(m.from), subject: m.subject, date: m.date, msgId: m.msgId, uid: m.uid },
        }));
        docs++;
        if (match.firmId) toFirm++; else waiting++;
        await o.send?.(INCOMING_JOB, { id });
      }
      log(`mail.in: ${m.uid} ${from} „${m.subject.slice(0, 60)}“ → ${match.firmId ? names.get(match.firmId) : 'канцеларија'}`);
    }
    const more = ch.listed > ch.messages.length ? ` (уште ${ch.listed - ch.messages.length} следниот пат)` : '';
    const msg = mails
      ? `✓ Прочитани ${mails} пораки: ${docs} документи${toFirm ? ` – ${toFirm} во фирмите` : ''}${waiting ? `, ${waiting} чекаат избор на фирма` : ''}${empty ? `; ${empty} без прилог` : ''}${own ? `; ${own} од самото сандаче` : ''}${dup ? `; ${dup} веќе преземени` : ''}${more}.`
      : '✓ Нема нови пораки.';
    await mailInResult(db as unknown as Tx, true, msg, { uidValidity: ch.uidValidity, lastUid: last });
    return msg;
  } catch (e) {
    const msg = '✕ ' + (e instanceof Error ? e.message : String(e));
    await mailInResult(db as unknown as Tx, false, msg);
    log(`mail.in: ${msg}`);
    return msg;
  }
}

export const mailIn = defineJob<{ test?: boolean; now?: boolean }>({
  name: MAILIN_JOB,
  cron: '*/10 * * * *',
  queue: { retryLimit: 0, expireInSeconds: 20 * 60 },
  async run(data, { db, log, send }) {
    // the office mailbox is read on the office's own (WISE) server only, never on another installation (Фејкан)
    if (brandCustom()) return;
    const c = await mailInSecret(db as unknown as Tx);
    if (!c.on && !data?.test && !data?.now) return;
    await runMailIn(db as unknown as DB, { test: !!data?.test, log, send });
  },
});
