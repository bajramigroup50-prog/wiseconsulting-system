/**
 * Re-importing a corrected statement (PGlite): duplicates are counted — a file with one more identical line (same
 * account, date, amount, description) than the books imports the surplus; it was skipped as a duplicate of the line
 * already imported.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Statement } from '@wise/core';
import { ledgerOpenItemsSource, planImport, saveBankAccount, saveImport, setOpenItemsSource } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', mkd = '';
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const line = (amount: number, desc: string) => ({ date: '2026-02-10', amount, counterparty: '', ref: '', purpose: '', desc });
const st = (lines: Statement['lines']): Statement => ({ format: 'table', account: '', no: '', date: '2026-02-10', currency: '', opening: null, closing: null, debit: null, credit: null, lines });

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Дупликати ДООЕЛ' }).returning())[0]!.id;
  mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', cur: 'MKD', konto: '100077' } }));
}, 60_000);

describe('duplicate lines by multiplicity', () => {
  it('the corrected statement has the fee twice: the second one is imported, the first stays a duplicate', async () => {
    const r1 = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [st([line(-50, 'Провизија'), line(1000, 'Уплата')])], defaultAccountId: mkd }));
    expect(r1.lines).toBe(2);
    const fixed = st([line(-50, 'Провизија'), line(-50, 'Провизија'), line(1000, 'Уплата')]);
    const plan = await T((tx) => planImport(tx, { firmId, userId: null, statements: [fixed], defaultAccountId: mkd }));
    expect(plan.days[0]!.lines.map((l) => l.dup)).toEqual([true, false, true]);
    expect(plan.days[0]!.allDup).toBe(false);
    const r2 = await T((tx) => saveImport(tx, { firmId, userId: null, statements: [fixed], defaultAccountId: mkd }));
    expect([r2.lines, r2.skipped]).toEqual([1, 2]);
    const L = await db.select().from(schema.bankLines).where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.description, 'Провизија')));
    expect(L).toHaveLength(2);
    // the same file again: everything is a duplicate now
    const again = await T((tx) => planImport(tx, { firmId, userId: null, statements: [fixed], defaultAccountId: mkd }));
    expect(again.days[0]!.allDup).toBe(true);
  });
});
