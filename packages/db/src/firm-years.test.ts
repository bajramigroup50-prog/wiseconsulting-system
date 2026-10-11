import { PGlite } from '@electric-sql/pglite';
import { and, asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { firmActiveIn } from '@wise/core/firms/years';
import { firmFirstDataYear, firmFirstDataYears, firmInYearSql, firmListedIn } from './firm-years';
import * as schema from './schema/index';

const db = drizzle(new PGlite(), { schema });
const C26 = new Date('2026-10-11T08:00:00Z');
const id: Record<string, string> = {};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const add = async (k: string, v: Partial<typeof schema.firms.$inferInsert>) => {
    const [f] = await db.insert(schema.firms).values({ name: k, createdAt: C26, ...v }).returning();
    id[k] = f!.id;
  };
  await add('Нова 2026', { settings: { curYear: '2024', regDate: '2010-01-01' } });
  await add('Со налози 2024', {});
  await add('Со фактура 2025', {});
  await add('Од 2023', { settings: { fromYear: '2023' } });
  await add('Затворена 2024', { settings: { fromYear: '2020', toYear: '2024' } });
  await add('Архивирана', { active: false, settings: { fromYear: '2020' } });
  await add('Стара 2019', { createdAt: new Date('2019-05-01T10:00:00Z') });
  await db.insert(schema.journals).values({ firmId: id['Со налози 2024']!, date: '2024-03-15', kind: 'manual', number: '1021' });
  await db.insert(schema.journals).values({ firmId: id['Со налози 2024']!, date: '2026-01-01', kind: 'open', number: '1' });
  await db.insert(schema.invoices).values({ firmId: id['Со фактура 2025']!, kind: 'invoice', date: '2025-02-01', number: '1' });
}, 60_000);

const listed = async (y: number) => (await db.select({ name: schema.firms.name }).from(schema.firms).where(firmListedIn(y)).orderBy(asc(schema.firms.name))).map((r) => r.name).sort();

describe('firm working years in SQL (picker / list filter)', () => {
  it('2024 excludes firms entered in 2026 without older data, includes firms with 2024 journals', async () => {
    expect(await listed(2024)).toEqual(['Затворена 2024', 'Од 2023', 'Со налози 2024', 'Стара 2019'].sort());
  });
  it('2025: the invoice counts, the closed firm drops out', async () => {
    expect(await listed(2025)).toEqual(['Од 2023', 'Со налози 2024', 'Со фактура 2025', 'Стара 2019'].sort());
  });
  it('2026 lists every working firm, never the archived one', async () => {
    expect(await listed(2026)).toEqual(['Нова 2026', 'Од 2023', 'Со налози 2024', 'Со фактура 2025', 'Стара 2019'].sort());
    expect(await listed(2022)).toEqual(['Затворена 2024', 'Стара 2019'].sort());
  });
  it('first data year and the core rule agree with SQL', async () => {
    expect(await firmFirstDataYear(db, id['Со налози 2024']!)).toBe(2024);
    expect(await firmFirstDataYear(db, id['Со фактура 2025']!)).toBe(2025);
    expect(await firmFirstDataYear(db, id['Нова 2026']!)).toBeNull();
    const all = await db.select().from(schema.firms);
    for (const y of [2019, 2022, 2024, 2025, 2026, 2027]) {
      const sqlIds = new Set((await db.select({ id: schema.firms.id }).from(schema.firms).where(and(firmInYearSql(y)))).map((r) => r.id));
      for (const f of all) expect([f.name, y, sqlIds.has(f.id)]).toEqual([f.name, y, firmActiveIn(f, y, await firmFirstDataYear(db, f.id))]);
    }
  });
  it('firmFirstDataYears: earliest year per firm over journals and invoices', async () => {
    const M = await firmFirstDataYears(db);
    expect(M.get(id['Со налози 2024']!)).toBe(2024);
    expect(M.get(id['Со фактура 2025']!)).toBe(2025);
    expect(M.has(id['Нова 2026']!)).toBe(false);
    expect((await firmFirstDataYears(db, [id['Со фактура 2025']!])).size).toBe(1);
    expect((await firmFirstDataYears(db, [])).size).toBe(0);
  });
});
