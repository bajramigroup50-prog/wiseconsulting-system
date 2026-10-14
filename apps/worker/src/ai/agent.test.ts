/**
 * 🤖 WISE Робот agent loop with a mocked Anthropic client: tool use → answer, firm isolation through the loop,
 * the step cap, cost logging (reserve / settle, purpose `robot`), prompt caching, the deep tier, the budget pause and
 * the AI switch (no call is made).
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postJournal, putAiBudget, robotAskRows, schema, seedReference, setAiEnabled, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from './client';
import { AiBudgetError } from './budget';
import { ROBOT_CAP_MSG, ROBOT_MAX_STEPS, runRobotAgent } from './agent';
import { runRobotAsk } from '../jobs/robot';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let A: typeof schema.firms.$inferSelect, B: typeof schema.firms.$inferSelect;
let user = '';

type Step = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };
function fake(steps: Step[] | ((i: number) => Step)): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      const i = calls.length;
      calls.push(structuredClone(body));
      const s = typeof steps === 'function' ? steps(i) : steps[i] ?? { text: 'крај' };
      const content: unknown[] = [];
      if (s.text) content.push({ type: 'text', text: s.text, citations: null });
      for (const [k, t] of (s.tools ?? []).entries()) content.push({ type: 'tool_use', id: `tu_${i}_${k}`, name: t.name, input: t.input });
      return {
        id: 'm' + i, type: 'message', role: 'assistant', model: body.model, stop_reason: s.tools?.length ? 'tool_use' : 'end_turn', stop_sequence: null, content,
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
}
const ctx = () => ({ db, firm: A, year: 2026, userId: user, today: '2026-10-14' });

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await seedReference(pg as never);
  [A] = (await pg.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000011' }).returning()) as [typeof A];
  [B] = (await pg.insert(schema.firms).values({ name: 'Бета ДОО', edb: '4030000000022' }).returning()) as [typeof B];
  const [u] = await pg.insert(schema.users).values({ username: 'acc1', name: 'Сметководител', role: 'acc', passwordHash: 'x' }).returning();
  user = u!.id;
  await pg.insert(schema.userFirms).values({ userId: user, firmId: A.id });
  await pg.transaction((tx) => postJournal(tx, { firmId: A.id, date: '2026-03-10', kind: 'manual', lines: [{ account: '1020', debit: 1500 }, { account: '7400', credit: 1500 }], userId: null }));
  await pg.transaction((tx) => postJournal(tx, { firmId: B.id, date: '2026-03-10', kind: 'manual', lines: [{ account: '1020', debit: 777777 }, { account: '7400', credit: 777777 }], userId: null }));
}, 120_000);
beforeEach(async () => {
  await pg.delete(schema.aiUsage);
  await pg.delete(schema.appSettings);
  process.env.ANTHROPIC_API_KEY = 'test';
});
afterEach(() => { setAiClient(null); delete process.env.ANTHROPIC_API_KEY; });

describe('agent loop', () => {
  it('calls a tool for the context firm, answers, logs the cost and caches the prefix', async () => {
    const api = fake([
      // the model tries to read another firm: the id is ignored, the context firm is used
      { tools: [{ name: 'account_balance', input: { konto: '1020', firmId: B.id } }] },
      { text: 'Салдото на благајната е 1.500,00 ден.' },
    ]);
    setAiClient(api);
    const r = await runRobotAgent({ db, ctx: ctx(), question: 'Колку има во благајна?', refId: null });
    expect(r.text).toBe('Салдото на благајната е 1.500,00 ден.');
    expect(r.unverified).toEqual([]);
    expect(r.tools.map((t) => t.name)).toEqual(['account_balance']);
    expect(r.sources[0]!.href).toMatch(/^\/kkart\?k=1020/);
    expect(api.calls).toHaveLength(2);
    // the tool result the model saw holds A's 1.500, never B's 777.777
    const tr = JSON.stringify(api.calls[1]!.messages);
    expect(tr).toContain('1500');
    expect(tr).not.toContain('777777');
    expect(api.calls[0]!.model).toBe(AI_MODELS.default);
    expect(api.calls[0]!.max_tokens).toBe(1500);
    expect((api.calls[0]!.system as Anthropic.TextBlockParam[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    const tools = api.calls[0]!.tools as Anthropic.Tool[];
    expect(tools.at(-1)!.cache_control).toEqual({ type: 'ephemeral' });
    expect(tools.every((t) => !('firmId' in (t.input_schema.properties as object)))).toBe(true);
    const U = await pg.select().from(schema.aiUsage);
    expect(U).toHaveLength(2);
    expect(U.every((u) => u.purpose === 'robot' && u.firmId === A.id && Number(u.costUsd) > 0)).toBe(true);
    expect(r.costUsd).toBeGreaterThan(0);
  });
  it('an amount the model invents is flagged', async () => {
    setAiClient(fake([{ tools: [{ name: 'account_balance', input: { konto: '1020' } }] }, { text: 'Салдото е 2.500,00 ден.' }]));
    const r = await runRobotAgent({ db, ctx: ctx(), question: 'благајна?' });
    expect(r.unverified).toEqual(['2.500,00']);
  });
  it(`stops after ${ROBOT_MAX_STEPS} model calls; the last one may not use tools`, async () => {
    const api = fake(() => ({ tools: [{ name: 'cash_bank', input: {} }] }));
    setAiClient(api);
    const r = await runRobotAgent({ db, ctx: ctx(), question: 'бесконечно' });
    expect(api.calls).toHaveLength(ROBOT_MAX_STEPS);
    expect(r.capped).toBe(true);
    expect(r.text).toContain(ROBOT_CAP_MSG);
    expect(api.calls.at(-1)!.tool_choice).toEqual({ type: 'none' });
    expect(api.calls[0]!.tool_choice).toBeUndefined();
    expect(await pg.select().from(schema.aiUsage)).toHaveLength(ROBOT_MAX_STEPS);
  });
  it('„Длабока анализа“ uses the deep tier, otherwise never', async () => {
    const api = fake([{ text: 'ок' }]);
    setAiClient(api);
    await runRobotAgent({ db, ctx: ctx(), question: 'анализа', deep: true });
    expect(api.calls[0]!.model).toBe(AI_MODELS.complex);
    expect(api.calls[0]!.max_tokens).toBe(3000);
  });
  it('the budget pause refuses before any call', async () => {
    const api = fake([{ text: 'не смее' }]);
    setAiClient(api);
    await putAiBudget(db, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: A.id, purpose: 'x', tier: 'default', model: AI_MODELS.default, costUsd: '5' });
    await expect(runRobotAgent({ db, ctx: ctx(), question: 'х' })).rejects.toBeInstanceOf(AiBudgetError);
    expect(api.calls).toHaveLength(0);
  });
});

describe('robot.ask job', () => {
  const ask = async (text: string, firmId = A.id) => {
    const { answerId } = await robotAskRows(db, { userId: user, firmId, year: 2026, text, deep: false });
    return answerId;
  };
  const row = async (id: string) => (await pg.select().from(schema.robotMessages).where(eq(schema.robotMessages.id, id)))[0]!;

  it('answers and stores the sources, tools and cost', async () => {
    setAiClient(fake([{ tools: [{ name: 'cash_bank', input: {} }] }, { text: 'Благајна 1.500,00 ден.' }]));
    const id = await ask('Колку пари има?');
    await runRobotAsk(db, id, '2026-10-14');
    const m = await row(id);
    expect(m).toMatchObject({ status: 'done', text: 'Благајна 1.500,00 ден.', model: AI_MODELS.default, free: false });
    expect(m.sources.map((s) => s.href)).toContain('/blagajna');
    expect(Number(m.costUsd)).toBeGreaterThan(0);
  });
  it('budget pause: the existing pause message, no model call', async () => {
    const api = fake([{ text: 'x' }]);
    setAiClient(api);
    await putAiBudget(db, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: A.id, purpose: 'x', tier: 'default', model: AI_MODELS.default, costUsd: '5' });
    const id = await ask('нешто');
    await runRobotAsk(db, id);
    const m = await row(id);
    expect(m.status).toBe('error');
    expect(m.error).toBe('budget');
    expect(m.text).toMatch(/лимит/i);
    expect(api.calls).toHaveLength(0);
  });
  it('AI switched off: no call', async () => {
    const api = fake([{ text: 'x' }]);
    setAiClient(api);
    await setAiEnabled(db, false, null);
    const id = await ask('нешто');
    await runRobotAsk(db, id);
    expect(await row(id)).toMatchObject({ status: 'error', error: 'off' });
    expect(api.calls).toHaveLength(0);
  });
  it('a firm the user has no access to is refused', async () => {
    const api = fake([{ text: 'x' }]);
    setAiClient(api);
    const id = await ask('салдо', B.id);
    await runRobotAsk(db, id);
    expect(await row(id)).toMatchObject({ status: 'error', error: 'forbidden' });
    expect(api.calls).toHaveLength(0);
  });
});
