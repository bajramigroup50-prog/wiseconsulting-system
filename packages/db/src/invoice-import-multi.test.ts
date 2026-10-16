/**
 * OUTGOING invoices from Excel / CSV („Излезни фактури (ставки)“, one row per line): every invoice is registered
 * separately — one invoice = number + date + buyer, each with its own lines and journal; rows of another invoice that
 * happens to share a number are never merged into it; the same file again is skipped as duplicates (never a second
 * copy with a new number). Synthetic data.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { importRows } from './retail-items';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '';
const A = () => ({ firmId, userId: null, role: 'admin' });
const O = { date: '2026-10-01', today: '2026-10-16' };

const ROWS = [
  { number: '0201/2026', date: '2026-10-01', partner: 'КУПУВАЧ ЕДЕН ДООЕЛ', edb: '4030999000101', item: 'Стока А', qty: 2, price: 100, rate: 18 },
  { number: '0201/2026', date: '2026-10-01', partner: 'КУПУВАЧ ЕДЕН ДООЕЛ', edb: '4030999000101', item: 'Стока Б', qty: 1, price: 300, rate: 18 },
  { number: '0202/2026', date: '2026-10-02', partner: 'КУПУВАЧ ДВА ДОО', edb: '4030999000202', item: 'Услуга', qty: 4, price: 50, rate: 5 },
  { number: '0203/2026', date: '2026-10-03', partner: 'КУПУВАЧ ТРИ ДООЕЛ', edb: '4030999000303', item: 'Стока В', qty: 1, price: 1000, rate: 10 },
];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'НАША ФИРМА ДОО', edb: '4030000000001' }).returning())[0]!.id;
}, 60_000);

describe('Excel import of issued invoices', () => {
  it('3 invoices (one with two lines) → 3 invoices, each with its own number, date, buyer, total and journal', async () => {
    const r = await tx((t) => importRows(t, A(), 'invoices', ROWS, O));
    expect(r).toMatchObject({ add: 3, skip: [] });
    const I = await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, firmId)).orderBy(asc(schema.invoices.number));
    expect(I.map((x) => [x.number, x.date, Number(x.total)])).toEqual([['0201/2026', '2026-10-01', 590], ['0202/2026', '2026-10-02', 210], ['0203/2026', '2026-10-03', 1100]]);
    expect(new Set(I.map((x) => x.partnerId)).size).toBe(3);
    const J = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), inArray(schema.journals.sourceId, I.map((x) => x.id))));
    expect(J).toHaveLength(3);
  });

  it('the same file again: every invoice skipped as already entered (no copy with a new number)', async () => {
    const r = await tx((t) => importRows(t, A(), 'invoices', ROWS, O));
    expect(r.add).toBe(0);
    expect(r.skip).toHaveLength(3);
    expect(r.skip[0]).toMatch(/0201\/2026 од 2026-10-01: веќе е внесена/);
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, firmId))).toHaveLength(3);
  });

  it('two invoices with the same number (other date / buyer) are never merged: both reported, none imported', async () => {
    const r = await tx((t) => importRows(t, A(), 'invoices', [
      { number: '0300/2026', date: '2026-10-05', partner: 'КУПУВАЧ ЕДЕН ДООЕЛ', edb: '4030999000101', item: 'Х', qty: 1, price: 100, rate: 18 },
      { number: '0300/2026', date: '2026-10-06', partner: 'КУПУВАЧ ДВА ДОО', edb: '4030999000202', item: 'Y', qty: 1, price: 900, rate: 18 },
      { number: '0301/2026', date: '2026-10-06', partner: 'КУПУВАЧ ДВА ДОО', edb: '4030999000202', item: 'Z', qty: 1, price: 50, rate: 18 },
    ], O));
    expect(r.add).toBe(1);
    expect(r.skip.filter((s) => /0300\/2026 .* истиот број е за повеќе фактури/.test(s))).toHaveLength(2);
    const I = await db.select().from(schema.invoices).where(and(eq(schema.invoices.firmId, firmId), inArray(schema.invoices.number, ['0300/2026', '0301/2026'])));
    expect(I.map((x) => [x.number, Number(x.total)])).toEqual([['0301/2026', 59]]);
  });
});
