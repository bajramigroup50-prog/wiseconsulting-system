import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, storeLawText, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { runLawCase } from './law-assist';
import { syncLawTexts } from './law-texts';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;

function fake(texts: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: texts.shift() ?? '{}', citations: null }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}

const V1 = `ЗАКОН ЗА ДАНОКОТ НА ДОДАДЕНА ВРЕДНОСТ
Настанување на даночна обврска
Член 14
(1) Даночната обврска настанува во моментот кога е извршен прометот.
(2) Ако надоместокот е платен пред извршување на прометот (аванс), даночната обврска настанува со наплатата на авансот.

Повластена стапка
Член 30
Повластената стапка на данокот е 5%.`;
const V2 = V1.replace('е 5%.', 'е 10%.');
let firmId = '';

async function newCase(v: Partial<typeof schema.lawCases.$inferInsert> & { kind: 'ask' | 'law' | 'ver' | 'treat'; question: string }) {
  const [c] = await pg.insert(schema.lawCases).values(v).returning();
  await runLawCase(db, c!.id, '2026-10-14');
  return (await pg.select().from(schema.lawCases).where(eq(schema.lawCases.id, c!.id)))[0]!;
}

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ 2024', text: V1, asOf: '2024-01-01' });
  await storeLawText(db, { law: 'zddv', title: 'ЗДДВ 30.12.2025', text: V2, asOf: '2025-12-30', effectiveFrom: '2026-01-01' });
  const [f] = await pg.insert(schema.firms).values({ name: 'Аванс ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  await pg.insert(schema.invoices).values({ firmId, kind: 'invoice', number: 'A-1', date: '2026-02-11', base: '500', vat: '0', total: '500', advance: true });
}, 60_000);
afterEach(() => setAiClient(null));

describe('law.case', () => {
  it('question: articles from the store, AI answer with the citation guard, model and cost saved', async () => {
    const api = fake([JSON.stringify({
      short: 'Да – ДДВ се пресметува при наплата на авансот.',
      reasoning: [
        { text: 'Обврската настанува со наплата на авансот.', cites: [{ law: 'zddv', art: '14', para: '2', quote: 'даночната обврска настанува со наплатата на авансот' }] },
        { text: 'Според чл. 88 се плаќа казна.', cites: [{ law: 'zddv', art: '88', para: null, quote: 'измислен' }] },
      ],
      exceptions: [], evidence: ['Авансна фактура со ДДВ'], verify: [], table: null, conclusion: 'Треба да се пресмета ДДВ.',
    })]);
    setAiClient(api);
    const c = await newCase({ kind: 'ask', question: 'Дали оваа фирма требаше да пресмета ДДВ на авансот?', firmId, periodFrom: '2026-01-01', periodTo: '2026-03-31' });
    expect(c.status).toBe('done');
    expect(c.model).toBe('claude-sonnet-5-5');
    expect(Number(c.costUsd)).toBeGreaterThan(0);
    const prompt = JSON.stringify(api.calls[0]!.messages);
    expect(prompt).toContain('[zddv|14]');
    expect(prompt).toContain('аванси: 1');
    const R = c.result as { ai: { reasoning: { cites: { art: string }[] }[]; verify: string[] }; guard: { removed: string[]; stray: string[] }; articles: { no: string; asOf: string }[] };
    expect(R.articles[0]).toMatchObject({ no: '14', asOf: '2025-12-30' });
    expect(R.ai.reasoning.flatMap((r) => r.cites.map((x) => x.art))).toEqual(['14']);
    expect(R.guard.removed).toEqual(['ЗДДВ чл. 88']);
    expect(R.ai.verify.join(' ')).toContain('треба да се провери: ЗДДВ чл. 88');
    const [u] = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, c.id));
    expect(u).toMatchObject({ purpose: 'lawAssist', firmId });
  });
  it('„🔍 Детално“ → Opus', async () => {
    setAiClient(fake(['{"short":"ok","reasoning":[],"exceptions":[],"evidence":[],"verify":[],"table":null,"conclusion":""}']));
    const c = await newCase({ kind: 'ask', question: 'ДДВ аванс', params: { deep: true } });
    expect(c.model).toBe('claude-opus-5-5');
  });
  it('version ↔ version is free: diff, dates, applicable version; no model call', async () => {
    const api = fake([]);
    setAiClient(api);
    const c = await newCase({ kind: 'ver', question: 'Стапка', params: { law: 'zddv', art: '30', date: '2025-06-30' } });
    expect(c.status).toBe('done');
    expect(api.calls).toHaveLength(0);
    const R = c.result as { table: { rows: string[][] }; versions: { asOf: string; textId: string }[]; applies: string };
    expect(R.table.rows).toEqual([['5%.', '10%.']]);
    expect(R.versions.map((v) => v.asOf)).toEqual(['2024-01-01', '2025-12-30']);
    expect(R.applies).toBe(R.versions[0]!.textId);
    expect(Number(c.costUsd)).toBe(0);
  });
  it('our treatment ↔ the law (free) and without an API key the question keeps the found articles', async () => {
    const t = await newCase({ kind: 'treat', question: 'ДДВ на аванси', firmId, periodFrom: '2026-01-01', periodTo: '2026-03-31' });
    expect(t.status).toBe('done');
    expect((t.result as { table: { rows: string[][] } }).table.rows.some((r) => r[3] === '⚠ аванс без ДДВ')).toBe(true);
    const q = await newCase({ kind: 'ask', question: 'Кога настанува даночна обврска за аванс?' });
    expect(q.status).toBe('done');
    expect(q.error).toMatch(/AI не е достапен/);
    expect((q.result as { articles: unknown[] }).articles.length).toBeGreaterThan(0);
    const bad = await newCase({ kind: 'ver', question: 'x', params: { law: 'zddv', art: '999' } });
    expect([bad.status, bad.error]).toEqual(['error', 'ЗДДВ чл. 999 го нема во базата.']);
  });
});

describe('law texts (robot step)', () => {
  it('finds the consolidated text on the official page, stores it with articles, skips an unchanged text', async () => {
    const LIST = '<a href="/mk/regulativa/opis/10">Закон за данокот на добивка (пречистен текст)</a><a href="/x">Друго</a>';
    const DESC = '<a href="/files/attachment/0000/1/zdd____15.03.2026.pdf">Преземи</a>';
    const DOC = '<html><body><p>ЗАКОН ЗА ДАНОКОТ НА ДОБИВКА</p><p>(„Службен весник“ бр. 112/2014)</p>' + '<p>Предмет</p><p>Член 1</p><p>Со овој закон се уредува данокот на добивка.</p>'.repeat(1) + '<p>Член 2</p><p>' + 'Даночен обврзник е секое правно лице. '.repeat(10) + '</p></body></html>';
    const fetcher = async (u: string) => (u.includes('/opis/10') ? DESC : LIST);
    const bin = async () => ({ bytes: new TextEncoder().encode(DOC), type: 'text/html' });
    const r = await syncLawTexts(db, { laws: ['zdd'], fetcher, bin, today: '2026-10-14' });
    expect(r).toMatchObject({ checked: 1, stored: 1, errors: [] });
    const [t] = await pg.select().from(schema.lawTexts).where(eq(schema.lawTexts.law, 'zdd'));
    expect(t).toMatchObject({ asOf: '2026-03-15', articles: 2, gazette: ['112/2014'], sourceUrl: 'https://www.ujp.gov.mk/files/attachment/0000/1/zdd____15.03.2026.pdf' });
    expect((await syncLawTexts(db, { laws: ['zdd'], fetcher, bin })).unchanged).toBe(1);
    const fail = await syncLawTexts(db, { laws: ['zdd'], fetcher: async () => '<p>нема линкови</p>', bin });
    expect(fail.errors).toEqual(['ЗДД: текстот не е најден на официјалната страница']);
    const [s] = await pg.select().from(schema.lawTextSync).where(eq(schema.lawTextSync.law, 'zdd'));
    expect(s!.error).toContain('не е најден');
  });
});
