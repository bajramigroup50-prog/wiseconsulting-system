/**
 * firm-report.ai — „💲 AI анализа“ of the owner's full firm report: the model gets only numbers and findings (no firm /
 * partner / employee / colleague name, no ЕДБ / ЕМБС / address), the answer's unknown articles are tagged, the call is
 * logged in ai_usage, and a paused AI budget means no call at all.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeFirmReport, firmReportAiState, postJournal, putAiBudget, queueFirmReportAi, schema, seedReference, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from '../ai/client';
import { runFirmReportAi } from './firm-report-ai';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', userId = '';
const TODAY = '2026-10-14';

function fake(texts: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: texts.shift() ?? '', citations: null }], usage: { input_tokens: 5_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const ANSWER = '1) Општа оценка: фирмата има добивка.\n2) Ризици: ДДВ-04 не е поднесена (чл. 41 ЗДДВ), а според чл. 777 ЗДДВ има казна.\n3) Веднаш: да се поднесе ДДВ-04.';

const queue = async () => {
  const R = (await computeFirmReport(db, { firmId, year: 2026, today: TODAY, owner: true, userId }))!;
  return queueFirmReportAi(db, R, userId);
};

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
  const [f] = await pg.insert(schema.firms).values({ name: 'Тајна Фирма ДООЕЛ', edb: '4030000000099', embs: '7123456', address: 'Скриена 9', city: 'Скопје', vatRegistered: true }).returning();
  firmId = f!.id;
  const [u] = await pg.insert(schema.users).values({ username: 'own', name: 'Сопственик Тестовски', passwordHash: 'x', role: 'admin' }).returning();
  userId = u!.id;
  const [p] = await pg.insert(schema.partners).values({ firmId, name: 'Купувач Тајновски ДОО', code: '001', edb: '4030999000077' }).returning();
  await pg.insert(schema.employees).values({ firmId, name: 'Марија Вработена', active: true });
  await pg.transaction((tx) => postJournal(tx, { firmId, date: '2026-03-10', kind: 'manual', lines: [{ account: '1200', debit: 1000, partnerId: p!.id }, { account: '7400', credit: 1000 }], userId: null }));
}, 120_000);
beforeEach(async () => {
  await pg.delete(schema.aiUsage);
  await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'aiBudget'));
});
afterEach(() => setAiClient(null));

describe('firm-report.ai', () => {
  it('sends only numbers and findings, stores the checked answer, logs ai_usage', async () => {
    const api = fake([ANSWER]);
    setAiClient(api);
    const s = await queue();
    expect(await runFirmReportAi(db, { firmId, year: 2026, reqId: s.reqId })).toBe(true);
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.model).toBe(AI_MODELS.default);
    const prompt = JSON.stringify(api.calls[0]!.messages[0]!.content);
    for (const x of ['Тајна Фирма', '4030000000099', '7123456', 'Скриена 9', 'Купувач Тајновски', '4030999000077', 'Марија Вработена', 'Сопственик Тестовски']) expect(prompt, x).not.toContain(x);
    expect(prompt).toContain('\\"revenue\\":1000');
    const st = (await firmReportAiState(db, firmId, 2026))!;
    expect(st).toMatchObject({ status: 'done', model: AI_MODELS.default });
    expect(st.payload).toBeUndefined();
    expect(st.text).toContain('чл. 777 ЗДДВ [треба да се провери]');
    expect(st.text).not.toContain('чл. 41 ЗДДВ [треба');
    expect(st.unverified).toEqual(['чл. 777 ЗДДВ']);
    const [use] = await pg.select().from(schema.aiUsage);
    expect(use).toMatchObject({ purpose: 'firmReport', firmId, refId: firmId });
  });

  it('budget paused: no call, the report shows the error', async () => {
    await putAiBudget(db, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: AI_MODELS.default, costUsd: '1.000000' });
    const api = fake([ANSWER]);
    setAiClient(api);
    const s = await queue();
    expect(await runFirmReportAi(db, { firmId, year: 2026, reqId: s.reqId })).toBe(false);
    expect(api.calls).toHaveLength(0);
    expect(await firmReportAiState(db, firmId, 2026)).toMatchObject({ status: 'error', error: expect.stringMatching(/паузиран/) });
  });

  it('a request replaced by a newer one is ignored', async () => {
    const api = fake([ANSWER, ANSWER]);
    setAiClient(api);
    const old = await queue();
    const now = await queue();
    expect(await runFirmReportAi(db, { firmId, year: 2026, reqId: old.reqId })).toBe(false);
    expect(api.calls).toHaveLength(0);
    expect(await runFirmReportAi(db, { firmId, year: 2026, reqId: now.reqId })).toBe(true);
  });
});
