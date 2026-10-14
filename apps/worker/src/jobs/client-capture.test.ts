/**
 * „📷 Испрати документ“ photos → one PDF (`inbox.combine`, storage mocked) and the monthly client report's AI summary
 * (`client-report.summary`, fake model): only the report's numbers go to the model, `ai_usage` is written, and with the
 * monthly AI limit reached nothing is called.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildClientReport } from '@wise/core/office';
import { putAiBudget, schema, type DB, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { setObjectReader } from '../ai/storage';
import { imagesToPdf, runInboxCombine } from './inbox-combine';
import { runClientReportSummary } from './client-report-summary';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', userId = '';
const BYTES = new Map<string, Uint8Array>();
const stored: { key: string; body: Uint8Array; mime: string }[] = [];
const store = { async put(key: string, body: Uint8Array, mime: string) { stored.push({ key, body, mime }); BYTES.set(key, body); } };

/** A tiny valid PNG (1×1, or 2×1 for a landscape page). */
async function png(w = 1, h = 1): Promise<Uint8Array> {
  // minimal PNG: signature + IHDR + IDAT + IEND (8-bit grey)
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (t: string, data: number[]) => { const td = new Uint8Array([...t].map((c) => c.charCodeAt(0)).concat(data)); return [...u32(data.length), ...td, ...u32(crc(td))]; };
  const raw: number[] = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) raw.push(128); }
  // zlib stored block
  let a = 1, b = 0;
  for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
  const z = [0x78, 0x01, 1, raw.length & 255, raw.length >> 8, ~raw.length & 255, (~raw.length >> 8) & 255, ...raw, ...u32(((b << 16) | a) >>> 0)];
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', [...u32(w), ...u32(h), 8, 0, 0, 0, 0]), ...chunk('IDAT', z), ...chunk('IEND', [])]);
}

let seq = 0;
async function inboxWith(files: { mime: string; bytes: Uint8Array }[], docKind = 'in') {
  const [i] = await pg.insert(schema.inboxItems).values({ firmId, fromUserId: userId, fromName: 'Клиент', docKind, subject: '📷 Влезна фактура' }).returning();
  for (const f of files) {
    const key = `firms/${firmId}/k${++seq}`;
    BYTES.set(key, f.bytes);
    const [r] = await pg.insert(schema.files).values({ firmId, bucketKey: key, name: `p${seq}.${f.mime === 'application/pdf' ? 'pdf' : 'png'}`, mime: f.mime, size: f.bytes.length, sha256: 'x'.repeat(63) + (seq % 10), status: 'ready', uploadedBy: userId }).returning();
    await pg.insert(schema.fileLinks).values({ fileId: r!.id, entityType: 'inbox_item', entityId: i!.id });
  }
  return i!.id;
}
const linked = async (id: string) => pg.select({ name: schema.files.name, mime: schema.files.mime, by: schema.files.uploadedBy }).from(schema.fileLinks)
  .innerJoin(schema.files, eq(schema.files.id, schema.fileLinks.fileId)).where(and(eq(schema.fileLinks.entityType, 'inbox_item'), eq(schema.fileLinks.entityId, id)));

function fake(text: string): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text, citations: null }], usage: { input_tokens: 400, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Фото Трејд ДООЕЛ', edb: '4030999000111' }).returning();
  firmId = f!.id;
  const [u] = await pg.insert(schema.users).values({ username: 'klient-foto', name: 'Клиент', role: 'klient', passwordHash: 'x' }).returning();
  userId = u!.id;
  setObjectReader(async (k) => { const b = BYTES.get(k); if (!b) throw new Error('missing ' + k); return b; });
}, 60_000);
afterEach(() => { setAiClient(null); });

describe('inbox.combine — photos of one document → one PDF', () => {
  it('three photos become one 3-page PDF attached to the message instead of the photos', async () => {
    const id = await inboxWith([{ mime: 'image/png', bytes: await png() }, { mime: 'image/png', bytes: await png(2, 1) }, { mime: 'image/png', bytes: await png() }]);
    const r = await runInboxCombine(pg as unknown as DB, id, { store });
    expect(r.pages).toBe(3);
    const L = await linked(id);
    expect(L).toHaveLength(1);
    expect(L[0]!.mime).toBe('application/pdf');
    expect(L[0]!.name).toMatch(/^Vlezna_faktura_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(L[0]!.by).toBe(userId); // the client keeps access to it as their own upload
    const pdf = await PDFDocument.load(stored.at(-1)!.body);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getPage(1).getWidth()).toBeGreaterThan(pdf.getPage(1).getHeight()); // the landscape photo
    // idempotent: running again changes nothing
    expect((await runInboxCombine(pg as unknown as DB, id, { store })).fileId).toBeNull();
  });

  it('one photo, a PDF next to the photos or unreadable images stay as sent', async () => {
    const one = await inboxWith([{ mime: 'image/png', bytes: await png() }]);
    expect((await runInboxCombine(pg as unknown as DB, one, { store })).fileId).toBeNull();
    const mixed = await inboxWith([{ mime: 'image/png', bytes: await png() }, { mime: 'application/pdf', bytes: await imagesToPdf([{ mime: 'image/png', bytes: await png() }]) }]);
    expect((await runInboxCombine(pg as unknown as DB, mixed, { store })).fileId).toBeNull();
    const bad = await inboxWith([{ mime: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }, { mime: 'image/jpeg', bytes: new Uint8Array([4, 5]) }]);
    expect((await runInboxCombine(pg as unknown as DB, bad, { store })).fileId).toBeNull();
    expect(await linked(bad)).toHaveLength(2);
  });
});

describe('client-report.summary — AI from the numbers only, under the budget', () => {
  const data = buildClientReport({
    period: '2026-09',
    lines: [
      { account: '7400', debit: 0, credit: 120000, date: '2026-09-10' }, { account: '4100', debit: 50000, credit: 0, date: '2026-09-12' },
      { account: '7400', debit: 0, credit: 100000, date: '2026-08-10' }, { account: '1000', debit: 70000, credit: 0, date: '2026-09-30' },
    ],
    invoices: [{ remaining: 30000, date: '2026-06-01', due: '2026-06-15' }], purchases: [],
    vat: { period: '2026-Т3', amount: 18000, due: '2026-10-25', closed: false, partial: false },
  });
  const report = async (lang = 'mk') => {
    const [r] = await pg.insert(schema.clientReports).values({ firmId, period: `2026-${String(++seq % 12 + 1).padStart(2, '0')}`, data: data as never, lang, aiStatus: 'queued', createdBy: userId }).returning();
    return r!.id;
  };

  it('writes the summary in the client language and logs the cost in ai_usage', async () => {
    const api = fake('Во септември фирмата оствари добивка од 70.000 денари.');
    setAiClient(api);
    const id = await report('sq');
    await runClientReportSummary(db, id);
    const [r] = await pg.select().from(schema.clientReports).where(eq(schema.clientReports.id, id));
    expect(r!.aiStatus).toBe('done');
    expect(r!.summary).toContain('добивка');
    const prompt = String(api.calls[0]!.messages[0]!.content);
    expect(prompt).toContain('албански');
    expect(prompt).toContain('"revenue": 120000');
    expect(prompt).not.toContain('Фото Трејд'); // no firm name / ЕДБ / persons
    expect(prompt).not.toContain('4030999000111');
    const U = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, id));
    expect(U).toHaveLength(1);
    expect(U[0]!.purpose).toBe('clientReport');
    expect(U[0]!.firmId).toBe(firmId);
  });

  it('the monthly AI limit reached: no call, the report says AI is paused', async () => {
    await pg.insert(schema.aiUsage).values({ firmId, purpose: 'test', tier: 'quick', model: 'x', costUsd: '2' });
    await putAiBudget(db, { firms: { [firmId]: 1 } });
    const api = fake('—');
    setAiClient(api);
    const id = await report();
    await runClientReportSummary(db, id);
    const [r] = await pg.select().from(schema.clientReports).where(eq(schema.clientReports.id, id));
    expect(api.calls).toHaveLength(0);
    expect(r!.aiStatus).toBe('error');
    expect(r!.aiError).toMatch(/паузиран/);
    expect(r!.summary).toBeNull();
    expect(await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, id))).toHaveLength(0);
    await putAiBudget(db, { firms: {} });
  });

  it('only a queued report is read (a second click while it runs does nothing twice)', async () => {
    const api = fake('x');
    setAiClient(api);
    const id = await report();
    await pg.update(schema.clientReports).set({ aiStatus: 'done' }).where(eq(schema.clientReports.id, id));
    await runClientReportSummary(db, id);
    expect(api.calls).toHaveLength(0);
  });
});
