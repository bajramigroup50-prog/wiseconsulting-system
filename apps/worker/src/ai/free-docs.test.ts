/**
 * Free readers of МПИН declarations, fiscal reports and fiscal receipts on synthetic TEXT PDFs (./text-pdf.fixtures.ts):
 * read without AI when the sums check, AI (with the reason) otherwise; the `mpin.read` and `ai.read-document` jobs use
 * them first and make no AI call when they succeed.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FISK_DAILY, FISK_PERIODIC, MPIN_DECL, RECEIPT_FUEL, RECEIPT_SHOP } from '@wise/core/noai/free-docs.fixtures';
import { schema, type AiDocKind, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from './client';
import { freeDocRead, FREE_WHY } from './free-docs';
import { freeRead, NOAI_MODEL } from './free-read';
import { setObjectReader } from './storage';
import { linesToCells, textPdf, type Cell } from './text-pdf.fixtures';
import { runReadDocument } from '../jobs/ai-read-document';
import { runMpinRead } from '../jobs/mpin-read';

const PDF = { name: 'x.pdf', mime: 'application/pdf' };
const pdfOf = (L: readonly string[]) => textPdf(linesToCells(L));
const swap = (L: readonly string[], a: string, b: string) => L.map((s) => s.replace(a, b));

/** МПИН declaration laid out as a real table (header cells above the amount columns). */
function mpinPdf(o: { pio?: string } = {}): Uint8Array {
  const C: Cell[] = [];
  const put = (y: number, x: number, s: string) => C.push({ x, y, s });
  [MPIN_DECL[0]!, MPIN_DECL[1]!, ...MPIN_DECL.slice(2, 9)].forEach((s, i) => put(800 - i * 14, 30, s));
  const X = [170, 240, 310, 380, 450, 520];
  ['ПИО', 'Здравство', 'Дополнителен', 'Вработување', 'Стаж', 'Персонален'].forEach((s, i) => put(660, X[i]! - 10, s));
  ['', '', 'придонес 0,5%', 'невработеност', 'зголемено', 'данок'].forEach((s, i) => { if (s) put(650, X[i]! - 10, s); });
  const row = (y: number, label: string, V: string[]) => { put(y, 30, label); V.forEach((v, i) => put(y, X[i]! - 10, v)); };
  row(630, 'Бруто основица', ['100,000.00', '100,000.00', '100,000.00', '100,000.00', '0.00', '72,000.00']);
  row(616, 'Стапка', ['18.80%', '7.50%', '0.50%', '1.20%', '0.00%', '10.00%']);
  row(602, 'Месечен износ', [o.pio ?? '18,800.00', '7,500.00', '500.00', '1,200.00', '0.00', '7,200.00']);
  MPIN_DECL.slice(13).forEach((s, i) => put(580 - i * 14, 30, s.replace(/\s{2,}/g, ' ')));
  return textPdf(C);
}

describe('free readers on text PDFs', () => {
  it('МПИН PDF → MPIN_ASK shape without AI', async () => {
    const r = await freeDocRead('mpin', PDF, mpinPdf());
    expect(r.why).toBe('');
    expect(r.result).toMatchObject({ edb: '4030999123456', period: '2026-09', gross: 100000, pio: 18800, zdr: 7500, dop: 500, vrab: 1200, tax: 7200, total: 35200, insured: 3 });
  });
  it('МПИН with a column that does not check → no result, the reason', async () => {
    const r = await freeDocRead('mpin', PDF, mpinPdf({ pio: '18,300.00' }));
    expect(r.result).toBeNull();
    expect(r.why).toMatch(/≠/);
  });
  it('fiscal report PDF / TXT → normalised FiskRead (`noai`, note)', async () => {
    const r = await freeRead('fisk', PDF, pdfOf(FISK_PERIODIC)) as Record<string, unknown>;
    expect(r).toMatchObject({ noai: true, note: 'прочитано без AI – проверете', from: '2026-09-01', to: '2026-09-30', totals: { total: 135000, gross: { А: 118000 } } });
    const t = await freeRead('fisk', { name: 'z.txt', mime: 'text/plain' }, new TextEncoder().encode(FISK_DAILY.join('\r\n'))) as { days: unknown[] };
    expect(t.days).toHaveLength(2);
  });
  it('e-receipt PDF → BLG shape', async () => {
    const r = await freeRead('blg', PDF, pdfOf(RECEIPT_SHOP)) as { receipts: { total: number; items: unknown[] }[] };
    expect(r.receipts[0]).toMatchObject({ total: 290, vatAmount: 40.04, merchant: 'ТЕСТ МАРКЕТ ДООЕЛ' });
    expect(r.receipts[0]!.items).toHaveLength(2);
    expect(await freeRead('blg', PDF, pdfOf(RECEIPT_FUEL))).toMatchObject({ receipts: [{ category: 'fuel', liters: 45.5 }] });
  });
  it('photos and scans stay with AI', async () => {
    expect(await freeDocRead('blg', { name: 'r.jpg', mime: 'image/jpeg' }, new Uint8Array([1]))).toEqual({ result: null, why: FREE_WHY.image });
    expect(await freeDocRead('fisk', PDF, new TextEncoder().encode('%PDF-1.4 fake'))).toEqual({ result: null, why: FREE_WHY.scan });
  });
});

// ── the jobs ─────────────────────────────────────────────────────────────────────────────────────────────────────
const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
let bytes: Uint8Array = new Uint8Array();

function fake(answers: string[]): MessagesApi & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answers.shift() ?? '{}', citations: null }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
async function file(name: string, mime: string, firm: string | null) {
  const [f] = await pg.insert(schema.files).values({ firmId: firm, bucketKey: 'k/' + Math.random(), name, mime, size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  return f!.id;
}
async function doc(kind: AiDocKind, name: string, mime: string) {
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: await file(name, mime, firmId), kind, options: {} }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Тест Трејд ДООЕЛ', edb: '4030999123456' }).returning();
  firmId = f!.id;
  setObjectReader(async () => bytes);
}, 60_000);
afterEach(() => { setAiClient(null); });

describe('jobs: free first, AI only when needed', () => {
  it('mpin.read: text PDF read without AI, firm matched, marked „без AI“', async () => {
    const api = fake([]);
    setAiClient(api);
    bytes = mpinPdf();
    const [r] = await pg.insert(schema.mpinInbox).values({ fileId: await file('mpin.pdf', 'application/pdf', null), name: 'mpin.pdf' }).returning();
    await runMpinRead(db, r!.id);
    const [x] = await pg.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, r!.id));
    expect(api.calls).toHaveLength(0);
    expect(x).toMatchObject({ status: 'ok', model: NOAI_MODEL, firmId });
    expect(x!.result).toMatchObject({ period: '2026-09', gross: 100000, net: 64800, diff: 0, how: 'PDF · прочитано без AI – проверете' });
  });
  it('mpin.read: sums do not check → AI reads it', async () => {
    const api = fake([JSON.stringify({ isMpin: true, edb: '4030999123456', period: '09/2026', gross: 100000, pio: 18800, zdr: 7500, tax: 7200 })]);
    setAiClient(api);
    bytes = mpinPdf({ pio: '18,300.00' });
    const [r] = await pg.insert(schema.mpinInbox).values({ fileId: await file('mpin.pdf', 'application/pdf', null), name: 'mpin.pdf' }).returning();
    await runMpinRead(db, r!.id);
    expect(api.calls).toHaveLength(1);
    expect((await pg.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, r!.id)))[0]).toMatchObject({ status: 'ok', model: expect.not.stringMatching(NOAI_MODEL) });
  });
  it('fisk / blg with AI available: the free reader first, no AI call', async () => {
    for (const [kind, L] of [['fisk', FISK_PERIODIC], ['blg', RECEIPT_SHOP]] as const) {
      const api = fake([]);
      setAiClient(api);
      bytes = pdfOf(L);
      const id = await doc(kind, 'd.pdf', 'application/pdf');
      await runReadDocument(db, id);
      expect(api.calls).toHaveLength(0);
      expect(await load(id)).toMatchObject({ status: 'done', model: NOAI_MODEL, result: { noai: true } });
    }
  });
  it('fisk whose groups do not add up → AI, the reason kept on the result', async () => {
    const api = fake([JSON.stringify({ days: [], totals: { gross: { А: 118000 }, total: 118000 }, to: '2026-09-30' })]);
    setAiClient(api);
    bytes = pdfOf(swap(FISK_PERIODIC, 'ПРОМЕТ Г            1 000.00', 'ПРОМЕТ Г            1 100.00'));
    const id = await doc('fisk', 'z.pdf', 'application/pdf');
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(1);
    expect((await load(id)).result).toMatchObject({ noaiWhy: expect.stringMatching(/Σ групи/) });
  });
});
