/**
 * Reads when AI is not usable: provider errors → clear message + code, credit / key failures remembered office-wide,
 * AI switched off in Систем → the free readers (text PDF / XML / CSV), retry → AI again.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_ERR_MSG } from '@wise/core/ai/errors';
import { statementFromRead } from '@wise/core/ai/bank';
import { getAiSettings, schema, setAiEnabled, type AiDocKind, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from './client';
import { setObjectReader } from './storage';
import { pdfTextItems } from './pdf-text';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
const bytes = new Map<string, Uint8Array>();

const CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
function failing(status: number, message: string): MessagesApi & { n: number } {
  const api = { n: 0, async create(): Promise<Anthropic.Message> { api.n++; throw Object.assign(new Error(message), { status }); } };
  return api;
}
function answering(text: string): MessagesApi & { n: number } {
  const api = {
    n: 0,
    async create(body: Anthropic.MessageCreateParamsNonStreaming) {
      api.n++;
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text, citations: null }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
  return api;
}

/** A bank statement PDF with a text layer (Latin headings: the standard fonts have no Cyrillic). */
async function statementPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  const f = await d.embedFont(StandardFonts.Helvetica);
  const row = (y: number, cells: [number, string][]) => cells.forEach(([x, s]) => p.drawText(s, { x, y, size: 9, font: f }));
  row(800, [[40, 'Statement no. 12/2026']]);
  row(780, [[40, 'Date'], [120, 'Partner'], [300, 'Purpose'], [430, 'Debit'], [500, 'Credit']]);
  row(766, [[40, '02.03.2026'], [120, 'ALFA DOOEL'], [300, 'Invoice 12'], [500, '12.500,00']]);
  row(752, [[40, '03.03.2026'], [120, 'T-Mobile'], [300, 'Phone'], [430, '1.234,56']]);
  return d.save();
}

async function doc(kind: AiDocKind, name: string, mime: string, body: Uint8Array, options: Record<string, unknown> = {}) {
  const key = 'k/' + Math.random();
  bytes.set(key, body);
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: key, name, mime, size: body.length, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind, options }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const IMG = new Uint8Array([0xff, 0xd8, 0xff]);

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Наша фирма', edb: '4030000000001' }).returning();
  firmId = f!.id;
  setObjectReader(async (k) => bytes.get(k) ?? new Uint8Array());
}, 60_000);
beforeEach(async () => { await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'ai')); });
afterEach(() => { setAiClient(null); });

describe('PDF text layer', () => {
  it('pdfjs gives positioned items', async () => {
    const it0 = await pdfTextItems(await statementPdf());
    expect(it0.find((x) => x.s === 'ALFA DOOEL')).toMatchObject({ page: 1, x: 120, y: 766 });
  });
});

describe('provider errors', () => {
  it('credit exhausted: clear message + code on the row, failure remembered, statement read without AI', async () => {
    setAiClient(failing(400, CREDIT));
    const img = await doc('blg', 'r.jpg', 'image/jpeg', IMG);
    await runReadDocument(db, img);
    const d = await load(img);
    expect(d).toMatchObject({ status: 'error', error: AI_ERR_MSG.credit });
    expect(d.options).toMatchObject({ errCode: 'credit' });
    expect(String((d.options as { errDetail?: string }).errDetail)).toMatch(/credit balance is too low/);
    expect((await getAiSettings(db)).lastFail).toMatchObject({ code: 'credit' });

    // the next read does not call AI (blocked) — a text PDF statement is read by the free reader
    const api = answering('{}');
    setAiClient(api);
    const st = await doc('bank', 'izvod.pdf', 'application/pdf', await statementPdf());
    await runReadDocument(db, st);
    const s = await load(st);
    expect(api.n).toBe(0);
    expect(s).toMatchObject({ status: 'done', model: 'noai' });
    expect(statementFromRead(s.result)!.lines.map((l) => [l.date, l.amount])).toEqual([['2026-03-02', 1250000], ['2026-03-03', -123456]]);
  });

  it('„↻ Повторно“ (retry) calls AI again and a success clears the failure', async () => {
    setAiClient(failing(400, CREDIT));
    await runReadDocument(db, await doc('blg', 'a.jpg', 'image/jpeg', IMG));
    const api = answering('{"receipts":[]}');
    setAiClient(api);
    const id = await doc('blg', 'b.jpg', 'image/jpeg', IMG, { retry: true });
    await runReadDocument(db, id);
    expect(api.n).toBe(1);
    expect(await load(id)).toMatchObject({ status: 'done' });
    expect((await getAiSettings(db)).lastFail).toBeNull();
  });

  it('rate limit / overload are not remembered; the message says to retry', async () => {
    setAiClient(failing(529, '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'));
    const id = await doc('emp', 'e.jpg', 'image/jpeg', IMG);
    await runReadDocument(db, id);
    expect(await load(id)).toMatchObject({ status: 'error', error: AI_ERR_MSG.overloaded });
    expect((await getAiSettings(db)).lastFail).toBeNull();
  });

  it('purchase invoice: key refused → message with the free paths', async () => {
    setAiClient(failing(401, '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'));
    const id = await doc('purchase', 'f.jpg', 'image/jpeg', IMG);
    await runReadDocument(db, id);
    expect(await load(id)).toMatchObject({ status: 'error', error: AI_ERR_MSG.auth });
  });
});

describe('bank statement PDF whose balances reconcile', () => {
  it('is read exactly from the text layer even with AI on (no tokens); without balances AI reads it', async () => {
    const api = answering('{"items":[]}');
    setAiClient(api);
    const halk = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../web/test/import/fixtures/halk.pdf', import.meta.url))));
    const id = await doc('bank', 'halk.pdf', 'application/pdf', halk);
    await runReadDocument(db, id);
    const d = await load(id);
    expect(api.n).toBe(0);
    expect(d).toMatchObject({ status: 'done', model: 'noai' });
    expect(statementFromRead(d.result)!.lines).toHaveLength(7);
    const id2 = await doc('bank', 'izvod.pdf', 'application/pdf', await statementPdf());
    await runReadDocument(db, id2);
    expect(api.n).toBe(1);
  });
});

describe('AI switched off (Систем › AI читање)', () => {
  it('no AI call: text PDF / CSV statements are read, a photo gets the „off“ message', async () => {
    await setAiEnabled(db, false, null);
    const api = answering('{}');
    setAiClient(api);
    const a = await doc('bank', 'izvod.pdf', 'application/pdf', await statementPdf());
    await runReadDocument(db, a);
    expect(await load(a)).toMatchObject({ status: 'done', model: 'noai' });
    const csv = new TextEncoder().encode('Датум;Опис;Прилив;Одлив\n02.03.2026;Уплата;100,00;\n');
    const b = await doc('bank', 'izvod.csv', 'text/csv', csv);
    await runReadDocument(db, b);
    expect(statementFromRead((await load(b)).result)!.lines[0]).toMatchObject({ amount: 10000 });
    const c = await doc('bank', 'izvod.jpg', 'image/jpeg', IMG);
    await runReadDocument(db, c);
    expect(await load(c)).toMatchObject({ status: 'error', error: AI_ERR_MSG.off });
    expect((await load(c)).options).toMatchObject({ errCode: 'off' });
    expect(api.n).toBe(0);
    await setAiEnabled(db, true, null);
  });
});
