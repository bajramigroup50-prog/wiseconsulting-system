/**
 * A customer kept on 1200009 in the books (чл. 24 exempt sales, imported nalozi) is paid on 1200009, never split to
 * 1200; a customer with lines on 1200 keeps 1200 (PGlite).
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saveBankAccount, statementSuggestions } from './bank/index';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (tx: DB) => Promise<R>) => db.transaction((tx) => f(tx as unknown as DB));
let firmId = '', acct = '', ex = '', dom = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Конто ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([
    { firmId, name: 'АПТИВ СЕРВИСЕС МАКЕДОНИЈА ДООЕЛ', code: '1' },
    { firmId, name: 'ДОМАШЕН КУПУВАЧ ДООЕЛ', code: '2' },
  ]).returning();
  ex = P[0]!.id; dom = P[1]!.id;
  acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000' } }));
  await T((tx) => postJournal(tx as never, { firmId, date: '2026-03-01', kind: 'manual', number: 'У1', description: 'Увезен налог', sourceType: 'import', sourceId: 'b:1', userId: null,
    lines: [{ account: '1200009', debit: 10400, partnerId: ex }, { account: '7400', credit: 10400 }, { account: '1200', debit: 5000, partnerId: dom }, { account: '7400', credit: 5000 }] }));
}, 120_000);

describe('a customer kept on 1200009', () => {
  it('its payment without an open document is proposed on 1200009; a domestic customer stays on 1200', async () => {
    const [st] = await db.insert(schema.bankStatements).values({ firmId, bankAccountId: acct, date: '2026-07-15' }).returning();
    const L = await db.insert(schema.bankLines).values([
      { firmId, statementId: st!.id, bankAccountId: acct, lineNo: 1, date: '2026-07-15', amount: '10400.00', name: 'АПТИВ СЕРВИСЕС МАКЕДОНИЈА ДООЕЛ', description: 'АПТИВ СЕРВИСЕС МАКЕДОНИЈА ДООЕЛ уплата', dupKey: 'a' },
      { firmId, statementId: st!.id, bankAccountId: acct, lineNo: 2, date: '2026-07-15', amount: '5000.00', name: 'ДОМАШЕН КУПУВАЧ ДООЕЛ', description: 'ДОМАШЕН КУПУВАЧ ДООЕЛ уплата', dupKey: 'b' },
    ]).returning();
    const S = await T((tx) => statementSuggestions(tx as never, firmId, [st!.id]));
    expect(S.get(L[0]!.id)).toMatchObject({ konto: '1200009', partnerId: ex });
    expect(S.get(L[1]!.id)).toMatchObject({ konto: '1200', partnerId: dom });
  });
});
