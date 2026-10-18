/**
 * „📋 Преглед на внес по месеци“ renders the months of the working year with an invoice, an imported VAT nalog in the
 * same month (possible double entry) and a month without sales before it (PGlite).
 */
import { prerender } from 'react-dom/static';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { postJournal, schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const VnesPage = (await import('@/app/(app)/vnes/page')).default;
const html = async () => new Response((await prerender(await VnesPage())).prelude).text();

beforeAll(async () => {
  await setupDb();
  const [f] = await pg.insert(schema.firms).values({ name: 'Внес ДООЕЛ', vatRegistered: true }).returning();
  const [p] = await pg.insert(schema.partners).values({ firmId: f!.id, name: 'Купувач', code: '1' }).returning();
  await pg.insert(schema.invoices).values({ firmId: f!.id, kind: 'invoice', number: 'F-1', date: '2026-03-10', partnerId: p!.id, base: '1000', vat: '180', total: '1180' });
  await pg.transaction((tx) => postJournal(tx as never, { firmId: f!.id, date: '2026-03-31', kind: 'manual', number: 'У1', description: 'Увезен налог', sourceType: 'import', sourceId: 'b:1', userId: null,
    lines: [{ account: '1200', debit: 1180, partnerId: p!.id }, { account: '7400', credit: 1000 }, { account: '230018', credit: 180 }] }));
  await pg.insert(schema.invoices).values({ firmId: f!.id, kind: 'invoice', number: 'F-0', date: '2026-01-05', partnerId: p!.id, base: '100', vat: '18', total: '118' });
  await signIn('admin');
  useFirm(f!.id); useYear(2026);
}, 120_000);

describe('Преглед на внес по месеци', () => {
  it('lists the months and the warnings', async () => {
    const h = await html();
    expect(h).toContain('Преглед на внес по месеци');
    expect(h).toContain('март');
    expect(h).toContain('Можно двојно: има книжени излезни фактури И увезен налог со излезен ДДВ');
    expect(h).toContain('Нема излезни фактури ниту увезен излезен ДДВ');
  });
});
