/** „Избриши ги сите изводи“: bulk delete of statements by account and date range (synthetic data, PGlite). */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { addManualLine, bulkDeleteStatements, bulkDeleteStatementsPlan, ledgerOpenItemsSource, saveBankAccount, setOpenItemsSource } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
let firmId = '';
let a1 = '';
let a2 = '';

const line = (acct: string, date: string, amount: number, konto?: string) =>
  T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: acct, date, amount, desc: 'тест ставка', konto: konto ?? null }));
const stOf = (acct: string) => db.select().from(schema.bankStatements).where(eq(schema.bankStatements.bankAccountId, acct));
const bankJournals = () => db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, 'bank_statement')));

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Тест Бришење ДООЕЛ' }).returning();
  firmId = f!.id;
  a1 = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Банка А', account: '300000000111111', cur: 'MKD', konto: '1000' } }));
  a2 = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Банка Б', account: '210000000222222', cur: 'MKD', konto: '1001' } }));
  // account A: Jan 10 posted (+1000 / −200), Feb 5 draft (−300, no konto), Mar 1 posted (+50); Dec 2025 outside the range
  await line(a1, '2026-01-10', 1000, '7400');
  await line(a1, '2026-01-10', -200, '4020');
  await line(a1, '2026-02-05', -300);
  await line(a1, '2026-03-01', 50, '7400');
  await line(a1, '2025-12-30', 10, '7400');
  // account B: one posted statement in the range
  await line(a2, '2026-02-10', 400, '7400');
}, 60_000);

describe('bulk delete of statements', () => {
  it('preview: counts per account, first/last number and date, inflow/outflow, posted', async () => {
    const p = await T((tx) => bulkDeleteStatementsPlan(tx, { firmId, accountIds: [a1, a2], from: '2026-01-01', to: '2026-12-31' }));
    expect(p.total).toBe(4);
    expect(p.posted).toBe(3);
    expect(p.skipped).toEqual([]);
    const A = p.accounts.find((x) => x.accountId === a1)!;
    const S = (await stOf(a1)).filter((s) => s.date >= '2026-01-01').sort((x, y) => x.date.localeCompare(y.date));
    expect(A).toMatchObject({ count: 3, posted: 2, firstDate: '2026-01-10', lastDate: '2026-03-01', firstNo: S[0]!.number, lastNo: S[2]!.number, inflow: 1050, outflow: 500, lines: 4 });
    expect(p.accounts.find((x) => x.accountId === a2)).toMatchObject({ count: 1, posted: 1, inflow: 400, outflow: 0 });
  });

  it('locked period / locked nalog are skipped and listed; the rest of the account is deleted, the other account untouched', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    const [mar] = (await stOf(a1)).filter((s) => s.date === '2026-03-01');
    await db.update(schema.journals).set({ locked: true }).where(and(eq(schema.journals.sourceType, 'bank_statement'), eq(schema.journals.sourceId, mar!.id)));
    const before = (await bankJournals()).length;
    const auditBefore = (await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'delStatements'))).length;

    const r = await T((tx) => bulkDeleteStatements(tx, { firmId, userId: null, accountIds: [a1], from: '2026-01-01', to: '2026-12-31' }));
    expect(r.total).toBe(1);
    expect(r.skipped.map((s) => s.date).sort()).toEqual(['2026-01-10', '2026-03-01']);
    const left = (await stOf(a1)).map((s) => s.date).sort();
    expect(left).toEqual(['2025-12-30', '2026-01-10', '2026-03-01']);
    expect((await stOf(a2)).length).toBe(1);
    // the draft had no journal → journals unchanged; the audit is one row
    expect((await bankJournals()).length).toBe(before);
    const aud = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'delStatements'));
    expect(aud.length).toBe(auditBefore + 1);
    expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'delStatement'))).length).toBe(0);

    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
    await db.update(schema.journals).set({ locked: false }).where(eq(schema.journals.sourceId, mar!.id));
  });

  it('deletes all statements of an account in the range, posted ones with their journals; other account untouched', async () => {
    const r = await T((tx) => bulkDeleteStatements(tx, { firmId, userId: null, accountIds: [a1], from: '2026-01-01', to: '2026-12-31' }));
    expect(r).toMatchObject({ total: 2, posted: 2, skipped: [] });
    expect((await stOf(a1)).map((s) => s.date)).toEqual(['2025-12-30']);
    const J = await bankJournals();
    const ids = new Set([...(await stOf(a1)), ...(await stOf(a2))].map((s) => s.id));
    expect(J.every((j) => ids.has(j.sourceId!))).toBe(true);
    expect(J.length).toBe(2);
    expect((await stOf(a2)).length).toBe(1);
    expect((await db.select().from(schema.bankLines).where(eq(schema.bankLines.bankAccountId, a1))).length).toBe(1);
  });
});
