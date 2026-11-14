/** ✈️ Патни налози: save → settle → post through the firm's scheme (Д 4400 / 4403 / П 1430 / П 2410), re-post, unpost, delete (PGlite). */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BusinessTrip } from '@wise/core/btrip';
import { BTRIP_SETTINGS_KEY, deleteBtrip, listBtrips, postBtrip, saveBtrip, saveBtripSettings, unpostBtrip } from './btrip';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
let firmId = '', emp = '', userId = '';
const fx = (c: string) => (c === 'EUR' ? 61.5 : 0);
const trip = (o: Partial<BusinessTrip> = {}): BusinessTrip => ({
  number: '', date: '2026-03-02', employeeId: emp, abroad: false, dest: 'Битола', country: '', purpose: 'Состанок', vehicle: 'own', km: 100,
  dep: '2026-03-02T07:00', ret: '2026-03-02T20:00', advance: 2000, advCur: 'MKD', ...o,
});
const lines = async () => (await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'btrip'))))
  .length ? (await db.select().from(schema.journalLines).where(eq(schema.journalLines.firmId, firmId))).map((l) => [l.account, Number(l.debit), Number(l.credit)]).sort() : [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  userId = (await db.insert(schema.users).values({ username: 'bt', passwordHash: 'x', name: 'BT', role: 'admin' }).returning())[0]!.id;
  firmId = (await db.insert(schema.firms).values({ name: 'Тест Патувања ДООЕЛ' }).returning())[0]!.id;
  emp = (await db.insert(schema.employees).values({ firmId, name: 'Петар Петров' }).returning())[0]!.id;
  await T((tx) => saveBtripSettings(tx, userId, BTRIP_SETTINGS_KEY, { domAmt: 3000, fuelPrice: 80, carPct: 30 }));
}, 120_000);

describe('патни налози', () => {
  it('numbers, validates, posts, re-posts, unposts and deletes', async () => {
    const a = { firmId, userId };
    const id = await T((tx) => saveBtrip(tx, a, null, trip()));
    expect((await listBtrips(db, firmId))[0]!.number).toBe('1/2026');
    await expect(T((tx) => saveBtrip(tx, a, null, trip({ ret: '2026-03-01T10:00' })))).rejects.toThrow('Враќањето е пред поаѓањето.');
    await expect(T((tx) => saveBtrip(tx, a, null, trip({ number: '1/2026' })))).rejects.toThrow('веќе постои');
    const r = await T((tx) => postBtrip(tx, a, id, fx));
    expect(r.st.total).toBe(5400);
    expect(await lines()).toEqual([['1430', 0, 2000], ['2410', 0, 3400], ['4400', 3000, 0], ['4403', 2400, 0]]);
    await expect(T((tx) => saveBtrip(tx, a, id, trip()))).rejects.toThrow('книжен');
    await T((tx) => postBtrip(tx, a, id, fx));
    expect((await db.select().from(schema.journals).where(eq(schema.journals.firmId, firmId))).length).toBe(1);
    await T((tx) => unpostBtrip(tx, a, id));
    expect(await lines()).toEqual([]);
    expect((await listBtrips(db, firmId))[0]!.status).toBe('open');
    await T((tx) => deleteBtrip(tx, a, id));
    expect(await listBtrips(db, firmId)).toEqual([]);
  });
  it('abroad: per diems in EUR × NBRM, foreign kontos; a missing rate stops the posting', async () => {
    const a = { firmId, userId };
    const id = await T((tx) => saveBtrip(tx, a, null, trip({ abroad: true, country: 'DE', vehicle: 'company', km: null, advance: null, dep: '2026-03-10T06:00', ret: '2026-03-12T16:00' })));
    await expect(T((tx) => postBtrip(tx, a, id, () => 0))).rejects.toThrow('Нема курс');
    const r = await T((tx) => postBtrip(tx, a, id, fx));
    expect(r.st.perDiem).toBe(13376.25);
    expect(await lines()).toEqual([['2411', 0, 13376.25], ['44001', 13376.25, 0]]);
  });
});
