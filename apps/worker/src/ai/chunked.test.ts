import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type AiDocKind, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from './client';
import { checkBank, checkOb, MAX_CHUNK_PAGES, mergeBank, mergeOb, planRead } from './chunked';
import { readTier } from './kinds';
import { OB_PROMPT } from './prompts';
import { TRUNCATED_MSG } from './read-document';
import { setObjectReader } from './storage';
import { aiReadDocument, freeAccepted, runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
let fileBytes: Uint8Array = new Uint8Array();

type Ans = string | { text: string; stop: 'max_tokens' | 'end_turn' } | ((c: Anthropic.MessageCreateParamsNonStreaming) => string);
function fake(answers: Ans[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      const a = answers.shift() ?? '{}';
      const { text, stop } = typeof a === 'function' ? { text: a(body), stop: 'end_turn' } : typeof a === 'string' ? { text: a, stop: 'end_turn' } : a;
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: stop, stop_sequence: null,
        content: [{ type: 'text', text, citations: null }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}
/** Pages of the PDF document block of a call. */
async function pagesOf(c: Anthropic.MessageCreateParamsNonStreaming): Promise<number> {
  const b = (c.messages[0]!.content as Anthropic.ContentBlockParam[]).find((x) => x.type === 'document') as Anthropic.DocumentBlockParam | undefined;
  if (!b) return 0;
  return (await PDFDocument.load(Buffer.from((b.source as { data: string }).data, 'base64'))).getPageCount();
}
const textOf = (c: Anthropic.MessageCreateParamsNonStreaming) => ((c.messages[0]!.content as Anthropic.ContentBlockParam[]).at(-1) as Anthropic.TextBlockParam).text;
async function blankPdf(n: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([595, 842]);
  return d.save();
}
async function doc(kind: AiDocKind, file: { name: string; mime: string }, options: Record<string, unknown> = {}) {
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + Math.random(), name: file.name, mime: file.mime, size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind, options }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const usage = async (id: string) => pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, id));

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await pg.execute(sql`select 1`);
  const [f] = await pg.insert(schema.firms).values({ name: 'Наша фирма', edb: '4030000000002' }).returning();
  firmId = f!.id;
  setObjectReader(async () => fileBytes);
}, 60_000);
afterEach(() => { setAiClient(null); });

describe('tier rule (cost): never Opus on its own', () => {
  it('complex kinds read with Sonnet; „🔍 Детално читање“ (deep) reads with Opus', () => {
    expect(readTier('complex', false)).toBe('default');
    expect(readTier('default', false)).toBe('default');
    expect(readTier('quick', false)).toBe('quick');
    expect(readTier('default', true)).toBe('complex');
    expect(readTier('quick', true)).toBe('complex');
  });
  it('ai.read-document is never retried by pg-boss (a repeat pays the same tokens again)', () => {
    expect(aiReadDocument.queue?.retryLimit).toBe(0);
  });
});

describe('read plan (size estimated before any call)', () => {
  it('a small document is one call; a 39-page scan goes in ranges of ≤ 6 pages covering every page', () => {
    expect(planRead('ob', 2, new Map()).ranges).toEqual([{ from: 1, to: 2 }]);
    const P = planRead('ob', 39, new Map());
    expect(P.ranges.length).toBeGreaterThan(1);
    expect(P.ranges[0]!.from).toBe(1);
    expect(P.ranges.at(-1)!.to).toBe(39);
    for (const [i, r] of P.ranges.entries()) {
      expect(r.to - r.from + 1).toBeLessThanOrEqual(MAX_CHUNK_PAGES);
      if (i) expect(r.from).toBe(P.ranges[i - 1]!.to + 1);
    }
  });
  it('the text layer decides: few rows per page fit more pages, a dense page is alone', () => {
    const sparse = new Map(Array.from({ length: 10 }, (_, i) => [i + 1, 5] as [number, number]));
    expect(planRead('ob', 10, sparse).ranges).toEqual([{ from: 1, to: 6 }, { from: 7, to: 10 }]);
    expect(planRead('ob', 3, new Map([[1, 5], [2, 400], [3, 5]])).ranges).toEqual([{ from: 1, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 3 }]);
  });
});

describe('merge + checks', () => {
  it('trial balance: rows concatenated (equal lines kept), carry-over lines dropped, totals per konto, grand from the last part', () => {
    const m = mergeOb([
      { rows: [['1200', 'Купувачи', 'А ДОО', '1', 100, 0], ['1200', 'Купувачи', 'Б ДОО', '2', 100, 0]], totals: [['12', 1, 1]], grand: [0, 0] },
      { rows: [['', '', 'Пренос', '', 200, 0], ['', '', 'В ДОО', '3', 50, 0], ['2200', 'Добавувачи', 'Г ДОО', '', 0, 250]], totals: [['12', 250, 0], ['22', 0, 250]], grand: [250, 250] },
    ]);
    expect(m.rows.map((r) => r[2])).toEqual(['А ДОО', 'Б ДОО', 'В ДОО', 'Г ДОО']);
    expect(m.totals).toEqual([['12', 250, 0], ['22', 0, 250]]);
    expect(m.grand).toEqual([250, 250]);
    expect(m.check).toMatchObject({ debit: 250, credit: 250, balanced: true, grandOk: true, warnings: [] });
    expect(m.chunks).toBe(2);
  });
  it('trial balance check: unbalanced / not equal to the printed total is warned', () => {
    const c = checkOb({ rows: [['1', '', '', '', 100, 0], ['2', '', '', '', 0, 90]], grand: [100, 100] });
    expect(c.balanced).toBe(false);
    expect(c.grandOk).toBe(false);
    expect(c.warnings).toHaveLength(2);
  });
  it('statement: opening from the first part, closing from the last, reconciled', () => {
    const b = mergeBank([
      { number: '12', account: '300000000000001', openingBalance: 1000, closingBalance: 0, items: [{ date: '2026-01-02', amount: 500 }] },
      { openingBalance: 0, closingBalance: 1300, totalDebit: 200, totalCredit: 500, items: [{ date: '2026-01-03', amount: -200 }] },
    ]);
    expect(b).toMatchObject({ number: '12', openingBalance: 1000, closingBalance: 1300, totalDebit: 200, balanced: true, warnings: [] });
    expect(b.items).toHaveLength(2);
    expect(checkBank({ openingBalance: 1000, closingBalance: 1400, items: [{ amount: 500 }, { amount: -200 }] }).balanced).toBe(false);
  });
  it('a free read is accepted (AI not called) only when it balances / reconciles', () => {
    expect(freeAccepted('ob', { rows: [['1200', '', 'А', '', 10, 0], ['2200', '', 'Б', '', 0, 10]], grand: [0, 0] })).toBe(true);
    expect(freeAccepted('ob', { rows: [['1200', '', 'А', '', 10, 0]], grand: [0, 0] })).toBe(false);
    expect(freeAccepted('ob', { rows: [], grand: [0, 0] })).toBe(false);
    expect(freeAccepted('bank', { balanced: true, items: [] })).toBe(true);
    expect(freeAccepted('bank', { balanced: true, warnings: ['x'] })).toBe(false);
    expect(freeAccepted('blg', { rows: [1] })).toBe(false);
  });
});

describe('ai.read-document: large trial balance (kind ob)', { timeout: 60_000 }, () => {
  it('a 39-page scan is read in parts with Sonnet, merged and checked; progress „дел i/n“', async () => {
    fileBytes = await blankPdf(39);
    let k = 0;
    const part = () => { k++; return JSON.stringify({ rows: [[String(1200 + k), 'Конто ' + k, 'Партнер ' + k, '', 100, 0], [String(2200 + k), '', 'Добавувач ' + k, '', 0, 100]], totals: [], grand: [0, 0] }); };
    const api = fake(Array.from({ length: 20 }, () => part));
    setAiClient(api);
    const id = await doc('ob', { name: 'bb.pdf', mime: 'application/pdf' });
    await runReadDocument(db, id);
    const d = await load(id);
    expect(d.status).toBe('done');
    const n = api.calls.length;
    expect(n).toBeGreaterThan(1);
    const P = await Promise.all(api.calls.map(pagesOf));
    expect(P.reduce((s, x) => s + x, 0)).toBe(39);
    expect(Math.max(...P)).toBeLessThanOrEqual(MAX_CHUNK_PAGES);
    expect(api.calls.every((c) => c.model === AI_MODELS.default)).toBe(true);
    expect(api.calls.every((c) => (c.max_tokens ?? 0) <= 16000)).toBe(true);
    expect(textOf(api.calls[1]!)).toContain(OB_PROMPT);
    expect(textOf(api.calls[1]!)).toContain(`PART 2 of ${n}`);
    const R = d.result as { rows: unknown[]; check: { balanced: boolean; debit: number }; chunks: number; warnings: string[] };
    expect(R.rows).toHaveLength(2 * n);
    expect(R.chunks).toBe(n);
    expect(R.check).toMatchObject({ balanced: true, debit: 100 * n });
    expect(R.warnings).toEqual([]);
    expect((d.options as { progress?: string }).progress).toBe(`дел ${n}/${n}`);
    expect((await usage(id)).every((u) => u.purpose === 'ob:chunk' && u.tier === 'default')).toBe(true);
  });

  it('„🔍 Детално читање“ (deep) uses Opus', async () => {
    fileBytes = await blankPdf(1);
    const api = fake([JSON.stringify({ rows: [], totals: [], grand: [0, 0] })]);
    setAiClient(api);
    const id = await doc('ob', { name: 'bb.pdf', mime: 'application/pdf' }, { deep: true });
    await runReadDocument(db, id);
    expect(api.calls.map((c) => c.model)).toEqual([AI_MODELS.complex]);
  });

  it('a cut answer is never repeated as it is: a 2-page PDF goes page by page, logged as truncated', async () => {
    fileBytes = await blankPdf(2);
    const ok = JSON.stringify({ rows: [['1200', '', 'А', '', 5, 0]], totals: [], grand: [0, 0] });
    const api = fake([{ text: '{"rows":[["1200","","А","",5,0],["12', stop: 'max_tokens' }, ok, ok]);
    setAiClient(api);
    const id = await doc('ob', { name: 'bb.pdf', mime: 'application/pdf' });
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(3);
    expect(await Promise.all(api.calls.map(pagesOf))).toEqual([2, 1, 1]);
    expect((await load(id)).status).toBe('done');
    expect((await usage(id)).map((u) => u.purpose)).toEqual(['ob:truncated', 'ob:chunk', 'ob:chunk']);
  });

  it('a cut answer of a photo fails at once with the clear message (one call, no retry)', async () => {
    fileBytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const api = fake([{ text: '{"rows":[["1200"', stop: 'max_tokens' }, '{}', '{}']);
    setAiClient(api);
    const id = await doc('ob', { name: 'bb.jpg', mime: 'image/jpeg' });
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(1);
    expect(await load(id)).toMatchObject({ status: 'error', error: TRUNCATED_MSG });
    expect((await usage(id)).map((u) => u.purpose)).toEqual(['ob:truncated']);
  });
});
