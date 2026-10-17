/**
 * A customer payment of an invoice posted on 1200009 (exempt чл. 24 / чл. 32-а receivable) is booked on 1200009, not
 * 1200 — linked by the invoice number, and proposed there for the partner even without a document (PGlite, ledger
 * open items, synthetic data).
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement } from '@wise/core';
import { applyMatches, ledgerOpenItemsSource, proposeMatches, saveBankAccount, saveImport, setOpenItemsSource, statementSuggestions } from './bank/index';
import { postJournal } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const ACC = '300000000123420';
let firmId = '', gama = '';

const st = (date: string, no: string, amount: number, purpose: string): Statement => ({
  format: 'table', account: ACC, no, date, currency: 'MKD', opening: null, closing: null, debit: null, credit: null,
  lines: [{ date, amount, counterparty: 'Гама ДОО', ref: '', purpose, desc: `Гама ДОО – ${purpose}` }],
});
const sum1200009 = async () => {
  const L = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, '1200009')));
  return L.reduce((s, l) => s + Math.round((Number(l.debit) - Number(l.credit)) * 100), 0);
};

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Тест Извоз ДООЕЛ' }).returning())[0]!.id;
  gama = (await db.insert(schema.partners).values({ firmId, name: 'Гама ДОО', code: '7' }).returning())[0]!.id;
  await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Комерцијална', account: ACC, cur: 'MKD', konto: '1000' } }));
  for (const [n, amt] of [['31/2026', 50_000], ['32/2026', 20_000]] as const) {
    await T((tx) => postJournal(tx, { firmId, date: '2026-03-01', kind: 'izlez', userId: null, sourceType: 'test', sourceId: 'inv' + n,
      lines: [{ account: '1200009', debit: amt, partnerId: gama, doc: n }, { account: '7400', credit: amt }] }));
  }
}, 120_000);

describe('payments of invoices on 1200009', () => {
  it('linked by the invoice number → booked on 1200009; the open item closes', async () => {
    await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st('2026-03-10', '1', 5_000_000, 'Плаќање фактура 31/2026')] }));
    const P = await T((tx) => proposeMatches(tx, firmId, 2026));
    expect(P).toHaveLength(1);
    expect(P[0]).toMatchObject({ konto: '1200009', partnerId: gama, refLabel: '31/2026' });
    await T((tx) => applyMatches(tx, { firmId, userId: null, year: 2026, accept: P.map((p) => p.lineId) }));
    expect(await sum1200009()).toBe(2_000_000); // 50.000 + 20.000 − 50.000
  });

  it('a payment of the partner without a document is proposed on 1200009 (where its open items are)', async () => {
    const r = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st('2026-03-12', '2', 700_000, 'аванс')] }));
    const S = await T((tx) => statementSuggestions(tx, firmId, r.statementIds!));
    expect([...S.values()][0]).toMatchObject({ konto: '1200009', partnerId: gama });
  });
});
