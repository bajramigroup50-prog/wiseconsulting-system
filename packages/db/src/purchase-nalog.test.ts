/**
 * A document scanned inside an opened nalog (the cash nalog 1020/7-9) is posted INTO that nalog: a cash purchase
 * (Д трошок + ДДВ / П 1020) with `data.nalogNo`; a nalog that does not exist is refused (PGlite).
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { postJournal } from './posting';
import { savePurchase } from './sales/purchases';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (tx: DB) => Promise<R>) => db.transaction((tx) => f(tx as unknown as DB));
let firmId = '', sup = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Благајна ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  sup = (await db.insert(schema.partners).values({ firmId, name: 'Маркет ДОО', code: '1' }).returning())[0]!.id;
  // the cash nalog the user opened
  await T((tx) => postJournal(tx as never, { firmId, date: '2026-07-01', kind: 'manual', number: '1020/7-9', description: 'Благајна 07-09', userId: null,
    lines: [{ account: '1020', debit: 1000 }, { account: '1000', credit: 1000 }] }));
}, 120_000);

describe('scanned inside a nalog', () => {
  it('a cash purchase with nalogNo is posted into the cash nalog; an unknown nalog is refused', async () => {
    const r = await T((tx) => savePurchase(tx as never, firmId, { number: 'ФИСК-1', date: '2026-07-10', partnerId: sup, ptype: 'cost', cash: true,
      groups: [{ account: '4000', rate: 18, base: 100, vat: 18 }], data: { nalogNo: '1020/7-9' } }, { userId: null, role: 'acc' }));
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'purchase'), eq(schema.journals.sourceId, r.id)));
    expect(j!.number).toBe('1020/7-9');
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
    expect(L.find((l) => l.account === '1020')).toMatchObject({ credit: '118.00' });
    await expect(T((tx) => savePurchase(tx as never, firmId, { number: 'ФИСК-2', date: '2026-07-11', partnerId: sup, ptype: 'cost', cash: true,
      groups: [{ account: '4000', rate: 18, base: 100, vat: 18 }], data: { nalogNo: '9/9' } }, { userId: null, role: 'acc' }))).rejects.toThrow(/не постои/);
  });
});
