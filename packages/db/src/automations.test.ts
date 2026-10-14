import { PGlite } from '@electric-sql/pglite';
import { and, eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { fxRate } from '@wise/core';
import { loadFxSources } from './bank/context';
import { saveFxList } from './bank/orders';
import { feePortalItem, feePreview, feeRows, issueFeeInvoices, runFeeReminders } from './fee-invoices';
import { saveNbrmRates } from './fx-nbrm';
import { dispatchReminders, patchOfficeProfile } from './office';
import { dispatchRokReminders, markRok, syncRokovi } from './rokovi';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let off = '', a = '', b = '', c = '', n = '', userId = '', recId = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [o] = await db.insert(schema.firms).values({ name: 'БАЈРАМИ ГРОУП ДООЕЛ Скопје', edb: '4030000000001', settings: { officeFirm: true, bankAccount: '300000000000001' } }).returning();
  const [fa] = await db.insert(schema.firms).values({ name: 'Алфа ДООЕЛ', edb: '4030000000002', email: 'alfa@example.mk', vatPeriod: 'month', settings: { kdog: { net: 3000, start: '2026-01-01', no: 'СУ-001/2026', payDay: 10 } } }).returning();
  const [fb] = await db.insert(schema.firms).values({ name: 'Бета ДОО', edb: '4030000000003', vatPeriod: 'quarter', settings: { accFee: '2541.67', accFrom: '2026-01-01' } }).returning();
  const [fc] = await db.insert(schema.firms).values({ name: 'Гама ТП', edb: '4030000000004', vatRegistered: false, legalForm: 'tp', settings: { kdog: { net: 1500, start: '2026-01-01', no: 'СУ-003/2026' } } }).returning();
  const [fn] = await db.insert(schema.firms).values({ name: 'Без договор ДООЕЛ', edb: '4030000000005', email: 'bez@example.mk' }).returning();
  off = o!.id; a = fa!.id; b = fb!.id; c = fc!.id; n = fn!.id;
  const [u] = await db.insert(schema.users).values({ username: 'vlasnik', name: 'Сопственик', role: 'admin', passwordHash: 'x', email: 'owner@example.mk' }).returning();
  userId = u!.id;
  await db.insert(schema.userFirms).values([{ userId, firmId: a }]);
  await db.insert(schema.employees).values({ firmId: a, name: 'Ана', start: '2020-01-01', active: true });
  // Гама already has the old recurring definition (kdRecSync) in the office firm
  const [pc] = await db.insert(schema.partners).values({ firmId: off, name: 'Гама ТП', edb: '4030000000004', code: '1' }).returning();
  const [r] = await db.insert(schema.recurringInvoices).values({ firmId: off, partnerId: pc!.id, every: 'month', day: 'L', next: '2026-10-30', active: true, items: [{ name: 'Сметководствени услуги', qty: 1, price: 1500, vat: 18 }] }).returning();
  recId = r!.id;
  await db.update(schema.firms).set({ settings: { kdog: { net: 1500, start: '2026-01-01', no: 'СУ-003/2026' }, kdRecId: recId } }).where(eq(schema.firms.id, c));
}, 120_000);

const rok = async (firmId: string, key: string) => (await db.select().from(schema.rokovi).where(and(eq(schema.rokovi.firmId, firmId), eq(schema.rokovi.key, key))))[0];

describe('📅 calendar of deadlines (stored, automatic done)', () => {
  it('generates per firm from its settings and marks ДДВ-04 / МПИН done when the program sees the work done', async () => {
    const r = await syncRokovi(db, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.firms).toBe(5);
    expect(await rok(a, 'ddv:2026-09')).toMatchObject({ due: '2026-10-26', done: false, link: 'ddv' });
    expect(await rok(a, 'mpin:2026-09')).toMatchObject({ due: '2026-10-13' });
    expect(await rok(b, 'ddv:2026-Т3')).toMatchObject({ due: '2026-10-26' });
    expect(await rok(c, 'dld:2026-09')).toBeTruthy();
    expect(await rok(c, 'ddv:2026-09')).toBeUndefined();
    await db.insert(schema.vatPeriods).values({ firmId: a, period: '2026-09', periodKind: 'month', dateFrom: '2026-09-01', dateTo: '2026-09-30', status: 'closed' });
    await db.insert(schema.mpinAcks).values({ firmId: a, month: '2026-09', status: 'Прифатена' });
    const r2 = await syncRokovi(db, { from: '2026-10-01', to: '2026-10-31' });
    expect(r2.autoDone).toBe(2);
    expect(await rok(a, 'ddv:2026-09')).toMatchObject({ done: true, auto: true });
    expect(await rok(a, 'mpin:2026-09')).toMatchObject({ done: true, auto: true });
    // the period reopened → no longer done
    await db.update(schema.vatPeriods).set({ status: 'open' }).where(eq(schema.vatPeriods.firmId, a));
    expect((await syncRokovi(db, { from: '2026-10-01', to: '2026-10-31' })).autoUndone).toBe(1);
    expect(await rok(a, 'ddv:2026-09')).toMatchObject({ done: false, auto: false });
  });
  it('a colleague marks done (audited); a changed setting hides the deadline (`gone`)', async () => {
    const x = await rok(b, 'ddv:2026-Т3');
    await db.transaction((tx) => markRok(tx, { id: x!.id, done: true, userId, firmAllowed: () => true }));
    expect(await rok(b, 'ddv:2026-Т3')).toMatchObject({ done: true, auto: false, doneBy: userId });
    await expect(db.transaction((tx) => markRok(tx, { id: x!.id, done: false, userId, firmAllowed: () => false }))).rejects.toThrow();
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'rokDone'), eq(schema.auditLog.entityId, x!.id)));
    expect(log).toBeTruthy();
    await db.update(schema.firms).set({ vatRegistered: false }).where(eq(schema.firms.id, b));
    const r = await syncRokovi(db, { from: '2026-10-01', to: '2026-10-31' });
    expect(r.gone).toBeGreaterThanOrEqual(1);
    expect(await rok(b, 'ddv:2026-Т3')).toMatchObject({ gone: true });
    await db.update(schema.firms).set({ vatRegistered: true }).where(eq(schema.firms.id, b));
  });
  it('reminders: e-mail to the responsible colleague N days before (once), client reminder on the configured day', async () => {
    await patchOfficeProfile(db, { rok: { days: 5, mail: true, client: { on: true, day: 3, portal: true, mail: true } } } as never, null);
    expect(await dispatchRokReminders(db, { today: '2026-10-14', mail: false })).toEqual({ colleague: 0, client: 0 }); // no SMTP
    // 20.10: the late аконтација (15.10, still open); ДДВ-04 (26.10) enters its 5-day window on 21.10; МПИН is done
    expect(await dispatchRokReminders(db, { today: '2026-10-20', mail: true })).toEqual({ colleague: 1, client: 0 });
    const r1 = await dispatchRokReminders(db, { today: '2026-10-21', mail: true });
    expect(r1.colleague).toBe(1);
    expect((await dispatchRokReminders(db, { today: '2026-10-22', mail: true })).colleague).toBe(0);
    const R = await db.select().from(schema.reminders).where(like(schema.reminders.key, 'rok:%'));
    expect(R.every((x) => x.userId === userId && x.channel === 'mail')).toBe(true);
    const cl = await dispatchRokReminders(db, { today: '2026-11-03', mail: true });
    // 4 clients (the office firm is skipped): 4 portal messages + e-mail to the 2 with an address
    expect(cl.client).toBe(6);
    const d = await dispatchReminders(db, new Date('2026-11-03T08:00:00Z'));
    expect(d.mailIds.length).toBeGreaterThanOrEqual(4);
    const [msg] = await db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.firmId, n), eq(schema.inboxItems.fromOffice, true)));
    expect(msg!.note).toContain('доставете ги изводите / фактурите за месец октомври 2026');
  });
});

describe('💱 NBRM rates in the office list', () => {
  it('stores the NBRM rates, never overwrites a manual rate, weekends use the last list', async () => {
    await db.transaction((tx) => saveFxList(tx, { userId, date: '2026-10-09', rows: [{ cur: 'EUR', rate: 61.7 }] }));
    const r = await db.transaction((tx) => saveNbrmRates(tx, [
      { date: '2026-10-09', cur: 'EUR', rate: 61.6866 }, { date: '2026-10-09', cur: 'USD', rate: 55.1463 }, { date: '2026-10-09', cur: 'JPY', rate: 0.360815 },
    ], { userId: null }));
    expect(r).toEqual({ saved: 2, skippedManual: 1, dates: 1 });
    const again = await db.transaction((tx) => saveNbrmRates(tx, [{ date: '2026-10-09', cur: 'USD', rate: 55.2 }], { userId: null }));
    expect(again.saved).toBe(1);
    const S = await loadFxSources(db, a);
    expect(fxRate('EUR', '2026-10-11', S)).toBe(61.7);
    expect(fxRate('USD', '2026-10-12', S)).toBe(55.2);
    expect(fxRate('JPY', '2026-10-10', S)).toBe(0.360815);
    const [u] = await db.select().from(schema.fxRates).where(and(eq(schema.fxRates.cur, 'USD'), eq(schema.fxRates.date, '2026-10-09')));
    expect(u!.source).toBe('nbrm');
  });
});

describe('🧾 monthly fee invoices of the office firm', () => {
  it('preview: clients with a fee, recurring reported, clients without a fee skipped', async () => {
    const p = (await feePreview(db, '2026-10'))!;
    expect(p.plan.map((r) => [r.name, r.st, r.gross])).toEqual([['Алфа ДООЕЛ', 'нова', 354000], ['Бета ДОО', 'нова', 299917], ['Гама ТП', 'периодична', 177000]]);
    expect(p.noFee).toBe(1);
  });
  it('issues booked invoices numbered in the office series, once per client and month; recurring only on request', async () => {
    const r = await issueFeeInvoices(db, { ym: '2026-10', date: '2026-10-30', userId });
    expect(r.errors).toEqual([]);
    expect(r.issued.map((x) => x.name)).toEqual(['Алфа ДООЕЛ', 'Бета ДОО']);
    const I = await db.select().from(schema.invoices).where(eq(schema.invoices.firmId, off));
    expect(I).toHaveLength(2);
    expect(I.every((i) => i.status === 'posted')).toBe(true);
    const nums = r.issued.map((x) => x.number);
    expect(new Set(nums).size).toBe(2);
    expect(nums.every((x) => !/НАЦРТ/.test(x))).toBe(true);
    const ia = I.find((i) => i.id === r.issued[0]!.invoiceId)!;
    expect([ia.base, ia.vat, ia.total, ia.due]).toEqual(['3000.00', '540.00', '3540.00', '2026-11-10']);
    const J = await db.select().from(schema.journals).where(eq(schema.journals.firmId, off));
    expect(J.length).toBeGreaterThanOrEqual(2);
    // the partner of Алфа was created in the office firm
    expect((await db.select().from(schema.partners).where(and(eq(schema.partners.firmId, off), eq(schema.partners.edb, '4030000000002')))).length).toBe(1);
    // second click: nothing new
    expect((await issueFeeInvoices(db, { ym: '2026-10', date: '2026-10-30', userId })).issued).toEqual([]);
    // Гама: only when asked, and the old recurring definition is switched off
    const g = await issueFeeInvoices(db, { ym: '2026-10', date: '2026-10-30', userId, includeRecurring: true });
    expect(g.issued.map((x) => x.name)).toEqual(['Гама ТП']);
    const [rec] = await db.select().from(schema.recurringInvoices).where(eq(schema.recurringInvoices.id, recId));
    expect(rec!.active).toBe(false);
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'feeIssue'), eq(schema.auditLog.entityId, r.issued[0]!.invoiceId)));
    expect(log).toBeTruthy();
  });
  it('portal message of the client (once) and the client e-mail', async () => {
    const [f] = await db.select().from(schema.feeInvoices).where(eq(schema.feeInvoices.clientFirmId, a));
    const p1 = await db.transaction((tx) => feePortalItem(tx, f!.id));
    const p2 = await db.transaction((tx) => feePortalItem(tx, f!.id));
    expect(p1!.itemId).toBeTruthy();
    expect(p2!.itemId).toBe(p1!.itemId);
    expect(p1!.to).toBe('alfa@example.mk');
    expect(p1!.body).toContain('3.540,00 ден.');
  });
  it('overdue: polite reminders after N days, every M days, payment tracked from the invoice', async () => {
    const rows = await feeRows(db, { offId: off });
    expect(rows.find((r) => r.clientFirmId === a)).toMatchObject({ gross: 354000, paid: 0, remaining: 354000 });
    expect((await runFeeReminders(db, { today: '2026-11-19', mail: true })).sent).toBe(0);
    const r = await runFeeReminders(db, { today: '2026-11-20', mail: true });
    expect(r.sent).toBe(1); // Алфа: due 10.11 + 10 days; Бета / Гама are due 14.11
    expect(r.mailIds).toHaveLength(1);
    expect((await runFeeReminders(db, { today: '2026-11-21', mail: true })).sent).toBe(0);
    const r2 = await runFeeReminders(db, { today: '2026-11-24', mail: false });
    expect(r2.sent).toBe(2);
    expect(r2.mailIds).toEqual([]);
    const [fa] = await db.select().from(schema.feeInvoices).where(eq(schema.feeInvoices.clientFirmId, a));
    expect(fa).toMatchObject({ reminders: 1, lastReminder: '2026-11-20' });
  });
});
