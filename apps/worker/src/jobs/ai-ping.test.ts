/**
 * `ai.ping` („🔎 Провери го AI-кредитот сега“) with a fake client, the „paused because of an earlier failure“ message
 * of blocked reads, and the automatic check of blocked reads (failure older than 2 minutes, at most once per 2 minutes).
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_ERR_MSG, AI_PING_OK, aiBlockedMsg, hhmmSkopje } from '@wise/core/ai/errors';
import { getAiSettings, noteAiFailure, schema, type AiSettings, type Tx } from '@wise/db';
import { AI_MODELS, setAiClient, type MessagesApi } from '../ai/client';
import { setObjectReader } from '../ai/storage';
import { runReadDocument } from './ai-read-document';
import { AUTO_PING_MS, runAiPing, shouldAutoPing } from './ai-ping';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
const CREDIT = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

type Fake = MessagesApi & { n: number; bodies: Anthropic.MessageCreateParamsNonStreaming[] };
function fake(fail?: { status: number; message: string }, text = '{"receipts":[]}'): Fake {
  const api: Fake = {
    n: 0, bodies: [],
    async create(body) {
      api.n++; api.bodies.push(body);
      if (fail) throw Object.assign(new Error(fail.message), { status: fail.status });
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text, citations: null }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
  return api;
}
const creditFake = () => fake({ status: 400, message: CREDIT });

/** A remembered failure `ago` ms in the past. */
async function failedAgo(ago: number, code: 'credit' | 'auth' = 'credit') {
  const at = new Date(Date.now() - ago).toISOString();
  await pg.insert(schema.appSettings).values({ key: 'ai', value: { lastFail: { code, at, detail: 'x' } } })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: { lastFail: { code, at, detail: 'x' } } } });
  return at;
}
async function photo() {
  const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/' + Math.random(), name: 'r.jpg', mime: 'image/jpeg', size: 3, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind: 'blg', options: {} }).returning();
  return d!.id;
}
const load = async (id: string) => (await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Пинг ДООЕЛ' }).returning();
  firmId = f!.id;
  setObjectReader(async () => new Uint8Array([0xff, 0xd8, 0xff]));
}, 60_000);
beforeEach(async () => { await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'ai')); });
afterEach(() => { setAiClient(null); });

describe('ai.ping', () => {
  it('a 1-token request with the cheapest model; success clears the remembered failure', async () => {
    await noteAiFailure(db, 'credit', 'x');
    const api = fake();
    setAiClient(api);
    expect(await runAiPing(db, { id: 'req1' })).toEqual({ ok: true, code: null, msg: AI_PING_OK });
    expect(api.bodies[0]).toMatchObject({ model: AI_MODELS.quick, max_tokens: 1 });
    const S = await getAiSettings(db);
    expect(S.lastFail).toBeNull();
    expect(S.lastPing).toMatchObject({ ok: true, id: 'req1', auto: false, msg: AI_PING_OK });
  });

  it('credit still exhausted: the failure is remembered (new time) and the friendly message returned', async () => {
    setAiClient(creditFake());
    const r = await runAiPing(db, { id: 'req2' });
    expect(r).toEqual({ ok: false, code: 'credit', msg: AI_ERR_MSG.credit });
    const S = await getAiSettings(db);
    expect(S.lastFail).toMatchObject({ code: 'credit' });
    expect(S.lastPing).toMatchObject({ ok: false, code: 'credit', id: 'req2' });
  });

  it('overload is reported but not remembered as a blocking failure; an unknown error is „other“', async () => {
    setAiClient(fake({ status: 529, message: 'Overloaded' }));
    expect((await runAiPing(db)).code).toBe('overloaded');
    expect((await getAiSettings(db)).lastFail).toBeNull();
    setAiClient(fake({ status: 400, message: 'something odd' }));
    expect(await runAiPing(db)).toMatchObject({ ok: false, code: 'other' });
  });
});

describe('automatic check throttle', () => {
  const S = (failAgo: number | null, pingAgo: number | null, enabled = true): AiSettings => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    return {
      enabled,
      lastFail: failAgo == null ? null : { code: 'credit', at: new Date(now - failAgo).toISOString(), detail: '' },
      lastPing: pingAgo == null ? null : { ok: false, msg: '', at: new Date(now - pingAgo).toISOString() },
    };
  };
  const now = Date.parse('2026-10-12T10:00:00Z');
  it('only for a failure older than 2 minutes, and not more often than every 2 minutes', () => {
    expect(shouldAutoPing(S(null, null), now)).toBe(false);
    expect(shouldAutoPing(S(60_000, null), now)).toBe(false);
    expect(shouldAutoPing(S(AUTO_PING_MS + 1, null), now)).toBe(true);
    expect(shouldAutoPing(S(10 * 60_000, 30_000), now)).toBe(false);
    expect(shouldAutoPing(S(10 * 60_000, AUTO_PING_MS), now)).toBe(true);
    expect(shouldAutoPing(S(10 * 60_000, null, false), now)).toBe(false);
  });
});

describe('blocked reads', () => {
  it('a recent failure: no AI call, the message says AI is paused because of the earlier failure at HH:MM', async () => {
    const at = await failedAgo(30_000);
    const api = fake();
    setAiClient(api);
    const id = await photo();
    await runReadDocument(db, id);
    const d = await load(id);
    expect(api.n).toBe(0);
    expect(d.status).toBe('error');
    expect(d.error).toBe(aiBlockedMsg('credit', at));
    expect(d.error).toContain(`AI е привремено паузирано поради претходна грешка (кредит) во ${hhmmSkopje(at)}`);
    expect(d.error).not.toBe(AI_ERR_MSG.credit);
    expect(d.options).toMatchObject({ errCode: 'credit' });
  });

  it('a failure older than 2 minutes: the automatic check finds the credit topped up and the read uses AI', async () => {
    await failedAgo(5 * 60_000);
    const api = fake();
    setAiClient(api);
    const id = await photo();
    await runReadDocument(db, id);
    expect(api.n).toBe(2);
    expect(api.bodies[0]).toMatchObject({ max_tokens: 1 });
    expect(await load(id)).toMatchObject({ status: 'done' });
    const S = await getAiSettings(db);
    expect(S.lastFail).toBeNull();
    expect(S.lastPing).toMatchObject({ ok: true, auto: true });
  });

  it('credit still exhausted: one automatic check, then none for 2 minutes', async () => {
    await failedAgo(5 * 60_000);
    const api = creditFake();
    setAiClient(api);
    const a = await photo();
    await runReadDocument(db, a);
    expect(api.n).toBe(1);
    expect((await load(a)).error).toMatch(/^AI е привремено паузирано/);
    // pretend the failure is old again: the last check (just now) still throttles
    await pg.update(schema.appSettings).set({ value: { ...(await getAiSettings(db)), lastFail: { code: 'credit', at: new Date(Date.now() - 5 * 60_000).toISOString(), detail: 'x' } } })
      .where(eq(schema.appSettings.key, 'ai'));
    const b = await photo();
    await runReadDocument(db, b);
    expect(api.n).toBe(1);
    expect((await load(b)).error).toMatch(/^AI е привремено паузирано/);
  });

  it('„↻ Повторно“ still calls AI directly; a fresh credit error keeps the „credit exhausted“ message', async () => {
    await failedAgo(30_000);
    setAiClient(creditFake());
    const [f] = await pg.insert(schema.files).values({ firmId, bucketKey: 'k/r', name: 'r.jpg', mime: 'image/jpeg', size: 3, sha256: 'x'.repeat(64), status: 'ready' }).returning();
    const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: f!.id, kind: 'blg', options: { retry: true } }).returning();
    await runReadDocument(db, d!.id);
    expect((await load(d!.id)).error).toBe(AI_ERR_MSG.credit);
  });
});
