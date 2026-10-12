/**
 * „📷 Нова фирма од решение“ (job `ai.read-firm-resh`): electronic ЦРСМ / УЈП documents are read without AI (model
 * `noai`), a photo goes to AI, a scan without AI gives the clear message, a partial text read survives an AI failure.
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DDV_POTVRDA, TEKOVNA, UPIS } from '@wise/core/noai/firm-resh.fixtures';
import { schema, setAiEnabled, type Tx } from '@wise/db';
import { setAiClient, type MessagesApi } from '../ai/client';
import { setObjectReader } from '../ai/storage';
import { runReadFirmResh } from './firm-resh';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
const bytes = new Map<string, Uint8Array>();
const KEY = process.env.ANTHROPIC_API_KEY;

const ai = (answer: string | Error): MessagesApi & { n: number } => {
  const api = {
    n: 0,
    async create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
      api.n++;
      if (answer instanceof Error) throw answer;
      return {
        id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: answer, citations: null }],
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      } as unknown as Anthropic.Message;
    },
  };
  return api as MessagesApi & { n: number };
};

async function read(...F: [string, string, Uint8Array][]) {
  const ids: string[] = [];
  for (const [name, mime, body] of F) {
    const key = 'k/' + Math.random();
    bytes.set(key, body);
    const [f] = await pg.insert(schema.files).values({ firmId: null, bucketKey: key, name, mime, size: body.length, sha256: 'x'.repeat(64), status: 'ready' }).returning();
    ids.push(f!.id);
  }
  const [r] = await pg.insert(schema.firmReshReads).values({ fileIds: ids }).returning();
  await runReadFirmResh(db, r!.id);
  return (await pg.select().from(schema.firmReshReads).where(eq(schema.firmReshReads.id, r!.id)))[0]!;
}
const txt = (name: string, t: string): [string, string, Uint8Array] => [name, 'text/plain', new TextEncoder().encode(t)];
const JPG: [string, string, Uint8Array] = ['resh.jpg', 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff])];

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  setObjectReader(async (k) => bytes.get(k) ?? new Uint8Array());
}, 60_000);
beforeEach(async () => { delete process.env.ANTHROPIC_API_KEY; await pg.delete(schema.appSettings).where(eq(schema.appSettings.key, 'ai')); });
afterEach(() => { setAiClient(null); if (KEY) process.env.ANTHROPIC_API_KEY = KEY; });

describe('firm registration document read (worker)', () => {
  it('electronic Решение за упис: read without AI, AI not called', async () => {
    const api = ai(new Error('AI must not be called'));
    setAiClient(api);
    const r = await read(txt('upis.txt', UPIS));
    expect(r).toMatchObject({ status: 'done', model: 'noai', error: null });
    expect(r.result).toMatchObject({ docType: 'upis', name: 'Друштво за производство и трговија ПРИМЕР СОФТ ДООЕЛ Скопје', embs: '7999001', edb: '4030026999012', nkd: '62.01', signer: 'Петар Петровски', noai: true, note: 'прочитано без AI – проверете' });
    expect(api.n).toBe(0);
  });

  it('Тековна состојба + ДДВ потврда together: merged, ДДВ обврзник from УЈП', async () => {
    const r = await read(txt('tek.txt', TEKOVNA), txt('ddv.txt', DDV_POTVRDA));
    expect(r).toMatchObject({ status: 'done', model: 'noai' });
    expect(r.result).toMatchObject({ docType: 'tekovna', embs: '7999002', ddv: true, vatFrom: '2026-07-01', warnings: [] });
  });

  it('a photo goes to AI', async () => {
    const api = ai(JSON.stringify({ docType: 'upis', name: 'ФОТО ДООЕЛ Струга', embs: '7999009', edb: '4030026999999', managers: [{ name: 'Ана Тест' }] }));
    setAiClient(api);
    const r = await read(JPG);
    expect(api.n).toBe(1);
    expect(r.status).toBe('done');
    expect(r.model).not.toBe('noai');
    expect(r.result).toMatchObject({ name: 'ФОТО ДООЕЛ Струга', signer: 'Ана Тест' });
  });

  it('a scan with AI switched off: clear message, no AI call', async () => {
    const api = ai('{}');
    setAiClient(api);
    await setAiEnabled(db, false, null);
    const r = await read(JPG);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/нема текст.*скен \/ слика.*AI-читањето е исклучено/);
    expect(api.n).toBe(0);
  });

  it('text without ЕМБС / ЕДБ: AI is asked; when AI fails the partial free read is shown with the reason', async () => {
    const api = ai(Object.assign(new Error('overloaded'), { status: 529 }));
    setAiClient(api);
    const r = await read(txt('x.txt', 'ЦЕНТРАЛЕН РЕГИСТАР\nРЕШЕНИЕ за упис\nЦелосен назив: НЕПОЛНО ДООЕЛ Скопје\n'));
    expect(api.n).toBeGreaterThan(0);
    expect(r).toMatchObject({ status: 'done', model: 'noai' });
    const w = (r.result as { warnings: string[] }).warnings;
    expect(w).toContain('Не се најде: ЕМБС / ЕДБ');
    expect(w.some((x) => x.startsWith('AI не успеа'))).toBe(true);
  });
});
