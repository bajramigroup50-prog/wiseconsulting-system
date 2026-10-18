/**
 * „запомни правило“ inside a bank nalog (PGlite): a konto corrected on a statement line of the nalog teaches the bank rule
 * of that line (description and payment code), as „Директно на конто“ in Банка does; without the option nothing is learned;
 * a partner konto (12x / 22x) teaches no description rule.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { postStatement, saveBankAccount } from './bank/index';
import { journalOverrideState, saveJournalOverride } from './journal-override-save';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (tx: DB) => Promise<R>) => db.transaction((tx) => f(tx as unknown as DB));
let firmId = '', acct = '';

const rules = async () => (await db.select().from(schema.bankRules).where(eq(schema.bankRules.firmId, firmId)))
  .map((r) => [r.kind, r.match, r.konto, r.learned]).sort();

/** A posted statement with one outflow „ЕВН …“ booked to 4020; returns its journal id. */
async function statement(dupKey: string, date: string): Promise<string> {
  const [st] = await db.insert(schema.bankStatements).values({ firmId, bankAccountId: acct, date, number: dupKey }).returning();
  await db.insert(schema.bankLines).values({ firmId, statementId: st!.id, bankAccountId: acct, lineNo: 1, date, amount: '-1500.00',
    description: 'ЕВН ХОМ ДООЕЛ СКОПЈЕ', osnov: '221', konto: '4020', dupKey });
  await T((tx) => postStatement(tx, st!.id, null));
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'bank_statement'), eq(schema.journals.sourceId, st!.id)));
  return j!.id;
}
const correct = async (journalId: string, konto: string, learn: boolean) => {
  const st = await T((tx) => journalOverrideState(tx, firmId, journalId));
  const rows = st.rows!.map((r) => (r.account === '4020' ? { ...r, account: konto } : r));
  return T((tx) => saveJournalOverride(tx, { firmId, journalId, rows, userId: null, learn }));
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Правила ДООЕЛ' }).returning();
  firmId = f!.id;
  acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халк', account: '270077299520174', cur: 'MKD', konto: '1000' } }));
}, 60_000);

describe('запомни правило in a bank nalog', () => {
  it('without the option the correction teaches nothing', async () => {
    const j = await statement('s1', '2026-08-05');
    expect((await correct(j, '4030', false)).learned).toEqual([]);
    expect(await rules()).toEqual([]);
  });

  it('with the option a changed konto teaches the description and payment-code rules of its statement line', async () => {
    const j = await statement('s2', '2026-08-06');
    const r = await correct(j, '4030', true);
    expect(r.learned.length).toBe(2);
    const R = await rules();
    expect(R.find((x) => x[0] === 'desc')).toMatchObject(['desc', expect.any(String), '4030', true]);
    expect(R.find((x) => x[0] === 'osnov')).toEqual(['osnov', '221|out', '4030', true]);
    // the nalog line itself is corrected
    const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j));
    expect(L.map((l) => l.account).sort()).toEqual(['1000', '4030']);
  });

  it('a partner konto teaches no description rule', async () => {
    const before = await rules();
    const j = await statement('s3', '2026-08-07');
    const st = await T((tx) => journalOverrideState(tx, firmId, j));
    const [p] = await db.insert(schema.partners).values({ firmId, name: 'ЕВН', code: '9' }).returning();
    const rows = st.rows!.map((r) => (r.account === '4020' ? { ...r, account: '2200', partnerId: p!.id } : r));
    const r = await T((tx) => saveJournalOverride(tx, { firmId, journalId: j, rows, userId: null, learn: true }));
    expect(r.learned).toEqual([]);
    expect(await rules()).toEqual(before);
  });
});
