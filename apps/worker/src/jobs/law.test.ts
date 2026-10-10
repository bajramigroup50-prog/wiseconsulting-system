import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { patchOfficeProfile, schema, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { runLawAsk, runLawRobot } from './law';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
const SRC = [{ url: 'https://www.ujp.gov.mk/mk', inst: 'UJP', name: 'УЈП – соопштенија', pick: /\/soopstenija\/pogledni\/\d+/ }];

function fake(texts: string[]): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: texts.shift() ?? '{}', citations: null }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}
const page = (ids: number[]) => `<html><body>${ids.map((i) => `<a href="/mk/javnost/soopstenija/pogledni/${i}">Соопштение број ${i}</a>`).join('')}</body></html>`;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await patchOfficeProfile(db, { email: 'office@wise.mk' }, null);
}, 60_000);
afterEach(() => setAiClient(null));

describe('law.robot', () => {
  it('first check stores the baseline only', async () => {
    const r = await runLawRobot(db, { today: '2026-10-09', sources: SRC, fetcher: async () => page([1, 2]) });
    expect(r).toMatchObject({ sources: 1, found: 0, added: 0, errors: [] });
    const [s] = await pg.select().from(schema.lawSources);
    expect(s!.links).toHaveLength(2);
  });
  it('new links → model → entries, office e-mail; dedupe on the next run', async () => {
    const api = fake([JSON.stringify({ items: [
      { url: 'https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/3', relevant: true, inst: 'UJP', title: 'Измени на ЗДДВ', what: 'Нова стапка', impact: ['ddv'], date: '2026-10-09' },
      { url: 'https://www.ujp.gov.mk/mk/javnost/soopstenija/pogledni/4', relevant: false, title: 'Оглас' },
    ] })]);
    setAiClient(api);
    const fetched: string[] = [];
    const r = await runLawRobot(db, { today: '2026-10-10', sources: SRC, fetcher: async (u) => { fetched.push(u); return u === SRC[0]!.url ? page([1, 2, 3, 4]) : '<p>Текст на соопштението</p>'; } });
    expect(r).toMatchObject({ found: 2, added: 1 });
    expect(r.mailIds).toHaveLength(1);
    expect(fetched).toHaveLength(3);
    expect(JSON.stringify(api.calls[0]!.messages[0]!.content)).toContain('Текст на соопштението');
    const L = await pg.select().from(schema.lawChanges);
    expect(L.map((x) => [x.title, x.inst, x.impact, x.source])).toEqual([['Измени на ЗДДВ', 'UJP', ['ddv'], 'robot']]);
    const [m] = await pg.select().from(schema.mailLog).where(eq(schema.mailLog.id, r.mailIds[0]!));
    expect(m!.to).toEqual(['office@wise.mk']);
    const again = await runLawRobot(db, { today: '2026-10-11', sources: SRC, fetcher: async () => page([1, 2, 3, 4]) });
    expect(again).toMatchObject({ found: 0, added: 0 });
  });
  it('without an API key: raw entries „да се потврди“; a failing page is recorded', async () => {
    const r = await runLawRobot(db, { today: '2026-10-12', sources: SRC, fetcher: async () => page([1, 2, 3, 4, 5]) });
    expect(r.added).toBe(1);
    const [x] = await pg.select().from(schema.lawChanges).where(eq(schema.lawChanges.title, 'Соопштение број 5'));
    expect(x!.verified).toBe(false);
    const bad = await runLawRobot(db, { sources: SRC, fetcher: async () => { throw new Error('HTTP 503'); } });
    expect(bad.errors).toEqual(['УЈП – соопштенија: HTTP 503']);
    const [s] = await pg.select().from(schema.lawSources);
    expect(s!.error).toBe('УЈП – соопштенија: HTTP 503');
    expect(s!.links).toHaveLength(5);
  });
});

describe('law.ask', () => {
  it('answers with the records as context', async () => {
    const api = fake(['Важи до 31.12.2026 [1]. Ова не е правен совет.']);
    setAiClient(api);
    const [q] = await pg.insert(schema.lawAsks).values({ question: 'До кога?' }).returning();
    await runLawAsk(db, q!.id, '2026-10-10');
    const [a] = await pg.select().from(schema.lawAsks).where(eq(schema.lawAsks.id, q!.id));
    expect([a!.status, a!.answer]).toEqual(['done', 'Важи до 31.12.2026 [1]. Ова не е правен совет.']);
    expect(JSON.stringify(api.calls[0]!.messages)).toContain('Измени на ЗДДВ');
  });
  it('stores the error without a key', async () => {
    const [q] = await pg.insert(schema.lawAsks).values({ question: 'x' }).returning();
    await runLawAsk(db, q!.id);
    expect((await pg.select().from(schema.lawAsks).where(eq(schema.lawAsks.id, q!.id)))[0]!.status).toBe('error');
  });
});
