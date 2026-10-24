/** „Прекнижи“: cash vouchers and supplier credits are re-posted too; one failing bank statement never stops the run. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { createDefaultRegisters, loadRegisters, saveVoucher } from './bank/cash';
import { addManualLine, saveBankAccount } from './bank/index';
import { repostFirmYear } from './auto-repost';
import { repostYear } from './repost';
import { savePurchase } from './sales/purchases';
import { saveSupplierCredit } from './sales/supplier-credits';
import type { DocActor } from './sales/context';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const office: DocActor = { userId: null, role: 'acc' };
let firmId = '';

/** Accounts of the journals of one source type, per journal date. */
async function accounts(sourceType: string) {
  const L = await db.select({ d: schema.journals.date, a: schema.journalLines.account }).from(schema.journalLines)
    .innerJoin(schema.journals, eq(schema.journals.id, schema.journalLines.journalId))
    .where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, sourceType)));
  const M: Record<string, string[]> = {};
  for (const l of L) (M[l.d] ??= []).push(l.a);
  return M;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Прекнижување 3 ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning();
  firmId = f!.id;
  const [s] = await db.insert(schema.partners).values([{ firmId, name: 'Добавувач', code: '2' }]).returning();
  const p = (await tx((t) => savePurchase(t, firmId, { number: 'D-1', date: '2026-04-01', partnerId: s!.id, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 1000, vat: 180 }] }, office))).id;
  await tx((t) => saveSupplierCredit(t, firmId, { kind: 'disc', date: '2026-04-20', partnerId: s!.id, refPurchaseId: p, supNo: 'ОД-5', rows: [{ name: 'Попуст', qty: 1, price: 100, rate: 18 }] }, office));
  await tx((t) => createDefaultRegisters(t, { firmId, userId: null }));
  const reg = (await tx((t) => loadRegisters(t, firmId))).find((r) => r.konto === '1020')!;
  for (const date of ['2026-02-02', '2026-04-02']) {
    await tx((t) => saveVoucher(t, { firmId, userId: null, input: { registerId: reg.id, kind: 'out', date, amt: 1180, vatRate: 18, cat: 'other', merchant: 'Маркет', docNo: 'ФС-' + date } }));
  }
  // an old booking: input VAT on the summary konto
  const J = await db.select({ id: schema.journals.id }).from(schema.journals).where(and(eq(schema.journals.firmId, firmId), inArray(schema.journals.sourceType, ['cash_voucher', 'supplier_credit'])));
  for (const j of J) await db.update(schema.journalLines).set({ account: '1300' }).where(and(eq(schema.journalLines.journalId, j.id), like(schema.journalLines.account, '1300%')));
  await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
}, 60_000);

describe('repostYear: cash vouchers and supplier credits', () => {
  it('re-posts both with the current schemes; the voucher of the locked period is skipped', async () => {
    expect((await accounts('cash_voucher'))['2026-04-02']).toContain('1300');
    expect((await accounts('supplier_credit'))['2026-04-20']).toContain('1300');
    const R = await tx((t) => repostYear(t, { firmId, userId: null }, 2026));
    // purchase + April voucher + supplier credit; the February voucher locked
    expect(R).toMatchObject({ n: 3, locked: 1, failed: 0 });
    const C = await accounts('cash_voucher'), S = await accounts('supplier_credit');
    expect(C['2026-04-02']).not.toContain('1300');
    expect(C['2026-04-02']!.some((a) => a.startsWith('1300'))).toBe(true);
    expect(C['2026-02-02']).toContain('1300');
    expect(S['2026-04-20']).not.toContain('1300');
    expect(S['2026-04-20']!.some((a) => a.startsWith('1300'))).toBe(true);
  });
});

describe('repostFirmYear: bank statements', () => {
  it('a failing statement is counted as failed, the others are re-posted', async () => {
    const acc = await tx((t) => saveBankAccount(t, { firmId, userId: null, input: { name: 'Халкбанк', account: '200000000222222', cur: 'MKD', konto: '1000' } }));
    await tx((t) => addManualLine(t, { firmId, userId: null, bankAccountId: acc, date: '2026-05-04', amount: -100, desc: 'Провизија', konto: '4120' }));
    const bad = await tx((t) => addManualLine(t, { firmId, userId: null, bankAccountId: acc, date: '2026-05-05', amount: -200, desc: 'Друго', konto: '4120' }));
    // a konto not in the chart (e.g. deleted after the line was booked)
    await db.update(schema.bankLines).set({ konto: '98989898' }).where(eq(schema.bankLines.id, bad));
    const r = await tx((t) => repostFirmYear(t, { firmId, userId: null, year: 2026 }));
    expect(r).toMatchObject({ statements: 1, failed: 1 });
    expect(r.errors.some((e) => /^Извод .*2026-05-05/.test(e))).toBe(true);
  });
});
