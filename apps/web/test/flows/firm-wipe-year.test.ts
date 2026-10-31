/** Фирми → „🗑 Избриши ги сите документи и книжења за годината“: admin only, the typed name must match, then the year goes. */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { postJournal, schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { wipePlanAction, wipeYearAction } = await import('@/app/(app)/firmi/wipe-actions');
let firmId = '';

beforeAll(async () => {
  await setupDb();
  firmId = (await pg.insert(schema.firms).values({ name: 'Брише Година ДООЕЛ' }).returning())[0]!.id;
  await pg.transaction((tx) => postJournal(tx as never, { firmId, date: '2026-04-04', kind: 'manual', userId: null, lines: [{ account: '4400', debit: 10 }, { account: '1000', credit: 10 }] }));
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('wipe the year of a firm', () => {
  it('lists what goes, refuses a wrong name, deletes with the right one', async () => {
    const p = await wipePlanAction(firmId);
    expect(p.plan).toEqual([{ label: 'налози', n: 1 }]);
    expect((await wipeYearAction(firmId, 'друга фирма')).error).toMatch(/не е точно/);
    expect(await pg.select().from(schema.journals).where(eq(schema.journals.firmId, firmId))).toHaveLength(1);
    const r = await wipeYearAction(firmId, '  брише година дооел ');
    expect(r.ok).toMatch(/Избришани се сите документи/);
    expect(await pg.select().from(schema.journals).where(eq(schema.journals.firmId, firmId))).toHaveLength(0);
  });
});
