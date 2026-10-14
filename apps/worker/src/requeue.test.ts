import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { schema, type Tx } from '@wise/db';
import { requeueStaleReads, type QueueJob } from './requeue';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let firmId = '';
const ago = (ms: number) => new Date(Date.now() - ms);

async function doc(status: string, updatedMsAgo: number, opts: Record<string, unknown> = {}, createdMsAgo = updatedMsAgo): Promise<string> {
  const [d] = await pg.insert(schema.aiDocuments).values({ firmId, fileId: null, kind: 'bom', status: status as 'queued', options: opts, createdAt: ago(createdMsAgo) }).returning();
  // `$onUpdate` would stamp now(): set the age with plain SQL
  await pg.execute(`update ai_documents set updated_at = now() - interval '${Math.round(updatedMsAgo / 1000)} seconds' where id = '${d!.id}'`);
  return d!.id;
}

beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)) });
  const [f] = await pg.insert(schema.firms).values({ name: 'Тест ДООЕЛ', edb: '4030999000001' }).returning();
  firmId = f!.id;
}, 60_000);

describe('requeueStaleReads (worker startup)', () => {
  it('requeues interrupted reads once, cancels their orphaned active jobs, leaves the rest alone', async () => {
    const stuck = await doc('reading', 10 * 60_000);
    const neverSent = await doc('queued', 5 * 60_000);
    const waiting = await doc('queued', 5 * 60_000);
    const fresh = await doc('reading', 10_000);
    const cancelled = await doc('reading', 10 * 60_000, { cancelled: true });
    const done = await doc('done', 10 * 60_000);
    const ancient = await doc('reading', 3 * 864e5);
    const jobs: Record<string, QueueJob[]> = {
      'ai.read-document': [
        { id: '00000000-0000-0000-0000-00000000000a', state: 'active', rowId: stuck },
        { id: '00000000-0000-0000-0000-00000000000b', state: 'created', rowId: waiting },
      ],
    };
    const sent: [string, object][] = [], cancels: [string, string[]][] = [];
    const deps = {
      jobs: async (n: string) => jobs[n] ?? [],
      send: async (n: string, d: object) => { sent.push([n, d]); jobs[n] = [...(jobs[n] ?? []), { id: 'x', state: 'created', rowId: Object.values(d)[0] as string }]; },
      cancel: async (n: string, ids: string[]) => { cancels.push([n, ids]); },
    };
    const r = await requeueStaleReads(db, deps);
    expect(new Set(r['ai.read-document'])).toEqual(new Set([stuck, neverSent]));
    expect(sent.map((x) => x[1])).toEqual(expect.arrayContaining([{ docId: stuck }, { docId: neverSent }]));
    expect(sent).toHaveLength(2);
    expect(cancels).toEqual([['ai.read-document', ['00000000-0000-0000-0000-00000000000a']]]);
    const [s] = await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, stuck));
    expect(s!.status).toBe('queued');
    for (const id of [fresh, cancelled, done, ancient, waiting]) expect(sent.some((x) => (x[1] as { docId: string }).docId === id)).toBe(false);

    // idempotent: a second sweep (another restart right away) sends nothing
    const again = await requeueStaleReads(db, deps);
    expect(again['ai.read-document']).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  it('also covers registration-decision reads (firm_resh_reads)', async () => {
    const [x] = await pg.insert(schema.firmReshReads).values({ fileIds: [], status: 'reading' }).returning();
    await pg.execute(`update firm_resh_reads set updated_at = now() - interval '600 seconds' where id = '${x!.id}'`);
    const sent: object[] = [];
    await requeueStaleReads(db, { jobs: async () => [], send: async (_n, d) => { sent.push(d); }, cancel: async () => {} });
    expect(sent).toContainEqual({ id: x!.id });
  });
});
