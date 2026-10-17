/**
 * UX Phase 3 automations (P35–P38, P43) on PGlite: every job prepares drafts only (no journal, no locked period, no demo
 * firm), does nothing while switched off, never duplicates on a re-run, and the bulk confirm acts on the ticked drafts only.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { payDraft } from '@wise/core';
import { autoSettingsClean } from '@wise/core/office/automations';
import {
  autoLastRun, autoSettings, closeVatDrafts, listDrafts, lockPreparedMonths, postPayDrafts, publishPreparedReports, putAutoSettings,
  runAutoAml, runAutoClose, runAutoDunning, runAutoLawrep, runAutoPayroll, runAutoReports, runAutoVat, runServiceReminders,
} from './automation/index';
import { saveRun } from './payroll';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = db as unknown as Parameters<typeof runAutoClose>[0];
const ids: Record<string, string> = {};
let userId = '';

const firm = async (k: string, v: Partial<typeof schema.firms.$inferInsert> & { name: string }) => {
  const [f] = await db.insert(schema.firms).values({ vatRegistered: false, ...v }).returning();
  ids[k] = f!.id;
};
const journalsOf = async (firmId: string) => db.select().from(schema.journals).where(eq(schema.journals.firmId, firmId));
const allOn = () => putAutoSettings(T, autoSettingsClean({ on: { close: true, payroll: true, vat: true, reports: true, lawrep: true, dunning: true, aml: true, service: true } }), null);
const allOff = () => putAutoSettings(T, autoSettingsClean({}), null);

async function prevRun(firmId: string, month: string) {
  const E = await db.select().from(schema.employees).where(eq(schema.employees.firmId, firmId));
  const d = payDraft(month, E.map((e) => ({ id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef), start: e.start ?? undefined, active: e.active })));
  await db.transaction((t) => saveRun(t as never, { firmId, month, params: d.params, emps: d.emps, userId: null }));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [u] = await db.insert(schema.users).values({ username: 'vlasnik', name: 'Сопственик', role: 'admin', passwordHash: 'x' }).returning();
  userId = u!.id;
  await firm('office', { name: 'БАЈРАМИ ГРОУП ДООЕЛ', settings: { officeFirm: true } });
  // a quiet firm: every closing task „не важи“ → ready
  await firm('quiet', { name: 'Мирна ДООЕЛ' });
  // employees without a payroll run of September → not ready to close; payroll copied from August
  await firm('pay', { name: 'Плати ДООЕЛ' });
  await firm('pay2', { name: 'Плати Два ДООЕЛ' });
  // locked to 30.09: nothing prepared for September
  await firm('locked', { name: 'Заклучена ДООЕЛ' });
  // 🎭 demo firm (flag + prefix): never touched
  await firm('demo', { name: 'ДЕМО ТРГОВИЈА ДООЕЛ', settings: { demo: true } });
  // VAT firms (monthly): a clean one and one with a purchase still in draft
  await firm('vat', { name: 'ДДВ Чиста ДООЕЛ', vatRegistered: true, vatPeriod: 'month' });
  await firm('vatBad', { name: 'ДДВ Проблем ДООЕЛ', vatRegistered: true, vatPeriod: 'month' });
  await firm('vatLocked', { name: 'ДДВ Заклучена ДООЕЛ', vatRegistered: true, vatPeriod: 'month', lockDate: '2026-09-30' });
  for (const k of ['pay', 'pay2', 'locked', 'demo']) {
    await db.insert(schema.employees).values([
      { firmId: ids[k]!, no: '1', name: 'Ана Петрова', embg: '0101990450001', netBase: '30000', start: '2020-03-01' },
      { firmId: ids[k]!, no: '2', name: 'Борис Илиев', embg: '0202985450002', netBase: '45000', start: '2015-06-15' },
    ]);
    await prevRun(ids[k]!, '2026-08');
  }
  await db.update(schema.firms).set({ lockDate: '2026-09-30' }).where(eq(schema.firms.id, ids.locked!));
  const [p] = await db.insert(schema.partners).values({ firmId: ids.vatBad!, name: 'Добавувач ДОО', code: '1' }).returning();
  await db.insert(schema.purchases).values({ firmId: ids.vatBad!, partnerId: p!.id, number: 'В-1', date: '2026-09-10', status: 'draft' });
}, 120_000);

describe('switched off', () => {
  it('every automation does nothing while its switch is off (the default)', async () => {
    expect((await autoSettings(T)).on).toMatchObject({ close: false, payroll: false, vat: false, reports: false, lawrep: false, dunning: false, aml: false, service: false, lawTexts: true });
    const today = '2026-10-01';
    expect(await runAutoClose(T, { today })).toMatchObject({ skipped: true });
    expect(await runAutoPayroll(T, { today })).toMatchObject({ ran: false, drafts: 0 });
    expect(await runAutoVat(T, { today })).toMatchObject({ skipped: true });
    expect(await runAutoReports(T, { today: '2026-10-05' })).toMatchObject({ ran: false });
    expect(await runAutoLawrep(T, { today })).toMatchObject({ skipped: true });
    expect(await runAutoDunning(T, { today })).toMatchObject({ skipped: true });
    expect(await runAutoAml(T, { today })).toMatchObject({ skipped: true });
    expect(await runServiceReminders(T, { today })).toMatchObject({ skipped: true });
    expect(await db.select().from(schema.automationDrafts)).toEqual([]);
    expect(await db.select().from(schema.clientReports)).toEqual([]);
    expect(await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, '2026-09'))).toEqual([]);
    expect(await autoLastRun(T, 'close')).toBeNull();
  });
});

describe('P36 payroll drafts', () => {
  it('only on the configured day; copies August as an unposted draft, skips locked and demo firms; a re-run does not duplicate', async () => {
    await allOn();
    expect(await runAutoPayroll(T, { today: '2026-10-02' })).toMatchObject({ ran: false });
    const r = await runAutoPayroll(T, { today: '2026-10-01' });
    expect(r).toMatchObject({ ran: true, month: '2026-09', drafts: 2 });
    expect(r.skipped.lock).toBe(2); // the two firms locked to 30.09
    const runs = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, '2026-09'));
    expect(runs.map((x) => x.firmId).sort()).toEqual([ids.pay, ids.pay2].sort());
    expect(runs.every((x) => x.status === 'draft' && x.source === 'auto-draft' && !x.journalId)).toBe(true);
    for (const k of ['pay', 'pay2', 'locked', 'demo']) expect(await journalsOf(ids[k]!)).toEqual([]);
    const D = await listDrafts(T, { kind: 'payroll' });
    expect(D).toHaveLength(2);
    expect(D[0]!.data).toMatchObject({ prevMonth: '2026-08', emps: 2 });
    expect(Number(D[0]!.data.net)).toBeGreaterThan(0);
    // same people and pay as August; the calendar (hours / holidays) may move the net by a few denars
    expect(Math.abs(Number((D[0]!.data.prev as { net: number }).net) - Number(D[0]!.data.net))).toBeLessThan(Number(D[0]!.data.net) * 0.01);
    // re-run: the runs exist → nothing new
    const r2 = await runAutoPayroll(T, { today: '2026-10-01' });
    expect(r2.drafts).toBe(0);
    expect(await listDrafts(T, { kind: 'payroll' })).toHaveLength(2);
    expect(await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, '2026-09'))).toHaveLength(2);
  });
  it('„Прокнижи ги избраните“ posts only the ticked draft', async () => {
    const D = await listDrafts(T, { kind: 'payroll' });
    const one = D.find((d) => d.firmId === ids.pay)!;
    const r = await postPayDrafts(T, { ids: [one.id], userId, allowed: () => true });
    expect(r.posted).toHaveLength(1);
    expect(await journalsOf(ids.pay!)).toHaveLength(1);
    expect(await journalsOf(ids.pay2!)).toEqual([]);
    const left = await listDrafts(T, { kind: 'payroll' });
    expect(left.map((d) => d.firmId)).toEqual([ids.pay2]);
    const [run] = await db.select().from(schema.payrollRuns).where(and(eq(schema.payrollRuns.firmId, ids.pay2!), eq(schema.payrollRuns.month, '2026-09')));
    expect(run!.status).toBe('draft');
    // no right on the firm → nothing
    const r2 = await postPayDrafts(T, { ids: [left[0]!.id], userId, allowed: () => false });
    expect(r2.posted).toEqual([]);
    expect(await journalsOf(ids.pay2!)).toEqual([]);
    const [a] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'autoPayPost'));
    expect(a).toMatchObject({ firmId: ids.pay, userId });
  });
});

describe('P35 month ready to lock', () => {
  it('marks only the firms whose tasks are all done, never locks, skips locked and demo firms, no duplicates', async () => {
    const r = await runAutoClose(T, { today: '2026-10-03' });
    expect(r.month).toBe('2026-09');
    const D = await listDrafts(T, { kind: 'close', period: '2026-09' });
    const F = new Set(D.map((d) => d.firmId));
    expect(F.has(ids.quiet!)).toBe(true);
    expect(F.has(ids.office!)).toBe(true);
    // pay2: the payroll run exists (draft) → its task is done; locked / demo never
    expect(F.has(ids.locked!)).toBe(false);
    expect(F.has(ids.demo!)).toBe(false);
    // the VAT firms: the September return is not closed → not ready
    expect(F.has(ids.vat!)).toBe(false);
    const [q] = await db.select().from(schema.firms).where(eq(schema.firms.id, ids.quiet!));
    expect(q!.lockDate).toBeNull();
    await runAutoClose(T, { today: '2026-10-04' });
    expect(await listDrafts(T, { kind: 'close', period: '2026-09' })).toHaveLength(D.length);
    expect((await autoLastRun(T, 'close'))?.summary).toContain('2026-09');
  });
  it('„Заклучи ги сите подготвени“ locks only the prepared firms of the caller', async () => {
    const r = await lockPreparedMonths(T, { ym: '2026-09', userId, firmIds: [ids.quiet!] });
    expect(r.locked).toEqual(['Мирна ДООЕЛ']);
    const [q] = await db.select().from(schema.firms).where(eq(schema.firms.id, ids.quiet!));
    expect(q!.lockDate).toBe('2026-09-30');
    const [o] = await db.select().from(schema.firms).where(eq(schema.firms.id, ids.office!));
    expect(o!.lockDate).toBeNull();
    expect((await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'zatLock'))).map((a) => a.firmId)).toEqual([ids.quiet]);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'autoCloseLockAll'))).toHaveLength(1);
  });
});

describe('P37 ДДВ-04 drafts', () => {
  it('a draft per VAT firm with its problems; the locked period and demo firms are skipped; no duplicates', async () => {
    const r = await runAutoVat(T, { today: '2026-10-05' });
    expect(r).toMatchObject({ drafts: 2, problems: 1, locked: 1 });
    const D = await listDrafts(T, { kind: 'vat' });
    expect(D.map((d) => [d.firmId, d.period])).toEqual(expect.arrayContaining([[ids.vat, '2026-09'], [ids.vatBad, '2026-09']]));
    const bad = D.find((d) => d.firmId === ids.vatBad)!;
    expect(bad.problems.join(' ')).toContain('нацрт');
    expect(D.find((d) => d.firmId === ids.vat)!.problems).toEqual([]);
    expect(await db.select().from(schema.vatPeriods)).toEqual([]);
    await runAutoVat(T, { today: '2026-10-06' });
    expect(await listDrafts(T, { kind: 'vat' })).toHaveLength(2);
  });
  it('the bulk close closes the ticked drafts without problems only', async () => {
    const D = await listDrafts(T, { kind: 'vat' });
    const r = await closeVatDrafts(T, { ids: D.map((d) => d.id), userId, allowed: () => true });
    expect(r.closed).toEqual(['ДДВ Чиста ДООЕЛ']);
    expect(r.skipped.join(' ')).toContain('ДДВ Проблем ДООЕЛ');
    const VP = await db.select().from(schema.vatPeriods);
    expect(VP.map((v) => [v.firmId, v.period, v.status])).toEqual([[ids.vat, '2026-09', 'closed']]);
    expect((await listDrafts(T, { kind: 'vat' })).map((d) => d.firmId)).toEqual([ids.vatBad]);
  });
});

describe('P38 client reports', () => {
  it('on the report day: drafts for every client (not the office, not demo), a published report is untouched; publish all', async () => {
    const [pub] = await db.insert(schema.clientReports).values({ firmId: ids.pay!, period: '2026-09', data: { x: 1 }, status: 'published', publishedAt: new Date() }).returning();
    expect(await runAutoReports(T, { today: '2026-10-04' })).toMatchObject({ ran: false });
    const r = await runAutoReports(T, { today: '2026-10-05' });
    expect(r).toMatchObject({ ran: true, period: '2026-09', kept: 1, ai: [], published: 0 });
    const R = await db.select().from(schema.clientReports);
    expect(R.find((x) => x.firmId === ids.office)).toBeUndefined();
    expect(R.find((x) => x.firmId === ids.demo)).toBeUndefined();
    expect(R.find((x) => x.id === pub!.id)!.data).toEqual({ x: 1 });
    expect(R.filter((x) => x.status === 'draft').length).toBe(r.prepared);
    expect(await db.select().from(schema.inboxItems)).toEqual([]);
    await runAutoReports(T, { today: '2026-10-05' });
    expect(await db.select().from(schema.clientReports)).toHaveLength(R.length);
    const n = await publishPreparedReports(T, { period: '2026-09', firmIds: [ids.quiet!], user: { id: userId, name: 'Сопственик' } });
    expect(n).toBe(1);
    expect(await db.select().from(schema.inboxItems)).toHaveLength(1);
  });
});

describe('P43 scheduled checks', () => {
  it('tax review → autopilot findings (lr:), never for a demo firm; dunning / AML / service run and prepare only', async () => {
    const r = await runAutoLawrep(T, { today: '2026-10-05' });
    expect(r.errors).toEqual([]);
    const LR = await db.select().from(schema.autopilotFindings).where(like(schema.autopilotFindings.key, 'lr:%'));
    expect(LR.some((f) => f.firmId === ids.demo)).toBe(false);
    expect(LR.every((f) => f.go === 'lawrep')).toBe(true);
    expect(await runAutoDunning(T, { today: '2026-10-05' })).toMatchObject({ skipped: false, customers: 0 });
    expect(await runAutoAml(T, { today: '2026-10-05' })).toMatchObject({ skipped: false, alerts: 0, purge: 0 });
    expect(await runServiceReminders(T, { today: '2026-10-05' })).toMatchObject({ skipped: false, messages: 0 });
    // hourly job, daily work
    expect(await runServiceReminders(T, { today: '2026-10-05' })).toMatchObject({ skipped: true });
    await allOff();
  });
});
