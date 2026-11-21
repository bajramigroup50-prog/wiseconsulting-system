import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { importBeneficiaries, listBeneficiaries, mealLogsBetween, npoMovements, saveBeneficiary, setMeal, setMealsBulk } from './meals';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', userId = '', other = '';
const A = () => ({ firmId, userId, role: 'admin' });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Хуманитарно здружение Тест', edb: '4012024523759', vatRegistered: false, mods: ['meals'] }).returning();
  firmId = f!.id;
  const [g] = await db.insert(schema.firms).values({ name: 'Друга ДООЕЛ', edb: '4030000000012', vatRegistered: false, mods: [] }).returning();
  other = g!.id;
  const [u] = await db.insert(schema.users).values({ username: 'zdr', name: 'Здружение', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
}, 120_000);

describe('🍲 meals (db)', () => {
  it('imports the register, updates the same people on a second import', async () => {
    const r1 = await db.transaction((tx) => importBeneficiaries(tx, A(), [
      { no: 1, name: 'Ramush Emini', members: 5, embg: '1501968450045', place: 'Fushë Topane' },
      { no: 2, name: 'Zia Iseni', members: 3 },
    ]));
    expect(r1).toEqual({ added: 2, updated: 0 });
    const r2 = await db.transaction((tx) => importBeneficiaries(tx, A(), [
      { no: 1, name: 'Ramush Emini', members: 6, embg: '1501968450045' },
      { no: 3, name: 'Bislim Bakiu', members: 5 },
    ]));
    expect(r2).toEqual({ added: 1, updated: 1 });
    const L = await listBeneficiaries(db, firmId);
    expect(L.map((b) => b.name)).toEqual(['Ramush Emini', 'Zia Iseni', 'Bislim Bakiu']);
    expect(L[0]).toMatchObject({ members: 6, place: 'Fushë Topane' });
  });

  it('ticks and unticks meals once per day and kind; bulk for everyone; foreign ids are ignored', async () => {
    const [b1, b2] = await listBeneficiaries(db, firmId);
    await db.transaction((tx) => setMeal(tx, A(), b1!.id, '2026-11-20', 'l', true));
    await db.transaction((tx) => setMeal(tx, A(), b1!.id, '2026-11-20', 'l', true));
    await db.transaction((tx) => setMeal(tx, A(), b1!.id, '2026-11-20', 'd', true));
    await db.transaction((tx) => setMeal(tx, A(), b1!.id, '2026-11-20', 'd', false));
    let L = await mealLogsBetween(db, firmId, '2026-11-20', '2026-11-20');
    expect(L).toHaveLength(1);
    const n = await db.transaction((tx) => setMealsBulk(tx, A(), [b1!.id, b2!.id, '00000000-0000-0000-0000-000000000000'], '2026-11-20', 'l'));
    expect(n).toBe(2);
    L = await mealLogsBetween(db, firmId, '2026-11-01', '2026-11-30');
    expect(L.filter((x) => x.meal === 'l')).toHaveLength(2);
    const audits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId));
    expect(audits.some((x) => x.action === 'mealOn') && audits.some((x) => x.action === 'mealBulk')).toBe(true);
  });

  it('refuses a beneficiary of another firm, a bad ЕМБГ, and a client of a firm without the module', async () => {
    const [b1] = await listBeneficiaries(db, firmId);
    await expect(db.transaction((tx) => setMeal(tx, { firmId: other, userId, role: 'admin' }, b1!.id, '2026-11-20', 'b', true))).rejects.toThrow('не постои');
    await expect(db.transaction((tx) => saveBeneficiary(tx, A(), { name: 'X', members: 1, embg: '123' }))).rejects.toThrow('13 цифри');
    await expect(db.transaction((tx) => saveBeneficiary(tx, { firmId: other, userId, role: 'klient' }, { name: 'X', members: 1 }))).rejects.toThrow();
  });

  it('reads the movements of class 4 and 7 for the period, without opening / closing journals', async () => {
    const mk = async (date: string, kind: string, lines: [string, number, number][]) => {
      const [j] = await db.insert(schema.journals).values({ firmId, date, kind, number: kind + date }).returning();
      await db.insert(schema.journalLines).values(lines.map(([account, d, c], i) => ({ journalId: j!.id, firmId, lineNo: i + 1, account, debit: String(d), credit: String(c) })));
    };
    await mk('2026-11-05', 'vlez', [['400', 12000, 0], ['220', 0, 12000]]);
    await mk('2026-11-06', 'bank', [['100', 30000, 0], ['731', 0, 30000]]);
    await mk('2026-11-30', 'close', [['731', 30000, 0], ['400', 0, 12000], ['800', 0, 18000]]);
    await mk('2026-12-01', 'vlez', [['400', 5000, 0], ['220', 0, 5000]]);
    const M = await npoMovements(db, firmId, '2026-11-01', '2026-11-30');
    expect(M.map((x) => [x.account, x.debit, x.credit])).toEqual([['400', 12000, 0], ['731', 0, 30000]]);
  });
});
