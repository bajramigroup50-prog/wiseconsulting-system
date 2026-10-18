/**
 * „Архива на документи“ by nalog (default view): the nalozi of the year with documents / files / documents without a
 * file, each nalog opened alone with its documents that lack a file; the keeping periods (ЗДДВ чл. 56, ЗДП чл. 48).
 */
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { postJournal, schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push() {}, refresh() {}, back() {} }) }));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const ArhivaPage = (await import('@/app/(app)/arhiva/page')).default;
const html = async (sp: Record<string, string> = {}) => new Response((await prerender(await ArhivaPage({ searchParams: Promise.resolve(sp) }))).prelude).text();

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Архива ДООЕЛ' }).returning();
  // a purchase posted in nalog 2/7-9 without any scanned file
  await pg.transaction((tx) => postJournal(tx as never, { firmId: f!.id, date: '2026-08-10', kind: 'vlez', number: '2/7-9', description: 'Влезна ф-ра 15 · Добавувач', sourceType: 'purchase', sourceId: '00000000-0000-4000-8000-000000000001', userId: null,
    lines: [{ account: '4000', debit: 100 }, { account: '1020', credit: 100 }] }));
  await signIn('admin');
  useFirm(f!.id); useYear(2026);
}, 120_000);

describe('archive by nalog', () => {
  it('lists the nalozi with documents without a file and the keeping periods', async () => {
    const h = await html();
    expect(h).toContain('документи и датотеки');
    expect(h).toContain('2/7-9');
    expect(h).toContain('ЗДДВ чл. 56');
    expect(h).toContain('31.12.2036');
  });
  it('one nalog opened alone shows its documents without a file', async () => {
    const h = await html({ nal: '2/7-9' });
    expect(h).toContain('документи без датотека');
    expect(h).toContain('Влезна ф-ра 15 · Добавувач');
  });
});
