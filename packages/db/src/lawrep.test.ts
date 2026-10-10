import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { lawReview, lawReviewFirms, loadLawReviewInput } from './lawrep';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firm: typeof schema.firms.$inferSelect;
let office = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = (await db.insert(schema.firms).values({ name: 'Преглед ДООЕЛ', vatRegistered: true, settings: { kasaCash: '1020' } }).returning()) as [typeof firm];
  const [o] = await db.insert(schema.firms).values({ name: 'Канцеларија', settings: { officeFirm: true } }).returning();
  office = o!.id;
  await db.transaction((tx) => postJournal(tx, { firmId: firm.id, date: '2026-03-10', kind: 'manual', lines: [{ account: '4440', debit: 10000 }, { account: '1020', credit: 10000 }], userId: null }));
  await db.transaction((tx) => postJournal(tx, { firmId: firm.id, date: '2026-03-11', kind: 'manual', lines: [{ account: '1020', debit: 500000 }, { account: '7400', credit: 500000 }], userId: null }));
  await db.transaction((tx) => postJournal(tx, { firmId: firm.id, date: '2025-05-11', kind: 'manual', lines: [{ account: '1020', debit: 300 }, { account: '7400', credit: 300 }], userId: null }));
}, 60_000);

describe('preliminary tax review inputs', () => {
  it('ledger of the year, account names, previous-year revenue, unfiled VAT periods', async () => {
    const x = await loadLawReviewInput(db, firm, 2026, '2026-10-10');
    expect(x.lines).toHaveLength(4);
    expect(x.accName['4440']).toMatch(/репрезентација/);
    expect(x.prevRev74).toBe(300);
    expect(x.vatMissing.map((v) => v.p)).toEqual(['2026-Т2', '2026-Т1']);
    expect(x.profit).toBe(490000);
    expect(x.cashAccounts).toEqual(['1020']);
  });
  it('runs the rules on the books', async () => {
    const X = await lawReview(db, firm, 2026, '2026-10-10');
    const p = X.R.find((r) => r.r.id === 'p_repr')!;
    expect([p.s, p.amt]).toEqual(['warn', 900]);
    expect(X.R.find((r) => r.r.id === 'v_late')!.s).toBe('bad');
  });
  it('the all-firms run skips the office firm', async () => {
    expect((await lawReviewFirms(db, [firm.id, office])).map((f) => f.id)).toEqual([firm.id]);
    expect((await db.select().from(schema.firms).where(eq(schema.firms.id, office))).length).toBe(1);
  });
});
