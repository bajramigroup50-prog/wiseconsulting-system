/**
 * „Преглед на внес по месеци“ (PGlite): booked invoices, unsaved reads, imported journals with VAT, statements per
 * account, and the warnings — invoices + imported VAT in one month (possible double entry), unsaved reads, a month
 * without a statement between two with, a month without sales before the last one with sales.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saveBankAccount } from './bank/index';
import { entryOverview } from './entry-overview';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadVatPostingContext } from './vat-context';
import { vatAccountRoles } from './vat-source';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (tx: DB) => Promise<R>) => db.transaction((tx) => f(tx as unknown as DB));
let firm: schema.Firm, cust = '', acct = '', out18 = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'ПРЕГЛЕД ВНЕС ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning() as [schema.Firm];
  cust = (await db.insert(schema.partners).values({ firmId: firm.id, name: 'Купувач', code: '1' }).returning())[0]!.id;
  out18 = [...vatAccountRoles(await loadVatPostingContext(db as never, firm))].find(([, r]) => r.kind === 'out' && r.rate === 18)![0];
  acct = await T((tx) => saveBankAccount(tx, { firmId: firm.id, userId: null, input: { name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000' } }));
  // sales: January (invoice), March (invoice + an imported nalog with output VAT → possible double), May (import only)
  await db.insert(schema.invoices).values([
    { firmId: firm.id, kind: 'invoice', number: 'F-1', date: '2026-01-10', partnerId: cust, base: '1000', vat: '180', total: '1180' },
    { firmId: firm.id, kind: 'invoice', number: 'F-2', date: '2026-03-10', partnerId: cust, base: '2000', vat: '360', total: '2360' },
  ]);
  for (const [date, n] of [['2026-03-31', '1'], ['2026-05-31', '2']] as const) {
    await T((tx) => postJournal(tx as never, { firmId: firm.id, date, kind: 'manual', number: 'У' + n, description: 'Увезен налог', sourceType: 'import', sourceId: 'b:' + n, userId: null,
      lines: [{ account: '1200', debit: 1180, partnerId: cust }, { account: '7400', credit: 1000 }, { account: out18, credit: 180 }] }));
  }
  // a read sale of June, not saved (to check), and one held in a past period
  await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind: 'sale', status: 'done', drafts: [
    { draft: { number: 'S-1', date: '2026-06-02' }, status: 'check', msg: '' },
    { draft: { number: 'S-2', date: '2026-06-03' }, status: 'past', msg: '' },
    { draft: { number: 'S-3', date: '2026-06-04' }, status: 'ok', msg: '', savedId: 'x' },
  ] as never });
  // statements in January and March, none in February
  for (const date of ['2026-01-15', '2026-03-15']) await db.insert(schema.bankStatements).values({ firmId: firm.id, bankAccountId: acct, date });
}, 120_000);

describe('entry overview by month', () => {
  it('counts and warnings', async () => {
    const O = await T((tx) => entryOverview(tx, firm, 2026));
    const M = (m: number) => O.months[m - 1]!;
    expect(O.accounts.map((a) => a.name)).toEqual(['Халк']);
    expect(M(1)).toMatchObject({ sales: { n: 1, vat: 180, total: 1180 }, bank: { [acct]: 1 }, warn: [] });
    expect(M(2).warn).toEqual(['bankGap', 'noSales']);
    expect(M(3)).toMatchObject({ sales: { n: 1, vat: 360 }, imported: { n: 1, outVat: 180, inVat: 0 } });
    expect(M(3).warn).toEqual(['dupOut']);
    expect(M(4).warn).toEqual(['noSales']);
    expect(M(5)).toMatchObject({ sales: { n: 0 }, imported: { n: 1, outVat: 180 }, warn: [] });
    expect(M(6)).toMatchObject({ scanSales: { ready: 0, check: 1, held: 1 }, warn: ['scans'] });
    expect(M(12).warn).toEqual([]);
  });
});
