import { demoFirmSql } from './filters';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_FIRM_NAMES, DEMO_OFFICE_NAME } from '@wise/core/demo';
import type { Tx } from '../audit';
import * as schema from '../schema/index';
import { seedReference } from '../seed/reference';
import { assertDemoFirms, assertDemoUsers, deleteDemoData, DemoResetError, firmScopedTables, resetDemo } from './reset';
import { demoYear, seedDemo } from './seed';

const db = drizzle(new PGlite(), { schema });
const D = db as unknown as Tx;
const YEAR = 2026;
let adminId = '', realUserId = '', realFirm = '', misflagged = '', prefixOnly = '', realJournal = '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const count = async (t: any, col: any, firmId: string): Promise<number> => {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(eq(col, firmId));
  return Number(r!.n);
};
const firmByName = async (name: string) => (await db.select().from(schema.firms).where(eq(schema.firms.name, name)))[0];
const allFirmNames = async () => (await db.select({ n: schema.firms.name }).from(schema.firms)).map((r) => r.n).sort();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../migrations', import.meta.url)) });
  await seedReference(db);
  const [a] = await db.insert(schema.users).values({ username: 'demo', name: 'Демо администратор', role: 'admin', allFirms: true, demo: true, passwordHash: 'x' }).returning();
  const [r] = await db.insert(schema.users).values({ username: 'ana', name: 'Ана', role: 'acc', passwordHash: 'x' }).returning();
  adminId = a!.id; realUserId = r!.id;
  // a real firm with data, a misflagged real firm (flag, no prefix) and a real firm with the prefix but no flag
  const F = await db.insert(schema.firms).values([
    { name: 'Вистински Клиент ДООЕЛ', settings: {} },
    { name: 'Погрешно Означена ДОО', settings: { demo: true } },
    { name: 'ДЕМОКРАТИЈА ДОО', settings: {} },
  ]).returning();
  [realFirm, misflagged, prefixOnly] = F.map((f) => f.id) as [string, string, string];
  for (const firmId of [realFirm, misflagged, prefixOnly]) {
    await db.insert(schema.partners).values({ firmId, name: 'Партнер', code: '1' });
    await db.insert(schema.auditLog).values({ userId: realUserId, firmId, action: 'saveJ' });
  }
  const { postJournal } = await import('../posting');
  const j = await db.transaction((tx) => postJournal(tx as unknown as Tx, { firmId: realFirm, date: `${YEAR}-02-01`, kind: 'nalog', description: 'Реален налог', lines: [{ account: '1000', debit: 100, credit: 0 }, { account: '1020', debit: 0, credit: 100 }], userId: realUserId, requirePartner: false }));
  realJournal = j.id;
  await db.insert(schema.appSettings).values({ key: 'office', value: { name: 'ВИСТИНСКА КАНЦЕЛАРИЈА' } });
}, 120_000);

describe('demo year', () => {
  it('fills up to the last completed month', () => {
    expect(demoYear(undefined, '2026-10-15')).toEqual({ Y: 2026, M: 9 });
    expect(demoYear(undefined, '2027-01-10')).toEqual({ Y: 2026, M: 12 });
    expect(demoYear(2025, '2026-10-15')).toEqual({ Y: 2025, M: 12 });
  });
});

describe('seedDemo', () => {
  it('creates the 3 demo firms, the demo office and demo colleagues with VAT, payroll, stock, production, bank and cash', async () => {
    const r = await seedDemo(D, { adminUserId: adminId, year: YEAR });
    expect(r.firmIds).toHaveLength(3);
    const F = await db.select().from(schema.firms).where(inArray(schema.firms.id, [...r.firmIds, r.officeFirmId]));
    expect(F.map((f) => f.name).sort()).toEqual([...DEMO_FIRM_NAMES, DEMO_OFFICE_NAME].sort());
    for (const f of F) expect((f.settings as { demo?: boolean }).demo).toBe(true);
    const off = F.find((f) => f.id === r.officeFirmId)!;
    expect(off.settings).toMatchObject({ demo: true, demoOffice: true });
    expect((off.settings as { officeFirm?: boolean }).officeFirm).toBeUndefined();

    const [trg, prod, usl] = DEMO_FIRM_NAMES.map((n) => F.find((f) => f.name === n)!.id) as [string, string, string];
    const S = schema;
    // VAT: closed periods with a ДДВ-04 snapshot
    const closed = async (firmId: string) => (await db.select().from(S.vatPeriods).where(and(eq(S.vatPeriods.firmId, firmId), eq(S.vatPeriods.status, 'closed')))).length;
    expect(await closed(trg)).toBe(8);
    expect(await closed(prod)).toBe(8);
    expect(await closed(usl)).toBe(3);
    // payroll
    expect(await count(S.payrollRuns, S.payrollRuns.firmId, trg)).toBe(2);
    expect(await count(S.payrollRuns, S.payrollRuns.firmId, prod)).toBe(1);
    expect(await count(S.employees, S.employees.firmId, trg)).toBe(3);
    // stock
    expect(await count(S.stockMoves, S.stockMoves.firmId, trg)).toBeGreaterThan(20);
    expect(await count(S.stockMoves, S.stockMoves.firmId, prod)).toBeGreaterThan(5);
    // production: work orders (the work order + the production invoice) and the normative
    expect(await count(S.productionOrders, S.productionOrders.firmId, prod)).toBeGreaterThanOrEqual(2);
    // bank lines and cash vouchers
    expect(await count(S.bankLines, S.bankLines.firmId, trg)).toBeGreaterThan(5);
    expect(await count(S.bankLines, S.bankLines.firmId, usl)).toBeGreaterThan(5);
    for (const f of [trg, prod, usl]) expect(await count(S.cashVouchers, S.cashVouchers.firmId, f)).toBeGreaterThanOrEqual(2);
    // invoices, purchases, journals
    expect(await count(S.invoices, S.invoices.firmId, usl)).toBe(27);
    expect(await count(S.purchases, S.purchases.firmId, trg)).toBe(6);
    expect(await count(S.journals, S.journals.firmId, trg)).toBeGreaterThan(20);
    // office side
    const U = await db.select().from(S.users).where(inArray(S.users.id, r.userIds));
    expect(U.map((u) => u.role).sort()).toEqual(['acc', 'oper', 'senior']);
    for (const u of U) { expect(u.demo).toBe(true); expect(u.username.startsWith('demo-')).toBe(true); expect(u.passwordHash.startsWith('$argon2')).toBe(true); }
    const UF = await db.select().from(S.userFirms).where(inArray(S.userFirms.userId, r.userIds));
    expect(UF.every((x) => [...r.firmIds, r.officeFirmId].includes(x.firmId))).toBe(true);
    const T = await db.select().from(S.officeTasks);
    expect(T.length).toBe(5);
    expect(T.every((t) => r.firmIds.includes(t.firmId!) && r.userIds.includes(t.assigneeId!))).toBe(true);
    expect((await db.select().from(S.inboxItems).where(inArray(S.inboxItems.firmId, r.firmIds))).length).toBe(4);
    const C = await db.select().from(S.serviceContracts);
    expect(C.map((c) => c.firmId).sort()).toEqual([...r.firmIds].sort());
    expect(C.every((c) => (c.data as { provider?: { firmId?: string } }).provider?.firmId === r.officeFirmId)).toBe(true);
    expect((F.find((f) => f.id === trg)!.settings as { kdog?: { no?: string } }).kdog?.no).toMatch(/^ДЕМО-СУ-/);
    const act = await db.select({ n: sql<number>`count(*)::int` }).from(S.auditLog).where(and(inArray(S.auditLog.userId, r.userIds), eq(S.auditLog.entityType, 'demo')));
    expect(act[0]!.n).toBeGreaterThan(100);
    // the real office profile is untouched
    const [o] = await db.select().from(S.appSettings).where(eq(S.appSettings.key, 'office'));
    expect(o!.value).toEqual({ name: 'ВИСТИНСКА КАНЦЕЛАРИЈА' });
  }, 300_000);

  it('refuses to seed twice', async () => {
    await expect(seedDemo(D, { adminUserId: adminId, year: YEAR })).rejects.toThrow(/веќе постојат/);
  });
});

describe('resetDemo', () => {
  it('walks every firm-scoped table', () => {
    const names = firmScopedTables().map((t) => t.name);
    for (const n of ['journals', 'invoices', 'stock_moves', 'payroll_runs', 'bank_lines', 'cash_vouchers', 'files', 'office_tasks', 'inbox_items', 'service_contracts']) expect(names, n).toContain(n);
    expect(names).not.toContain('ai_usage');
    expect(names).not.toContain('audit_log');
    expect(names).not.toContain('firms');
  });

  it('the JS guard refuses anything that is not a demo firm / user', () => {
    expect(() => assertDemoFirms([{ id: '1', name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } }])).not.toThrow();
    expect(() => assertDemoFirms([{ id: '1', name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } }, { id: '2', name: 'Клиент ДОО', settings: { demo: true } }])).toThrow(DemoResetError);
    expect(() => assertDemoFirms([{ id: '3', name: 'ДЕМО Клиент', settings: { demo: 'true' } }])).toThrow(DemoResetError);
    expect(() => assertDemoFirms([{ id: '4', name: 'ДЕМО Клиент', settings: {} }])).toThrow(DemoResetError);
    expect(() => assertDemoUsers([{ id: '1', username: 'ana', demo: false }])).toThrow(DemoResetError);
  });

  it('rolls back everything when a candidate fails the JS check', async () => {
    // a drifted SQL filter (only the „ДЕМО“ prefix) selects a real firm whose name starts with „ДЕМО“ but has no flag:
    // the JS check refuses it and nothing at all is deleted
    const [bad] = await db.insert(schema.firms).values({ name: 'ДЕМО ЛАЖНА ДООЕЛ', settings: { demo: 'true' } }).returning();
    const before = await allFirmNames();
    const drift = sql`${schema.firms.name} like 'ДЕМО%'`;
    await expect(db.transaction((tx) => deleteDemoData(tx as unknown as Tx, { keepUserIds: [adminId], candidateSql: drift }))).rejects.toThrow(DemoResetError);
    // and the real filter never selects it
    await expect(db.transaction((tx) => deleteDemoData(tx as unknown as Tx, { keepUserIds: [adminId], candidateSql: sql`${schema.firms.id} = ${bad!.id}` }))).rejects.toThrow(DemoResetError);
    expect((await db.select({ id: schema.firms.id }).from(schema.firms).where(and(demoFirmSql, eq(schema.firms.id, bad!.id)))).length).toBe(0);
    expect(await allFirmNames()).toEqual(before);
    await db.delete(schema.firms).where(eq(schema.firms.id, bad!.id));
  });

  it('deletes only demo firms and demo users, then reseeds; twice leaves exactly 3 demo firms + the demo office', async () => {
    const realBefore = { partners: await count(schema.partners, schema.partners.firmId, realFirm), audit: await count(schema.auditLog, schema.auditLog.firmId, realFirm) };
    for (let i = 0; i < 2; i++) {
      const r = await resetDemo(D, { adminUserId: adminId, year: YEAR });
      expect(r.deleted.firmIds).toHaveLength(4);
      expect(r.deleted.userIds).toHaveLength(3);
      expect(r.deleted.firmIds).not.toContain(misflagged);
      expect(r.deleted.firmIds).not.toContain(prefixOnly);
    }
    const names = await allFirmNames();
    expect(names).toEqual(['Вистински Клиент ДООЕЛ', 'Погрешно Означена ДОО', 'ДЕМОКРАТИЈА ДОО', ...DEMO_FIRM_NAMES, DEMO_OFFICE_NAME].sort());
    // real data survives
    expect(await count(schema.partners, schema.partners.firmId, realFirm)).toBe(realBefore.partners);
    expect(await count(schema.auditLog, schema.auditLog.firmId, realFirm)).toBe(realBefore.audit);
    expect(await count(schema.partners, schema.partners.firmId, misflagged)).toBe(1);
    expect(await count(schema.partners, schema.partners.firmId, prefixOnly)).toBe(1);
    expect((await db.select().from(schema.journals).where(eq(schema.journals.id, realJournal))).length).toBe(1);
    // users: the real one and the kept demo admin survive; exactly 3 new demo colleagues
    const U = await db.select().from(schema.users);
    expect(U.find((u) => u.id === realUserId)).toBeTruthy();
    expect(U.find((u) => u.id === adminId)).toBeTruthy();
    expect(U.filter((u) => u.demo && u.id !== adminId)).toHaveLength(3);
    // nothing of the old demo firms is left behind
    const ids = (await db.select({ id: schema.firms.id }).from(schema.firms)).map((f) => f.id);
    const orphans = await db.select({ n: sql<number>`count(*)::int` }).from(schema.journals).where(sql`${schema.journals.firmId} not in ${ids}`);
    expect(orphans[0]!.n).toBe(0);
    expect((await firmByName(DEMO_FIRM_NAMES[0]))).toBeTruthy();
  }, 600_000);
});
