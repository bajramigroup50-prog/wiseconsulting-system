/**
 * „↻ Повторно“ of a read never requeues a document with saved drafts (their savedId links would be lost);
 * „ДДВ ознака“ (чл. 32-а / ослободено) is refused for a firm that is not a VAT payer.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));
const queued: string[] = [];
vi.mock('@/lib/jobs', () => ({ enqueue: async (_n: string, d: { docId: string }) => { queued.push(d.docId); return null; } }));

const { retryScan } = await import('@/app/(app)/skan/actions');
const { markInvoicesVatAction } = await import('@/app/(app)/izlez/actions');
let F = '';

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Скен Чувар ДООЕЛ', edb: '4030000000777', vatRegistered: false }).returning();
  F = f!.id;
  await signIn('admin');
  useFirm(F); useYear(2026);
}, 120_000);

describe('scan / VAT guards', () => {
  it('retryScan refuses a read with saved drafts and requeues one without', async () => {
    const draft = { draft: {}, status: 'ok', msg: '' };
    const [a] = await pg.insert(schema.aiDocuments).values({ firmId: F, kind: 'purchase', status: 'done', drafts: [{ ...draft, savedId: '00000000-0000-4000-8000-000000000001' }, draft] as never }).returning();
    const [b] = await pg.insert(schema.aiDocuments).values({ firmId: F, kind: 'purchase', status: 'error', drafts: [] }).returning();
    expect(await retryScan(a!.id)).toEqual({ error: 'Дел од фактурите се веќе зачувани.' });
    expect((await pg.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, a!.id)))[0]!.status).toBe('done');
    expect(await retryScan(b!.id)).toEqual({ ok: 'Повторно читање.' });
    expect(queued).toEqual([b!.id]);
  });
  it('markInvoicesVatAction refuses a firm that is not a VAT payer', async () => {
    const r = await markInvoicesVatAction(['00000000-0000-4000-8000-000000000002'], 'ded');
    expect('error' in r && r.error).toContain('не е ДДВ обврзник');
  });
});
