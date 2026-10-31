/**
 * Партнери → „Избриши ги избраните“: a partner still on a statement line is skipped and named, the others are deleted
 * (one used partner never blocks the whole selection).
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addManualLine, saveBankAccount, schema } from '@wise/db';
import { pg, setupDb, signIn, useFirm, useYear } from '../harness';

vi.mock('@/lib/db', () => import('../harness').then((h) => h.dbModule));
vi.mock('next/headers', () => import('../harness').then((h) => h.headersModule));
vi.mock('next/cache', () => import('../harness').then((h) => h.cacheModule));
vi.mock('@wise/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (globalThis as { __wisePg?: unknown }).__wisePg }));

const { deletePartnersAction } = await import('@/app/(app)/partneri/actions');
let firmId = '', used = '', a = '', b = '';

beforeAll(async () => {
  await setupDb();
  firmId = (await pg.insert(schema.firms).values({ name: 'Бришење ДООЕЛ' }).returning())[0]!.id;
  const P = (await pg.insert(schema.partners).values([{ firmId, name: 'НА ИЗВОД ДОО' }, { firmId, name: 'Слободен А' }, { firmId, name: 'Слободен Б' }]).returning()).map((p) => p.id);
  used = P[0]!; a = P[1]!; b = P[2]!;
  const acct = await pg.transaction((tx) => saveBankAccount(tx as never, { firmId, userId: null, input: { name: 'Халкбанк', cur: 'MKD', konto: '100077' } }));
  await pg.transaction((tx) => addManualLine(tx as never, { firmId, userId: null, bankAccountId: acct, date: '2026-10-07', amount: -14160, desc: 'плаќање', konto: '2200', partnerId: used } as never));
  await signIn('admin');
  useFirm(firmId); useYear(2026);
});

describe('bulk delete of partners', () => {
  it('deletes the free ones and names the one on a statement', async () => {
    const r = await deletePartnersAction([used, a, b]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toMatch(/Избришани 2 од 3/);
    expect(r.ok).toMatch(/НА ИЗВОД ДОО/);
    const left = await pg.select({ id: schema.partners.id }).from(schema.partners).where(and(eq(schema.partners.firmId, firmId)));
    expect(left.map((x) => x.id)).toEqual([used]);
  });
});
