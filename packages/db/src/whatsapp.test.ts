/** 💬 WhatsApp on PGlite with a mocked Graph API (Meta is never called): sealing, signature, phone matching, sending. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { waMatch, waParseWebhook } from '@wise/core/whatsapp/wa';
import * as schema from './schema/index';
import type { DB } from './index';
import { openSecret } from './social';
import {
  WA_KEY, saveWaSettings, saveWaTemplates, waApplyStatus, waAssign, waConversations, waIngestFile, waKnown, waLearned, waRecordIn, waSecrets, waSettings,
} from './whatsapp';
import { waHandshake, waSign, waSignatureOk } from './whatsapp-sig';
import { waSend } from './whatsapp-send';

process.env.S3_SECRET_KEY ||= 'test-secret';
const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
type D = typeof pg;
const T = <R>(f: (tx: D) => Promise<R>) => pg.transaction((tx) => f(tx as unknown as D));
let A = '', B = '', user = '', pdf = '';
const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = 'EAAGtestTOKENvalue1234567890';

let n = 0;
/** A fake Graph API: records every call (token redacted) and answers like Meta. */
function graph(o: { fail?: string } = {}) {
  const calls: { m: string; u: string; body?: unknown; auth: boolean }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof FormData ? 'form' : undefined;
    calls.push({ m: init?.method ?? 'GET', u, body, auth: String((init?.headers as Record<string, string> | undefined)?.authorization ?? '') === `Bearer ${TOKEN}` });
    if (o.fail && u.includes(o.fail)) return new Response(JSON.stringify({ error: { message: 'Recipient not in allowed list', code: 131030 } }), { status: 400 });
    if (u.endsWith('/media')) return Response.json({ id: 'MEDIA' + ++n });
    if (u.endsWith('/messages')) return Response.json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.OUT' + ++n }] });
    return Response.json({});
  };
  return { f, calls };
}
const readFile = async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf', name: 'Faktura_12.pdf' });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  [A, B] = (await pg.insert(schema.firms).values([{ name: 'Фирма А ДООЕЛ', phone: '070 111 222' }, { name: 'Фирма Б ДОО', phone: '02 3 222 333' }]).returning()).map((f) => f.id) as [string, string];
  user = (await pg.insert(schema.users).values({ username: 'owner', name: 'Сопственик', role: 'admin', passwordHash: 'x' }).returning())[0]!.id;
  await pg.insert(schema.firmContacts).values({ firmId: B, name: 'Марко (Б)', phone: '+389 71 333 444' });
  await pg.insert(schema.partners).values([{ firmId: A, name: 'Купувач 1', phone: '072 555 666' }, { firmId: B, name: 'Купувач 2', phone: '072 555 666' }]);
  pdf = (await pg.insert(schema.files).values({ firmId: A, bucketKey: 'k/1', name: 'Faktura_12.pdf', mime: 'application/pdf', size: 4, sha256: 'x', status: 'ready', uploadedBy: user }).returning())[0]!.id;
}, 60_000);

describe('settings sealing', () => {
  it('secrets are sealed, never stored or shown in clear, and an empty field keeps them', async () => {
    await expect(T((tx) => saveWaSettings(tx as never, { on: true, phoneNumberId: '11122233', wabaId: '22233344' }, user))).rejects.toThrow(/пополнете/);
    const s = await T((tx) => saveWaSettings(tx as never, { on: false, phoneNumberId: '111222333', wabaId: '444555666', appSecret: SECRET, token: TOKEN }, user));
    expect(s).toMatchObject({ hasSecret: true, hasToken: true, on: false });
    expect(JSON.stringify(s)).not.toContain(SECRET);
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(s.verifyToken).toMatch(/^wise-/);
    const [row] = await pg.select().from(schema.appSettings).where(eq(schema.appSettings.key, WA_KEY));
    const raw = JSON.stringify(row!.value);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(TOKEN);
    expect(openSecret((row!.value as { token: string }).token)).toBe(TOKEN);
    // switch on with empty secret fields: the stored ones stay
    await T((tx) => saveWaSettings(tx as never, { on: true, phoneNumberId: '111222333', wabaId: '444555666', appSecret: '', token: '' }, user));
    const x = await waSecrets(db as never);
    expect(x.on).toBe(true);
    expect(x.secret).toBe(SECRET);
    expect(x.accessToken).toBe(TOKEN);
    expect((await waSettings(db as never)).verifyToken).toBe(s.verifyToken);
    // the audit says only „new / same“, never the value
    const L = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'waSettings'));
    expect(JSON.stringify(L.map((l) => l.data))).not.toContain(TOKEN);
    expect(L.at(-1)!.data).toMatchObject({ secret: 'same', token: 'same', on: true });
  });
  it('rejects malformed values', async () => {
    await expect(T((tx) => saveWaSettings(tx as never, { on: false, phoneNumberId: 'abc', wabaId: '' }, user))).rejects.toThrow(/Phone Number ID/);
    await expect(T((tx) => saveWaSettings(tx as never, { on: false, phoneNumberId: '111222333', wabaId: '', appSecret: 'not hex!' }, user))).rejects.toThrow(/App secret/);
  });
});

describe('webhook signature and handshake', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  it('accepts only the HMAC of the exact raw body with the app secret', () => {
    expect(waSignatureOk(body, waSign(body, SECRET), SECRET)).toBe(true);
    expect(waSignatureOk(body + ' ', waSign(body, SECRET), SECRET)).toBe(false);
    expect(waSignatureOk(body, waSign(body, 'f'.repeat(32)), SECRET)).toBe(false);
    expect(waSignatureOk(body, null, SECRET)).toBe(false);
    expect(waSignatureOk(body, 'sha256=xyz', SECRET)).toBe(false);
    expect(waSignatureOk(body, waSign(body, SECRET), null)).toBe(false);
    expect(waSignatureOk(body, waSign(body, SECRET).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true);
  });
  it('the GET handshake echoes the challenge only for our verify token', () => {
    const q = (t: string, mode = 'subscribe') => new URLSearchParams({ 'hub.mode': mode, 'hub.verify_token': t, 'hub.challenge': '1158201444' });
    expect(waHandshake(q('wise-abc'), 'wise-abc')).toBe('1158201444');
    expect(waHandshake(q('wise-abd'), 'wise-abc')).toBeNull();
    expect(waHandshake(q('wise-abc', 'unsubscribe'), 'wise-abc')).toBeNull();
    expect(waHandshake(q(''), '')).toBeNull();
  });
});

describe('incoming: phone matching, unassigned inbox, files', () => {
  const hook = (from: string, id: string, extra: object = { type: 'text', text: { body: 'Здраво' } }) => waParseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: '111222333' }, contacts: [{ wa_id: from, profile: { name: 'Клиент' } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000) - 60), ...extra }] } }] }] }).messages[0]!;
  it('a firm phone and a firm contact go to the firm; the same partner in two firms waits', async () => {
    const K = await waKnown(db as never);
    expect(waMatch('38970111222', K)).toMatchObject({ firmId: A, how: 'firm' });
    expect(waMatch('38971333444', K)).toMatchObject({ firmId: B, how: 'contact' });
    expect(waMatch('38972555666', K)).toMatchObject({ firmId: null, candidates: [A, B] });
  });
  it('stores a message once, assigns unknown numbers and remembers them', async () => {
    const K = await waKnown(db as never);
    const m1 = hook('38970111222', 'wamid.in1');
    expect(await waRecordIn(db as never, m1, waMatch(m1.from, K))).toBeTruthy();
    expect(await waRecordIn(db as never, m1, waMatch(m1.from, K))).toBeNull(); // a webhook delivered twice
    const m2 = hook('38978000111', 'wamid.in2', { type: 'document', document: { id: 'MED9', mime_type: 'application/pdf', filename: 'izvod.pdf' } });
    const id2 = (await waRecordIn(db as never, m2, waMatch(m2.from, K)))!;
    expect((await waConversations(db as never, { unassigned: true })).map((c) => c.phone)).toEqual(['38978000111']);
    // the worker stored the file: into the office inbox (no firm yet)
    const f = (await pg.insert(schema.files).values({ firmId: null, bucketKey: 'office/x', name: 'izvod.pdf', mime: 'application/pdf', size: 4, sha256: 'y', status: 'ready' }).returning())[0]!.id;
    const inId = await T((tx) => waIngestFile(tx as never, { msgId: id2, fileId: f, name: 'izvod.pdf' }));
    const [d] = await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, inId));
    expect(d).toMatchObject({ firmId: null, source: 'whatsapp', status: 'unread' });
    // the office picks firm B: the messages and the file move, the phone is remembered
    expect(await T((tx) => waAssign(tx as never, { phone: '078 000 111', firmId: B, userId: user }))).toBe(1);
    expect((await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, inId)))[0]!.firmId).toBe(B);
    expect((await pg.select().from(schema.files).where(eq(schema.files.id, f)))[0]!.firmId).toBe(B);
    expect((await waLearned(db as never))['38978000111']).toBe(B);
    const m3 = hook('38978000111', 'wamid.in3');
    expect(waMatch(m3.from, await waKnown(db as never), await waLearned(db as never))).toMatchObject({ firmId: B, how: 'learned' });
  });
});

describe('sending (mocked Graph API)', () => {
  it('inside the 24-hour window: text + PDF as a document, logged and audited', async () => {
    const g = graph();
    const r = await waSend(db, { userId: user, firmId: A, phone: '070 111 222', text: 'Фактура во прилог', fileIds: [pdf], purpose: 'faktura' }, { fetch: g.f, base: 'http://mock', readFile });
    expect(r).toMatchObject({ sent: 2 });
    expect(g.calls.map((c) => `${c.m} ${c.u}`)).toEqual(['POST http://mock/111222333/messages', 'POST http://mock/111222333/media', 'POST http://mock/111222333/messages']);
    expect(g.calls.every((c) => c.auth)).toBe(true);
    expect(g.calls[0]!.body).toMatchObject({ to: '38970111222', type: 'text', text: { body: 'Фактура во прилог' } });
    expect(g.calls[2]!.body).toMatchObject({ type: 'document', document: { filename: 'Faktura_12.pdf' } });
    const out = await pg.select().from(schema.waMessages).where(and(eq(schema.waMessages.dir, 'out'), eq(schema.waMessages.firmId, A)));
    expect(out.map((m) => [m.kind, m.status, m.purpose])).toEqual([['text', 'sent', 'faktura'], ['document', 'sent', 'faktura']]);
    const au = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'waSend'));
    expect(au).toHaveLength(2);
    // delivery receipts move the status forward only
    expect(await waApplyStatus(db as never, { waId: out[0]!.waId!, status: 'read', at: new Date(), to: '', error: null })).toBe(true);
    expect(await waApplyStatus(db as never, { waId: out[0]!.waId!, status: 'delivered', at: new Date(), to: '', error: null })).toBe(false);
  });
  it('outside the window: only the approved template, else refused without calling Meta', async () => {
    const g = graph();
    const r = await waSend(db, { userId: user, firmId: B, phone: '02 3 222 333', text: 'Потсетник', purpose: 'rok', vars: { firma: 'Фирма Б', opis: 'ДДВ-04', rok: '25.11.2026' } }, { fetch: g.f, base: 'http://mock', readFile });
    expect(r).toHaveProperty('error');
    expect(g.calls).toHaveLength(0);
    await T((tx) => saveWaTemplates(tx as never, [{ name: 'potsetnik_rok', lang: 'mk', purpose: 'rok', vars: ['firma', 'opis', 'rok'] }], user));
    const r2 = await waSend(db, { userId: user, firmId: B, phone: '02 3 222 333', text: 'Потсетник', purpose: 'rok', vars: { firma: 'Фирма Б', opis: 'ДДВ-04', rok: '25.11.2026' } }, { fetch: g.f, base: 'http://mock', readFile });
    expect(r2, JSON.stringify(r2)).toMatchObject({ sent: 1 });
    expect(g.calls[0]!.body).toMatchObject({ type: 'template', template: { name: 'potsetnik_rok', language: { code: 'mk' } } });
    // a reply in the conversation view is never turned into a template
    const r3 = await waSend(db, { userId: user, firmId: B, phone: '02 3 222 333', text: 'здраво', purpose: 'opsto', freeOnly: true }, { fetch: g.f, base: 'http://mock', readFile });
    expect('error' in r3 && r3.error).toMatch(/24 часа/);
  });
  it('a Meta error is logged as failed', async () => {
    const g = graph({ fail: '/messages' });
    const r = await waSend(db, { userId: user, firmId: A, phone: '070 111 222', text: 'x', purpose: 'opsto' }, { fetch: g.f, base: 'http://mock', readFile });
    expect('error' in r && r.error).toMatch(/Recipient not in allowed list/);
    const [f] = await pg.select().from(schema.waMessages).where(eq(schema.waMessages.status, 'failed'));
    expect(f).toMatchObject({ dir: 'out', body: 'x' });
    expect((await pg.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'waSendFailed'))).length).toBe(1);
  });
  it('the rate limit stops a burst', async () => {
    await T((tx) => saveWaSettings(tx as never, { on: true, phoneNumberId: '111222333', wabaId: '444555666', perMinute: 3, perDay: 100 }, user));
    const g = graph();
    const r = await waSend(db, { userId: user, firmId: A, phone: '070 111 222', text: 'x', purpose: 'opsto' }, { fetch: g.f, base: 'http://mock', readFile });
    expect('error' in r && r.error).toMatch(/минута/);
    expect(g.calls).toHaveLength(0);
  });
  it('switched off → refused with `off` (the buttons fall back to the wa.me link)', async () => {
    await T((tx) => saveWaSettings(tx as never, { on: false, phoneNumberId: '111222333', wabaId: '444555666' }, user));
    const g = graph();
    expect(await waSend(db, { userId: user, firmId: A, phone: '070 111 222', text: 'x', purpose: 'opsto' }, { fetch: g.f, readFile })).toMatchObject({ off: true });
    expect(g.calls).toHaveLength(0);
  });
});
