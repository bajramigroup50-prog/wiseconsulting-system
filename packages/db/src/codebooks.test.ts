import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { codebookCounts, codeUsage, CodebookError, deleteCode, listCodebook, saveCode, seedCities, seedPaySif } from './codebooks';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', other = '', userId = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Фирма А' }).returning();
  const [g] = await db.insert(schema.firms).values({ name: 'Фирма Б' }).returning();
  firmId = f!.id; other = g!.id;
  const [u] = await db.insert(schema.users).values({ username: 'ana', name: 'Ана', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
}, 60_000);

describe('codebook service', () => {
  it('saves firm rows with audit, refuses duplicate codes with the next free code', async () => {
    const id = await saveCode(db, { userId, firmId, k: 'warehouse', input: { code: '01', name: 'Магацин 1', data: { konto: '6600' } } });
    await saveCode(db, { userId, firmId: other, k: 'warehouse', input: { code: '01', name: 'Друга фирма', data: {} } });
    await expect(saveCode(db, { userId, firmId, k: 'warehouse', input: { code: '01', name: 'Дупликат', data: {} } }))
      .rejects.toThrow('Шифрата 01 веќе ја има „Магацин 1“. Следна слободна: 02');
    await saveCode(db, { userId, firmId, k: 'warehouse', id, input: { code: '01', name: 'Магацин Центар', data: {} } });
    const L = await listCodebook(db, 'warehouse', firmId);
    expect(L.map((r) => [r.code, r.name, r.global])).toEqual([['01', 'Магацин Центар', false]]);
    const A = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id)));
    expect(A.map((a) => a.action).sort()).toEqual(['cbNew', 'cbSave']);
  });

  it('cannot edit another firm\'s row', async () => {
    const [r] = (await listCodebook(db, 'warehouse', other));
    await expect(saveCode(db, { userId, firmId, k: 'warehouse', id: r!.id, input: { code: '09', name: 'X', data: {} } })).rejects.toBeInstanceOf(CodebookError);
  });

  it('office-wide lists: cities are global and seeded; firm lists show the office-wide rows too', async () => {
    const cities = await listCodebook(db, 'city', firmId);
    expect(cities.length).toBeGreaterThan(20);
    expect(cities.every((c) => c.global)).toBe(true);
    expect(await seedCities(db, userId)).toBe(0);
    const cur = await listCodebook(db, 'currency', firmId);
    expect(cur.some((c) => c.code === 'EUR' && c.global)).toBe(true);
    const n = await codebookCounts(db, firmId);
    expect(n.warehouse).toBe(1);
    expect(n.city).toBe(cities.length);
  });

  it('refuses to delete a code used by documents (legacy cbUsage), deletes an unused one', async () => {
    const [wh] = await listCodebook(db, 'warehouse', firmId);
    const [it] = await db.insert(schema.items).values({ firmId, name: 'Артикл' }).returning();
    await db.insert(schema.stockMoves).values({ firmId, itemId: it!.id, locationId: wh!.id, date: '2026-01-05', qty: '1', value: '10', direction: 'in', kind: 'in', sourceType: 'opening', sourceId: 'x' } as typeof schema.stockMoves.$inferInsert);
    expect(await codeUsage(db, wh!.id)).toEqual({ stock_moves: 1 });
    expect(await deleteCode(db, { userId, firmId, id: wh!.id })).toBe('„Магацин Центар“ не може да се избрише – се користи во 1 магацински движења.');
    const oe = await saveCode(db, { userId, firmId, k: 'oe', input: { code: '1', name: 'Продажба', data: {} } });
    expect(await deleteCode(db, { userId, firmId, id: oe })).toBeNull();
    expect(await listCodebook(db, 'oe', firmId)).toEqual([]);
  });

  it('copies the standard payroll codes into the firm list once', async () => {
    const n = await seedPaySif(db, { userId, firmId });
    expect(n).toBeGreaterThan(30);
    expect(await seedPaySif(db, { userId, firmId })).toBe(0);
  });
});
