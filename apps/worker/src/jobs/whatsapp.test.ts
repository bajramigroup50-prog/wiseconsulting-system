/** 💬 `wa.media` on PGlite with a mocked Graph API and store: a client's PDF lands in „📥 Пристигнати документи“. */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { waMatch, waParseWebhook } from '@wise/core/whatsapp/wa';
import { saveWaSettings, schema, waKnown, waRecordIn, type DB } from '@wise/db';
import { runWaMedia } from './whatsapp';

process.env.S3_SECRET_KEY ||= 'test-secret';
const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as DB;
let A = '';
const TOKEN = 'EAAGtestTOKENvalue1234567890';

const meta = () => {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization === `Bearer ${TOKEN}`;
    calls.push(`${url}${auth ? ' 🔑' : ''}`);
    if (url === 'http://mock/MED1') return Response.json({ url: 'http://mock/dl/MED1', mime_type: 'application/pdf', file_size: 4 });
    if (url === 'http://mock/dl/MED1') return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-type': 'application/pdf' } });
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
};

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  A = (await pg.insert(schema.firms).values({ name: 'Фирма А', phone: '070 111 222' }).returning())[0]!.id;
  await pg.transaction((tx) => saveWaSettings(tx as never, { on: true, phoneNumberId: '11122233', wabaId: '', appSecret: '0123456789abcdef0123456789abcdef', token: TOKEN }, null));
}, 60_000);

describe('wa.media', () => {
  it('downloads the PDF with the token, stores it and puts it into the firm inbox', async () => {
    const m = waParseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [
      { from: '38970111222', id: 'wamid.d1', timestamp: '1763726400', type: 'document', document: { id: 'MED1', mime_type: 'application/pdf', filename: 'faktura 5.pdf', caption: 'фактура' } },
      { from: '38970111222', id: 'wamid.a1', timestamp: '1763726401', type: 'audio', audio: { id: 'MED2', mime_type: 'audio/ogg' } },
    ] } }] }] }).messages;
    const K = await waKnown(db as never);
    const [id1, id2] = await Promise.all(m.map((x) => waRecordIn(db as never, x, waMatch(x.from, K))));
    const g = meta();
    const put: string[] = [];
    const sent: unknown[] = [];
    const store = { put: async (key: string) => { put.push(key); } };
    expect(await runWaMedia(db, id1!, { fetch: g.f as never, base: 'http://mock', store, send: async (n, d) => { sent.push([n, d]); } })).toBe('stored');
    expect(g.calls).toEqual(['http://mock/MED1 🔑', 'http://mock/dl/MED1 🔑']);
    expect(put[0]).toMatch(new RegExp(`^firms/${A}/`));
    const [msg] = await pg.select().from(schema.waMessages).where(eq(schema.waMessages.id, id1!));
    expect(msg!.fileId).toBeTruthy();
    const [doc] = await pg.select().from(schema.incomingDocs).where(eq(schema.incomingDocs.id, msg!.incomingDocId!));
    expect(doc).toMatchObject({ firmId: A, source: 'whatsapp', what: 'фактура', status: 'unread' });
    expect(sent).toEqual([['incoming.detect', { id: doc!.id }]]);
    // a second run does nothing; a voice message stays in the conversation only
    expect(await runWaMedia(db, id1!, { fetch: g.f as never, base: 'http://mock', store })).toBe('nothing');
    expect(await runWaMedia(db, id2!, { fetch: g.f as never, base: 'http://mock', store })).toBe('skipped');
  });
});
