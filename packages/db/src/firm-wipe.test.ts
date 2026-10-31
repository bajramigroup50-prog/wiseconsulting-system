/**
 * „Избриши ги сите документи и книжења за годината“ (PGlite): the year's postings, statements and their lines go, the
 * other year and the firm stay, partners used nowhere any more are deleted, a locked period is refused.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { addManualLine, ledgerOpenItemsSource, saveBankAccount, setOpenItemsSource } from './bank/index';
import { firmYearWipePlan, wipeFirmYear } from './firm-wipe';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
let firmId = '', p26 = '', p25 = '';

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Бришење Година ДООЕЛ' }).returning())[0]!.id;
  [p26, p25] = (await db.insert(schema.partners).values([{ firmId, name: 'Само 2026 ДОО' }, { firmId, name: 'И 2025 ДОО' }]).returning()).map((p) => p.id) as [string, string];
  const acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: '250000000444444', cur: 'MKD', konto: '100077' } }));
  await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: acct, date: '2026-03-10', amount: 500, desc: 'уплата', konto: '1200', partnerId: p26 } as never));
  await T((tx) => postJournal(tx as never, { firmId, date: '2026-05-05', kind: 'manual', userId: null, lines: [{ account: '4400', debit: 100 }, { account: '2200', credit: 100, partnerId: p26 }] }));
  await T((tx) => postJournal(tx as never, { firmId, date: '2025-05-05', kind: 'manual', userId: null, lines: [{ account: '4400', debit: 70 }, { account: '2200', credit: 70, partnerId: p25 }] }));
}, 60_000);

describe('wipe one year of one firm', () => {
  it('shows what will go, deletes the year only, removes partners used nowhere', async () => {
    const plan = await T((tx) => firmYearWipePlan(tx, firmId, 2026));
    expect(plan.counts.bank_statements).toBe(1);
    expect(plan.counts.journals).toBeGreaterThanOrEqual(2);
    const r = await T((tx) => wipeFirmYear(tx, { firmId, year: 2026, userId: null }));
    expect(r.partners).toBe(1);
    const J = await db.select({ date: schema.journals.date }).from(schema.journals).where(eq(schema.journals.firmId, firmId));
    expect(J.map((j) => j.date)).toEqual(['2025-05-05']);
    expect(await db.select().from(schema.bankLines).where(eq(schema.bankLines.firmId, firmId))).toHaveLength(0);
    const P = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.firmId, firmId));
    expect(P.map((p) => p.id)).toEqual([p25]);
    expect(await db.select().from(schema.firms).where(eq(schema.firms.id, firmId))).toHaveLength(1);
    expect((await T((tx) => firmYearWipePlan(tx, firmId, 2026))).total).toBe(0);
  });

  it('a locked year is refused', async () => {
    await db.update(schema.firms).set({ lockDate: '2025-12-31' }).where(eq(schema.firms.id, firmId));
    await expect(T((tx) => wipeFirmYear(tx, { firmId, year: 2025, userId: null }))).rejects.toThrow(/заклучен/);
    expect(await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId)))).toHaveLength(1);
  });
});
