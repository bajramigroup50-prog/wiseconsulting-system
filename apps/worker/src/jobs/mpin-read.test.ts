import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { MPIN_ASK } from '../ai/prompts';
import { setObjectReader } from '../ai/storage';
import { runMpinRead } from './mpin-read';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';

function fake(text: string): MessagesApi & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      return { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text, citations: null }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as Anthropic.Message;
    },
  };
}

async function inbox(): Promise<string> {
  const [f] = await pg.insert(schema.files).values({ firmId: null, bucketKey: 'k/' + Math.random(), name: 'mpin.pdf', mime: 'application/pdf', size: 1, sha256: 'x'.repeat(64), status: 'ready' }).returning();
  const [r] = await pg.insert(schema.mpinInbox).values({ fileId: f!.id, name: 'mpin.pdf' }).returning();
  return r!.id;
}

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Тест Трејд ДООЕЛ', edb: '4030999123456' }).returning();
  firmId = f!.id;
  setObjectReader(async () => new TextEncoder().encode('%PDF-1.4 fake'));
}, 60_000);
afterEach(() => { setAiClient(null); });

describe('mpin.read', () => {
  it('MPIN_ASK is the legacy prompt verbatim', () => {
    const legacy = readFileSync(fileURLToPath(new URL('../../../../legacy/index.html', import.meta.url)), 'utf8');
    expect(legacy).toContain(`const MPIN_ASK='${MPIN_ASK}';`);
  });
  it('reads, normalises and matches the firm by ЕДБ', async () => {
    const api = fake(JSON.stringify({ isMpin: true, edb: '4030999123456', name: 'X', period: '09/2026', status: 'ПРИФАТЕНА', gross: '100,000.00', pio: '18,800.00', zdr: '7,500.00', tax: '7,200.00' }));
    setAiClient(api);
    const id = await inbox();
    await runMpinRead(db, id);
    const [r] = await pg.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, id));
    expect(r!.status).toBe('ok');
    expect(r!.firmId).toBe(firmId);
    expect((r!.result as { period: string; net: number }).period).toBe('2026-09');
    expect((r!.result as { net: number }).net).toBe(66500);
    expect(api.calls[0]!.messages[0]!.content).toHaveLength(2);
    const [u] = await pg.select().from(schema.aiUsage).where(eq(schema.aiUsage.refId, id));
    expect([u!.purpose, u!.firmId]).toEqual(['mpin', null]);
  });
  it('a document that is not a МПИН → notm; failures are stored on the row', async () => {
    setAiClient(fake('{"isMpin":false}'));
    const a = await inbox();
    await runMpinRead(db, a);
    expect((await pg.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, a)))[0]!.status).toBe('notm');
    setAiClient(fake('not json'));
    const b = await inbox();
    await runMpinRead(db, b);
    const [r] = await pg.select().from(schema.mpinInbox).where(eq(schema.mpinInbox.id, b));
    expect(r!.status).toBe('error');
    expect(r!.error).toMatch(/не е прочитан/);
  });
});
