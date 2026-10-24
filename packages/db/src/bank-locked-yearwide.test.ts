/**
 * Year-wide statement buttons with one statement in a locked period (PGlite): „Поврзи со комитент од изводот“,
 * „Пополни ги броевите“, „Нумерирај изводи“ and „Прекнижи на 4460“ skip and list the locked statement (they failed as
 * a whole), and the plans behind the counts on the buttons leave it out.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addManualLine, applyBankPartnerFix, applyFeeFix, bankPartnerFixPlan, feeFixPlan, fillStatementNumbers, ledgerOpenItemsSource, numberStatements, saveBankAccount,
  setOpenItemsSource, statementNoSuggestions, type LockedStatement,
} from './bank/index';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', mkd = '', jan = '', mar = '';
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const stOn = async (date: string) => (await db.select().from(schema.bankStatements).where(and(eq(schema.bankStatements.firmId, firmId), eq(schema.bankStatements.date, date))))[0]!;
const clearNo = (id: string) => db.update(schema.bankStatements).set({ number: null }).where(eq(schema.bankStatements.id, id));

beforeAll(async () => {
  setOpenItemsSource(ledgerOpenItemsSource);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  firmId = (await db.insert(schema.firms).values({ name: 'Заклучен ДООЕЛ' }).returning())[0]!.id;
  mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Халкбанк', account: '250000000222222', cur: 'MKD', konto: '100077' } }));
  for (const [date, who, fee] of [['2026-01-10', 'Гама ДОО', -10], ['2026-03-10', 'Делта ДОО', -20]] as const) {
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date, amount: 500, desc: `${who} - уплата аванс`, konto: '1200' }));
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date, amount: fee, desc: 'провизија', konto: '4400' }));
  }
  jan = (await stOn('2026-01-10')).id;
  mar = (await stOn('2026-03-10')).id;
  await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
}, 60_000);

describe('year-wide bank buttons with a locked statement', () => {
  it('„Поврзи со комитент од изводот“: the open statement is linked, the locked one skipped and listed (not counted)', async () => {
    const sk: LockedStatement[] = [];
    const plan = await T((tx) => bankPartnerFixPlan(tx, firmId, 2026, { skipped: sk }));
    expect(plan.map((x) => x.name)).toEqual(['Делта ДОО']);
    expect(sk.map((s) => s.statementId)).toEqual([jan]);
    const r = await T((tx) => applyBankPartnerFix(tx, { firmId, userId: null, year: 2026 }));
    expect([r.linked, r.skipped.map((s) => s.statementId)]).toEqual([1, [jan]]);
    expect(r.skipped[0]!.why).toMatch(/заклучен/);
  });

  it('„Прекнижи на 4460“: only the open statement\'s fee is moved', async () => {
    expect((await T((tx) => feeFixPlan(tx, firmId, 2026))).fix).toHaveLength(1);
    const report: { skipped?: LockedStatement[] } = {};
    expect(await T((tx) => applyFeeFix(tx, { firmId, userId: null, year: 2026, report }))).toBe(1);
    expect(report.skipped!.map((s) => s.statementId)).toEqual([jan]);
    const L = await db.select().from(schema.bankLines).where(and(eq(schema.bankLines.firmId, firmId), eq(schema.bankLines.description, 'провизија')));
    expect(L.map((l) => [l.date, l.konto]).sort()).toEqual([['2026-01-10', '4400'], ['2026-03-10', '4460']]);
  });

  it('statement numbers: „Пополни“ and „Нумерирај“ skip the locked statement', async () => {
    await clearNo(jan); await clearNo(mar);
    const sk: LockedStatement[] = [];
    const S = await T((tx) => statementNoSuggestions(tx, firmId, 2026, { skipped: sk }));
    expect(S.has(jan)).toBe(false);
    const report: { skipped?: LockedStatement[] } = {};
    const n = await T((tx) => fillStatementNumbers(tx, { firmId, userId: null, year: 2026, report }));
    expect(n).toBe(S.size);
    expect((await stOn('2026-01-10')).number).toBeNull();
    await clearNo(mar);
    const r2: { skipped?: LockedStatement[] } = {};
    expect(await T((tx) => numberStatements(tx, { firmId, userId: null, year: 2026, report: r2 }))).toBe(1);
    expect(r2.skipped!.map((s) => s.statementId)).toEqual([jan]);
    expect((await stOn('2026-01-10')).number).toBeNull();
    expect((await stOn('2026-03-10')).number).toBeTruthy();
  });
});
