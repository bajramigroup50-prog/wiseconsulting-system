import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ublXml } from '@wise/core/sales';
import { schema, type Tx } from '@wise/db';
import { AI_MODELS, costUsd, setAiClient, type MessagesApi } from './client';
import { BLG_PROMPT, EMP_PROMPT, IMP_PROMPT, PUR_PROMPT, SALE_PROMPT, SCR_PROMPT } from './prompts';
import { parseModelJson, readDocument } from './read-document';
import { setObjectReader } from './storage';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', supId = '';

/** Fake SDK: answers queued texts, records the requests. */
function fake(answers: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      const text = answers.shift() ?? '{}';
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text, citations: null }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}

async function file(name: string, mime: string): Promise<string> {
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + name + Math.random(), name, mime, size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  return f!.id;
}
async function doc(kind: 'purchase' | 'sale', fileId: string): Promise<string> {
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId, kind }).returning();
  return d!.id;
}

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Наша фирма', edb: '4030000000001' }).returning();
  firmId = f!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Добавувач ДОО', edb: '4030999000111' }).returning();
  supId = p!.id;
  setObjectReader(async () => new TextEncoder().encode('%PDF-1.4 fake'));
}, 60_000);
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('prompts are verbatim legacy', () => {
  const legacy = readFileSync(fileURLToPath(new URL('../../../../legacy/index.html', import.meta.url)), 'utf8');
  const tpl = (name: string) => {
    const m = new RegExp('const ' + name + '=(?:\\(\\)=>(?:\\{[^`]*?return )?)?`([\\s\\S]*?)`').exec(legacy);
    if (!m) throw new Error('not found ' + name);
    return m[1]!;
  };
  it('static prompts', () => {
    expect(PUR_PROMPT).toBe(tpl('PUR_PROMPT'));
    expect(IMP_PROMPT).toBe(tpl('IMP_PROMPT'));
    expect(EMP_PROMPT).toBe(tpl('EMP_PROMPT'));
    expect(BLG_PROMPT).toBe(tpl('BLG_PROMPT'));
  });
  it('firm-dependent prompts', () => {
    const f = { name: 'X', edb: '1' };
    expect(SALE_PROMPT(f)).toBe(tpl('SALE_PROMPT').replace("${(firm()||{}).name||''}", 'X').replace("${(firm()||{}).edb||''}", '1'));
    expect(SCR_PROMPT(f)).toBe(tpl('SCR_PROMPT').replace("${f.name||''}", 'X').replace("${f.edb||'?'}", '1'));
  });
});

describe('readDocument', () => {
  it('sends the PDF as a document block, parses fenced JSON and logs the cost per firm', async () => {
    const api = fake(['Ето:\n```json\n{"number":"7"}\n```']);
    setAiClient(api);
    const fid = await file('a.pdf', 'application/pdf');
    const r = await readDocument<{ number: string }>({ db, firmId, fileId: fid, prompt: 'P', tier: 'quick', purpose: 'test', refId: 'r1', schema: (x) => x as { number: string } });
    expect(r.data.number).toBe('7');
    expect(api.calls[0]!.model).toBe(AI_MODELS.quick);
    const c = api.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(c[0]!.type).toBe('document');
    expect(c[1]).toMatchObject({ type: 'text', text: 'P' });
    const [u] = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, 'r1'));
    expect(u).toMatchObject({ firmId, purpose: 'test', tier: 'quick', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 200 });
    expect(Number(u!.costUsd)).toBeCloseTo(costUsd('claude-haiku-5-5', { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }), 6);
    expect(() => parseModelJson('no json here')).toThrow(/прочитан/);
  });
});

describe('ai.read-document job', () => {
  it('fails gracefully without ANTHROPIC_API_KEY', async () => {
    const id = await doc('purchase', await file('b.pdf', 'application/pdf'));
    await runReadDocument(db, id);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id));
    expect(d!.status).toBe('error');
    expect(d!.error).toMatch(/ANTHROPIC_API_KEY/);
  });
  it('quick read inconsistent → deeper read; drafts matched to the supplier', async () => {
    const bad = JSON.stringify({ supplierName: 'Добавувач', supplierEdb: '4030999000111', number: 'F-1', date: '2026-02-01', groups: [{ rate: 18, base: 100, vat: 18, kind: 'service' }], total: 500 });
    const good = JSON.stringify({ supplierName: 'Добавувач', supplierEdb: '4030999000111', buyerEdb: '4030000000001', number: 'F-1', date: '2026-02-01', groups: [{ rate: 18, base: 100, vat: 18, kind: 'service' }], total: 118 });
    const api = fake([bad, good]);
    setAiClient(api);
    const id = await doc('purchase', await file('c.pdf', 'application/pdf'));
    await runReadDocument(db, id);
    expect(api.calls.map((c) => c.model)).toEqual([AI_MODELS.quick, AI_MODELS.default]);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id));
    expect(d!.status).toBe('done');
    expect(d!.drafts).toHaveLength(1);
    expect(d!.drafts[0]).toMatchObject({ status: 'ok', draft: { partnerId: supId, number: 'F-1', groups: [{ konto: '4000', base: 100, vat: 18, rate: 18 }] } });
  });
  it('several invoices in one PDF give one draft each; owner check flags another firm', async () => {
    const two = JSON.stringify({ invoices: [
      { supplierName: 'A', number: '1', date: '2026-02-01', buyerEdb: '4030000000777', groups: [{ rate: 18, base: 10, vat: 1.8, kind: 'goods' }], total: 11.8 },
      { supplierName: 'B', number: '2', date: '2026-02-02', groups: [{ rate: 5, base: 20, vat: 1, kind: 'goods' }], total: 21 },
    ] });
    setAiClient(fake([two]));
    const id = await doc('purchase', await file('d.pdf', 'application/pdf'));
    await runReadDocument(db, id);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id));
    expect(d!.drafts.map((x) => x.status)).toEqual(['check', 'ok']);
    expect(d!.drafts[0]!.msg).toMatch(/друга фирма/);
  });
  it('UBL XML is imported without calling the model', async () => {
    const xml = ublXml({ number: 'U-5', date: '2026-02-03', items: [{ name: 'X', qty: 1, price: 100, rate: 18 }] }, { name: 'Добавувач ДОО', edb: '4030999000111' }, { name: 'Наша фирма', edb: '4030000000001' });
    setObjectReader(async () => new TextEncoder().encode(xml));
    const api = fake([]);
    setAiClient(api);
    const id = await doc('purchase', await file('e.xml', 'application/xml'));
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(0);
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id));
    expect(d).toMatchObject({ status: 'done', model: 'ubl' });
    expect(d!.drafts[0]!.draft).toMatchObject({ number: 'U-5', partnerId: supId });
    setObjectReader(async () => new TextEncoder().encode('%PDF-1.4 fake'));
  });
  it('sales scans build invoice drafts with SALE_PROMPT', async () => {
    const api = fake([JSON.stringify({ number: '33/2026', date: '2026-02-05', buyerName: 'Нов купувач', buyerEdb: '4030111000222', lines: [{ name: 'Услуга', qty: 1, price: 1000, amount: 1000, rate: 18 }], total: 1180 })]);
    setAiClient(api);
    const id = await doc('sale', await file('f.jpg', 'image/jpeg'));
    await runReadDocument(db, id);
    expect((api.calls[0]!.messages[0]!.content as Anthropic.ContentBlockParam[])[0]!.type).toBe('image');
    expect(JSON.stringify(api.calls[0]!.messages[0]!.content)).toContain('ISSUED BY the company \\"Наша фирма\\"');
    const [d] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id));
    expect(d!.drafts[0]).toMatchObject({ status: 'ok', msg: 'нов купувач: Нов купувач', draft: { number: '33/2026', items: [{ price: 1000, konto: '7400' }] } });
  });
});
