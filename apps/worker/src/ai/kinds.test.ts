import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type AiDocKind, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from './client';
import { BANK_PROMPT, BLG_PROMPT, BOM_PROMPT, CLASSIFY_PROMPT, EMP_PROMPT, FISK_PROMPT, FK_SIMPLE } from './prompts';
import { setObjectReader } from './storage';
import { runReadDocument } from '../jobs/ai-read-document';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';

function fake(answers: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answers.shift() ?? '{}', citations: null }],
        usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}
const promptOf = (c: Anthropic.MessageCreateParamsNonStreaming) => {
  const b = (c.messages[0]!.content as Anthropic.ContentBlockParam[]).at(-1) as Anthropic.TextBlockParam;
  return b.text;
};

async function doc(kind: AiDocKind, file: { name: string; mime: string } | null, options: Record<string, unknown> = {}) {
  let fileId: string | null = null;
  if (file) {
    const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + Math.random(), name: file.name, mime: file.mime, size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
    fileId = f!.id;
  }
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId, kind, options }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const usage = async (id: string) => pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, id));

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  // `bom` reads no file: file_id is nullable in the schema (the coordinator's migration); no-op once it is.
  await pg.execute(sql`alter table ai_documents alter column file_id drop not null`);
  const [f] = await pg.insert(schema.firms).values({ name: 'Наша фирма', edb: '4030000000001' }).returning();
  firmId = f!.id;
  setObjectReader(async () => new TextEncoder().encode('%PDF-1.4 fake'));
}, 60_000);
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('legacy inline prompts are verbatim', () => {
  const L = readFileSync(fileURLToPath(new URL('../../../../legacy/index.html', import.meta.url)), 'utf8');
  const between = (a: string, b: string) => { const i = L.indexOf(a) + a.length; return L.slice(i, L.indexOf(b, i)); };
  it('bank, fiscal, classify, BOM', () => {
    expect(BANK_PROMPT).toBe(between("S.sample.json('This is a bank statement", "'+inp.extra").replace(/^/, 'This is a bank statement'));
    expect(FISK_PROMPT).toBe(between("const FISK_PROMPT='", "';"));
    expect(FK_SIMPLE).toBe(between("const FK_SIMPLE='", "';"));
    expect(CLASSIFY_PROMPT).toBe(between("irClassify=async function(file){const inp=await aiInput(file);const r=await sampleDoc('", "',inp,{})"));
    const tpl = between('const r=await S.sample.json(`You are a production technologist', '`);').replace(/^/, 'You are a production technologist');
    const p = { name: 'Леб', unit: 'ком' }, M = [{ name: 'Брашно', unit: 'кг' }, { name: 'Квасец', unit: '' }];
    const expected = tpl.replace('${p.name}', p.name).replace("${p.unit||'ком'}", p.unit).replace("${p.unit||'unit'}", p.unit)
      .replace("${M.map(i=>'- '+i.name+' ['+(i.unit||'')+']').join('\\n')}", M.map((i) => '- ' + i.name + ' [' + (i.unit || '') + ']').join('\n')).replace(/\\n/g, '\n');
    expect(BOM_PROMPT(p, M)).toBe(expected);
    expect(BOM_PROMPT({ name: 'X' }, [])).toContain('(unit: ком)');
  });
});

describe('ai.read-document result kinds', () => {
  it('no API key → friendly error on the row', async () => {
    const id = await doc('blg', { name: 'r.jpg', mime: 'image/jpeg' });
    await runReadDocument(db, id);
    expect(await load(id)).toMatchObject({ status: 'error' });
    expect((await load(id)).error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('blg: BLG_PROMPT, default tier for a photo, raw receipts stored, usage logged', async () => {
    const api = fake(['```json\n{"receipts":[{"country":"MK","total":"1.100,00","category":"fuel"}]}\n```']);
    setAiClient(api);
    const id = await doc('blg', { name: 'r.jpg', mime: 'image/jpeg' });
    await runReadDocument(db, id);
    expect(promptOf(api.calls[0]!)).toBe(BLG_PROMPT);
    expect(api.calls[0]!.model).toBe(AI_MODELS.default);
    expect(await load(id)).toMatchObject({ status: 'done', drafts: [], model: AI_MODELS.default, result: { receipts: [{ country: 'MK', total: '1.100,00' }] } });
    expect(await usage(id)).toMatchObject([{ firmId, purpose: 'blg', tier: 'default' }]);
  });

  it('blg PDF → quick tier; emp, bank and classify use their prompts', async () => {
    for (const [kind, prompt, tier, ans] of [
      ['blg', BLG_PROMPT, 'quick', '{"receipts":[]}'],
      ['emp', EMP_PROMPT, 'default', '{"name":"Ана","embg":"0101990455001"}'],
      ['bank', BANK_PROMPT, 'default', '{"items":[{"date":"2026-03-02","amount":5}]}'],
      ['classify', CLASSIFY_PROMPT, 'default', '{"kind":"fiscal","what":"Z извештај"}'],
    ] as const) {
      const api = fake([ans]);
      setAiClient(api);
      const id = await doc(kind, { name: 'd.pdf', mime: 'application/pdf' });
      await runReadDocument(db, id);
      expect(promptOf(api.calls[0]!)).toBe(prompt);
      expect(api.calls[0]!.model).toBe(AI_MODELS[tier]);
      expect(await load(id)).toMatchObject({ status: 'done', result: JSON.parse(ans) });
      expect(await usage(id)).toMatchObject([{ purpose: kind, tier }]);
    }
  });

  it('fisk: complex read, FK_SIMPLE second read when the total is 0, normalised result stored', async () => {
    const api = fake([
      JSON.stringify({ device: 'AC1', days: [], totals: { gross: {}, total: 0 }, text: '' }),
      JSON.stringify({ total: '12 345.00', group: 'A', vatTotal: 1883.14, to: '31-03-2026', receipts: 10 }),
    ]);
    setAiClient(api);
    const id = await doc('fisk', { name: 'z.jpg', mime: 'image/jpeg' });
    await runReadDocument(db, id);
    expect(api.calls.map(promptOf)).toEqual([FISK_PROMPT, FK_SIMPLE]);
    expect(api.calls.map((c) => c.model)).toEqual([AI_MODELS.complex, AI_MODELS.complex]);
    const d = await load(id);
    expect(d.status).toBe('done');
    expect(d.result).toMatchObject({ to: '31-03-2026', totals: { total: 12345, gross: { А: 12345 }, cash: 12345, receipts: 10 } });
    expect(await usage(id)).toHaveLength(2);
  });

  it('fisk: one read is enough when the total is read', async () => {
    const api = fake([JSON.stringify({ days: [{ date: '2026-03-01', z: '1', gross: { А: 118 }, vat: { А: 18 }, total: 118 }] })]);
    setAiClient(api);
    const id = await doc('fisk', { name: 'z.pdf', mime: 'application/pdf' });
    await runReadDocument(db, id);
    expect(api.calls).toHaveLength(1);
    expect((await load(id)).result).toMatchObject({ days: [{ total: 118, cash: 118 }] });
  });

  it('bom: no file, prompt built from the firm materials', async () => {
    const [p, m1] = await pg.insert(schema.items).values([
      { firmId, name: 'Леб', type: 'product', unit: 'ком' },
      { firmId, name: 'Брашно', type: 'material', unit: 'кг' },
      { firmId, name: 'Стара сол', type: 'material', unit: 'кг', active: false },
    ]).returning();
    const api = fake([JSON.stringify({ lines: [{ name: 'Брашно', qty: 0.5 }], missing: [], note: 'ок' })]);
    setAiClient(api);
    const id = await doc('bom', null, { productId: p!.id });
    await runReadDocument(db, id);
    expect(api.calls[0]!.messages[0]!.content).toEqual([{ type: 'text', text: BOM_PROMPT({ name: 'Леб', unit: 'ком' }, [{ name: m1!.name, unit: 'кг' }]) }]);
    expect(await load(id)).toMatchObject({ status: 'done', fileId: null, result: { lines: [{ name: 'Брашно', qty: 0.5 }] } });
    expect(await usage(id)).toMatchObject([{ purpose: 'bom' }]);

    const bad = await doc('bom', null, { productId: '00000000-0000-0000-0000-000000000000' });
    await runReadDocument(db, bad);
    expect(await load(bad)).toMatchObject({ status: 'error', error: 'Производот не е пронајден.' });
  });
});
