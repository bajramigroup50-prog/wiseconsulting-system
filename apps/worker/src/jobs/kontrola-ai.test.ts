import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { versionsOf } from '@wise/core/compliance';
import {
  acceptKontrolaVersion, discardKontrolaVersion, kontrolaAiState, kontrolaTexts, putAiBudget, queueKontrolaAi, saveKontrola, saveKontrolaFinding, schema, type Tx,
} from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from '../ai/client';
import { runKontrolaAi } from './kontrola-ai';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '', kid = '', userId = '';

function fake(texts: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: texts.shift() ?? '{}', citations: null }], usage: { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const ANSWER = JSON.stringify({
  findings: [{ no: 1, inspectorRight: 'no', assessment: 'Одбивката е дозволена (чл. 35 ЗДДВ).', support: [{ ref: 'чл. 35 ЗДДВ', why: 'условите се исполнети' }], against: [{ ref: 'чл. 500 ЗДДВ', why: '—' }], counter: [], procedural: [], recommendation: 'object', chance: 75, position: 'Фактурите се уредни и евидентирани.', internal: ['Да се приложат фактурите.'] }],
  procedural: ['Рокот за жалба (ЗОУП чл. 106) е почитуван.'], conclusion: 'Жалбата да се уважи.', summary: 'Добра основа за жалба.',
});
const tx = <T>(f: (t: Tx) => Promise<T>) => pg.transaction((t) => f(t as unknown as Tx));
const load = async () => (await pg.select().from(schema.kontroli).where(eq(schema.kontroli.id, kid)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Фирма ДООЕЛ', edb: '4030000000001', address: 'Тајна 7', city: 'Скопје' }).returning();
  firmId = f!.id;
  const [u] = await pg.insert(schema.users).values({ username: 'k', name: 'Сметководител Тест', passwordHash: 'x', role: 'acc' }).returning();
  userId = u!.id;
  kid = await tx((t) => saveKontrola(t, firmId, { auth: 'ujp', doc: 'reshenie', docNo: '13-1', docDate: '2026-10-01', delivered: '2026-10-08' }, userId));
  await tx((t) => saveKontrolaFinding(t, firmId, kid, { area: 'vat', text: 'Одбиен претходен ДДВ', article: 'чл. 34 ЗДДВ', claimed: '50000', verdict: 'incorrect' }, userId));
  await tx((t) => saveKontrolaFinding(t, firmId, kid, { area: 'pit', text: 'Бонус', claimed: '1000', verdict: 'correct' }, userId));
  await pg.insert(schema.lawChanges).values({ key: 'k1', inst: 'UJP', title: 'Измени на Законот за данокот на додадена вредност', what: 'Се менува чл. 34.', date: '2026-05-01' });
}, 60_000);
beforeEach(async () => {
  await pg.delete(schema.aiUsage);
  await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'aiBudget'));
});
afterEach(() => setAiClient(null));

describe('kontrola.ai — „💲 AI правна анализа“', () => {
  it('sends the case + law store (no ЕДБ / address / staff), stores an AI version with model and cost, tags unverified articles', async () => {
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaAi(t, firmId, kid, false, userId));
    const vid = await runKontrolaAi(db, { kid, firmId, reqId, userId });
    expect(vid).toBeTruthy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]!.model).toBe(AI_MODELS.default); // Sonnet unless „🔍 Детално“
    const prompt = JSON.stringify(api.calls[0]!.messages[0]!.content);
    expect(prompt).toContain('Одбиен претходен ДДВ');
    expect(prompt).toContain('Измени на Законот за данокот на додадена вредност'); // from the law store
    expect(prompt).not.toContain('4030000000001');
    expect(prompt).not.toContain('Тајна 7');
    expect(prompt).not.toContain('Сметководител Тест');
    const k = await load();
    expect(kontrolaAiState(k)).toMatchObject({ status: 'done', versionId: vid, model: AI_MODELS.default });
    const v = versionsOf(k.data).find((x) => x.id === vid)!;
    expect(v).toMatchObject({ kind: 'ai', state: 'new', model: AI_MODELS.default, type: 'zhalba' });
    expect(v.costUsd).toBeCloseTo((10_000 * 2 + 2_000 * 10) / 1e6, 6);
    expect(v.ai!.findings[0]!.support[0]!.verified).toBe(true); // чл. 35 ЗДДВ is a tax review rule
    expect(v.ai!.unverified).toContain('чл. 500 ЗДДВ');
    expect(v.external).toContain('Фактурите се уредни и евидентирани.');
    expect(v.external).not.toContain('Бонус –'); // accepted finding is not argued
    expect(v.internal).toContain('[треба да се провери]');
    // logged in ai_usage under the case
    const [use] = await pg.select().from(schema.aiUsage);
    expect(use).toMatchObject({ purpose: 'kontrolaAi', refId: kid, firmId });
    // nothing is applied until the user accepts
    expect(kontrolaTexts(k).draft).toBeUndefined();
    await tx((t) => acceptKontrolaVersion(t, firmId, kid, vid!, userId));
    const k2 = await load();
    expect(kontrolaTexts(k2).draft).toBe(v.external);
    expect(versionsOf(k2.data).find((x) => x.id === vid)!.state).toBe('accepted');
    const A = await pg.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, kid));
    expect(A.map((a) => a.action)).toEqual(expect.arrayContaining(['kontrolaAiStart', 'kontrolaAi', 'kontrolaVersionAccept']));
  });
  it('„🔍 Детално“ uses Opus; discard keeps the version marked', async () => {
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaAi(t, firmId, kid, true, userId));
    const vid = await runKontrolaAi(db, { kid, firmId, reqId, userId, deep: true });
    expect(api.calls[0]!.model).toBe(AI_MODELS.complex);
    await tx((t) => discardKontrolaVersion(t, firmId, kid, vid!, userId));
    expect(versionsOf((await load()).data).find((x) => x.id === vid)!.state).toBe('discarded');
  });
  it('budget paused: no call, the case shows the error', async () => {
    await putAiBudget(db, { monthlyUsd: 1 });
    await pg.insert(schema.aiUsage).values({ firmId: null, purpose: 'test', tier: 'default', model: AI_MODELS.default, costUsd: '1.000000' });
    const api = fake([ANSWER]);
    setAiClient(api);
    const reqId = await tx((t) => queueKontrolaAi(t, firmId, kid, false, userId));
    expect(await runKontrolaAi(db, { kid, firmId, reqId, userId })).toBeNull();
    expect(api.calls).toHaveLength(0);
    expect(kontrolaAiState(await load())).toMatchObject({ status: 'error' });
  });
  it('a request replaced by a newer one is not stored', async () => {
    setAiClient(fake([ANSWER, ANSWER]));
    const old = await tx((t) => queueKontrolaAi(t, firmId, kid, false, userId).catch(() => 'x'));
    // simulate a newer request (the 10-minute guard is bypassed by finishing the old one first)
    await runKontrolaAi(db, { kid, firmId, reqId: old, userId });
    const newer = await tx((t) => queueKontrolaAi(t, firmId, kid, false, userId));
    expect(await runKontrolaAi(db, { kid, firmId, reqId: old, userId })).toBeNull();
    expect(await runKontrolaAi(db, { kid, firmId, reqId: newer, userId })).toBeTruthy();
  });
});
