import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { createReceipt, markReceiptReturned, receiptById, PriemError } from './priem';
import type { Tx } from './audit';

const pg = drizzle(new PGlite(), { schema });
const db = pg as unknown as Tx;
let A = '', B = '';
beforeAll(async () => {
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  const F = await pg.insert(schema.firms).values([{ name: 'ПРВА ДООЕЛ' }, { name: 'ВТОРА ДООЕЛ' }] as never).returning({ id: schema.firms.id });
  A = F[0]!.id; B = F[1]!.id;
}, 60_000);

describe('doc receipts', () => {
  it('one numbering for the whole office per year, from 1 again in a new year', async () => {
    const r1 = await createReceipt(db, { firmId: A, period: '2026-09', items: [{ k: 'in', n: 3 }], at: new Date('2026-10-20T08:00:00Z') }, null);
    const r2 = await createReceipt(db, { firmId: B, period: '2026-09', items: [{ k: 'out', n: 2 }], at: new Date('2026-10-20T09:00:00Z') }, null);
    const r3 = await createReceipt(db, { firmId: A, period: '2026-12', items: [{ k: 'in', n: 1 }], at: new Date('2027-01-02T09:00:00Z') }, null);
    expect([r1.no, r2.no, r3.no]).toEqual([1, 2, 1]);
    expect([r1.year, r3.year]).toEqual([2026, 2027]);
    const v = await receiptById(db, r2.id);
    expect(v).toMatchObject({ firmName: 'ВТОРА ДООЕЛ', keepUntil: '2031-12-31' });
  });
  it('refuses an empty receipt; returned once', async () => {
    await expect(createReceipt(db, { firmId: A, period: '2026-09', items: [] }, null)).rejects.toBeInstanceOf(PriemError);
    const r = await createReceipt(db, { firmId: A, period: '2026-10', items: [{ k: 'bank', n: 1 }] }, null);
    await markReceiptReturned(db, r.id, 'Петар', null);
    await expect(markReceiptReturned(db, r.id, 'Петар', null)).rejects.toBeInstanceOf(PriemError);
  });
});
