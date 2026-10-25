/**
 * МПИН payments on a statement (PGlite): one line per part with шифра 843 (придонеси) / 840 (данок). Each part goes to its
 * own liability konto as the payroll books it (ПИО 2341, здравство 2342, дополнително 2343, вработување 2344, данок 2340),
 * never all on the shared 2349 — „Придонеси по вид“ moves the lines already booked there and re-posts the statement.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { learnOsnov, mpinPartKonto, payrollPartOf } from '@wise/core';
import { addManualLine, applyContribFix, contribFixPlan, ledgerOpenItemsSource, repairContribLines, saveBankAccount, setOpenItemsSource } from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const PARTS = [['Penziski', -6775, '843'], ['Zdravstvo', -2703, '843'], ['0.5% dodatno', -180, '843'], ['Vrabotuvanje', -432, '843'], ['Danok', -1502, '840']] as const;

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Плати ДООЕЛ' }).returning())[0]!.id;
  const acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: '250000000333333', cur: 'MKD', konto: '100077' } }));
  // as read before: every contribution on 2349, the tax on 2340
  for (const [name, amount, osnov] of PARTS) {
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: acct, date: '2026-02-26', amount, desc: name, konto: osnov === '840' ? '2340' : '2349' }));
    await db.update(schema.bankLines).set({ osnov, name, purpose: '9102026014061263551195++0+0126-1-36037' })
      .where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.description, name)));
  }
}, 60_000);

describe('МПИН payments by part', () => {
  it('the part is read from the line and its konto comes from the payroll scheme', () => {
    expect(PARTS.map(([n]) => payrollPartOf(n))).toEqual(['pio', 'zdr', 'dop', 'vrab', 'tax']);
    expect(PARTS.map(([n, a, osnov]) => mpinPartKonto({ osnov, amount: a, desc: n }))).toEqual(['2341', '2342', '2343', '2344', '2340']);
    expect(mpinPartKonto({ osnov: '843', amount: -100, desc: 'Penziski' }, { pay_pio: '2410' })).toBe('2410');
    expect(mpinPartKonto({ osnov: '843', amount: -100, desc: 'уплата' })).toBe('');
    expect(mpinPartKonto({ osnov: '930', amount: -100, desc: 'Penziski' })).toBe('');
    // the shared code never becomes a rule for one konto
    expect(learnOsnov({}, { id: '', date: '', amount: -6775, desc: 'Penziski', osnov: '843', konto: '2349' })).toBeNull();
  });

  it('the autopilot repairs it by itself (a firm without such lines is not touched)', async () => {
    expect(await T((tx) => repairContribLines(tx, 2026, ['00000000-0000-0000-0000-000000000000']))).toBe(0);
    expect(await T((tx) => repairContribLines(tx, 2026, [firmId]))).toBe(4);
    // back to 2349 for the button's test below
    for (const n of ['Penziski', 'Zdravstvo', '0.5% dodatno', 'Vrabotuvanje']) await db.update(schema.bankLines).set({ konto: '2349' }).where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.description, n)));
  });

  it('„Придонеси по вид“ moves the 2349 lines to 2341 / 2342 / 2343 / 2344 and re-posts the statement', async () => {
    expect((await T((tx) => contribFixPlan(tx, firmId, 2026))).fix.map((r) => r.konto).sort()).toEqual(['2341', '2342', '2343', '2344']);
    expect(await T((tx) => applyContribFix(tx, { firmId, userId: null, year: 2026 }))).toBe(4);
    const L = await db.select().from(schema.bankLines).where(eq(schema.bankLines.firmId, firmId));
    expect(Object.fromEntries(L.map((l) => [l.description, l.konto]))).toEqual({ Penziski: '2341', Zdravstvo: '2342', '0.5% dodatno': '2343', Vrabotuvanje: '2344', Danok: '2340' });
    const J = await db.select({ account: schema.journalLines.account, debit: schema.journalLines.debit }).from(schema.journalLines)
      .innerJoin(schema.journals, eq(schema.journals.id, schema.journalLines.journalId)).where(eq(schema.journals.firmId, firmId));
    expect(J.filter((l) => l.account.startsWith('234')).map((l) => [l.account, Number(l.debit)]).sort()).toEqual([['2340', 1502], ['2341', 6775], ['2342', 2703], ['2343', 180], ['2344', 432]]);
    expect((await T((tx) => contribFixPlan(tx, firmId, 2026))).fix).toHaveLength(0);
  });
});
