import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildFirmSnapshot, contractNumber, decideClientEntry, dispatchReminders, getOfficeProfile, issueDueRecurring, nextOfficeNumber,
  OfficeError, patchOfficeProfile, patchOfficeZz, runAutopilot, sendAutopilotMessage, type OfficeDataSources,
} from './office';
import { postJournal, unpostSource } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
let firmId = '', officeFirm = '', sup = '', cus = '', userId = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Клиент ДООЕЛ', settings: { nkd: '47.11' } }).returning();
  const [o] = await db.insert(schema.firms).values({ name: 'Канцеларија', settings: { officeFirm: true } }).returning();
  firmId = f!.id; officeFirm = o!.id;
  const [u] = await db.insert(schema.users).values({ username: 'ana', name: 'Ана', role: 'acc', passwordHash: 'x' }).returning();
  userId = u!.id;
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Добавувач АД', code: '1' }).returning();
  const [c] = await db.insert(schema.partners).values({ firmId, name: 'Купувач ДОО', code: '2' }).returning();
  sup = p!.id; cus = c!.id;
}, 60_000);

describe('office numbering and settings', () => {
  it('counters are per key and year (FIX #8)', async () => {
    const n = await db.transaction(async (tx) => [await nextOfficeNumber(tx, 'kdog', 2026), await nextOfficeNumber(tx, 'kdog', 2026), await nextOfficeNumber(tx, 'kdog', 2027)]);
    expect(n).toEqual([1, 2, 1]);
    expect(contractNumber(2, 2026)).toBe('СУ-002/2026');
  });
  it('office profile patches merge instead of overwriting (FIX #7)', async () => {
    await patchOfficeProfile(db, { name: 'WISE', eurRate: 61.5 }, null);
    await patchOfficeProfile(db, { apAuto: { cash: true } }, null);
    expect(await getOfficeProfile(db)).toEqual({ name: 'WISE', eurRate: 61.5, apAuto: { cash: true } });
  });
  it('ЗЗЛП checklist and colleague statements merge inside zzlp', async () => {
    await patchOfficeZz(db, 'chk', { hz: true }, null);
    await patchOfficeZz(db, 'izj', { u1: { signed: true, at: '2026-10-01' } }, null);
    await patchOfficeZz(db, 'izj', { u2: { signed: true } }, null);
    await patchOfficeZz(db, 'chk', { iz: true }, null);
    const z = (await getOfficeProfile(db)).zzlp;
    expect(z).toEqual({ chk: { hz: true, iz: true }, izj: { u1: { signed: true, at: '2026-10-01' }, u2: { signed: true } } });
    expect((await getOfficeProfile(db)).name).toBe('WISE');
  });
});

describe('client entries (klient → pending → office decision)', () => {
  it('approving a dossier entry creates the dossier document and carries the files', async () => {
    const [file] = await db.insert(schema.files).values({ firmId, bucketKey: 'firms/x/2026/a.pdf', name: 'crm.pdf', mime: 'application/pdf', size: 1, sha256: 'a'.repeat(64), status: 'ready' }).returning();
    const [e] = await db.insert(schema.clientEntries).values({ firmId, kind: 'dossier', data: { category: 'Тековна состојба (ЦРМ)', date: '2026-10-01' } }).returning();
    await db.insert(schema.fileLinks).values({ fileId: file!.id, entityType: schema.OFFICE_FILE_ENTITY.clientEntry, entityId: e!.id });
    await db.transaction((tx) => decideClientEntry(tx, e!.id, firmId, 'approve', userId));
    const [after] = await db.select().from(schema.clientEntries).where(eq(schema.clientEntries.id, e!.id));
    expect(after).toMatchObject({ status: 'approved', decidedBy: userId, targetType: 'dossier_doc' });
    const [doc] = await db.select().from(schema.dossierDocs).where(eq(schema.dossierDocs.id, after!.targetId!));
    expect(doc!.category).toBe('Тековна состојба (ЦРМ)');
    const links = await db.select().from(schema.fileLinks).where(eq(schema.fileLinks.entityId, doc!.id));
    expect(links.map((l) => l.fileId)).toEqual([file!.id]);
    await expect(db.transaction((tx) => decideClientEntry(tx, e!.id, firmId, 'reject', userId))).rejects.toThrow(OfficeError);
    const [a] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'klAppr'), eq(schema.auditLog.entityId, e!.id)));
    expect(a).toBeTruthy();
  });
  it('approval creates and posts the real document (purchase / invoice / daily sales); rejection books nothing', async () => {
    // entries of the office firm (skipped by the autopilot tests below)
    const F = officeFirm;
    const [cl] = await db.insert(schema.users).values({ username: 'klient1', name: 'Клиент', role: 'klient', passwordHash: 'x', email: 'klient@example.mk' }).returning();
    const [e] = await db.insert(schema.clientEntries).values({ firmId: F, kind: 'purchase', submittedBy: cl!.id, data: { number: 'Ф-1', date: '2026-09-10', partnerName: 'Нов добавувач ДООЕЛ', partnerEdb: '4030111222333', total: 1180, vat: 180 } }).returning();
    const [iv] = await db.insert(schema.clientEntries).values({ firmId: F, kind: 'invoice', data: { date: '2026-09-11', partnerName: 'Нов купувач ДОО', total: 590, vat: 90, note: 'Услуга' } }).returning();
    const [sa] = await db.insert(schema.clientEntries).values({ firmId: F, kind: 'sale', data: { date: '2026-09-12', number: '15', total: 1100, vat: 100 } }).returning();
    const [r] = await db.insert(schema.clientEntries).values({ firmId: F, kind: 'purchase', data: { number: 'Ф-2' } }).returning();
    const res = await db.transaction((tx) => decideClientEntry(tx, e!.id, F, 'approve', userId));
    expect(res.target?.targetType).toBe('purchase');
    expect(res.mailIds).toHaveLength(1);
    const [m] = await db.select().from(schema.mailLog).where(eq(schema.mailLog.id, res.mailIds[0]!));
    expect(m!.to).toEqual(['klient@example.mk']);
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, res.target!.targetId));
    expect(p).toMatchObject({ status: 'posted', number: 'Ф-1', base: '1000.00', vat: '180.00' });
    const ri = await db.transaction((tx) => decideClientEntry(tx, iv!.id, F, 'approve', userId));
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, ri.target!.targetId));
    expect(inv!.status).toBe('posted');
    const rs = await db.transaction((tx) => decideClientEntry(tx, sa!.id, F, 'approve', userId));
    expect(rs.target?.targetType).toBe('sales_daily');
    const J = await db.select({ t: schema.journals.sourceType }).from(schema.journals).where(eq(schema.journals.firmId, F));
    expect(J.map((x) => x.t).sort()).toEqual(['invoice', 'purchase', 'sales_daily']);
    await db.transaction((tx) => decideClientEntry(tx, r!.id, F, 'reject', userId, 'дупликат'));
    const [rr] = await db.select().from(schema.clientEntries).where(eq(schema.clientEntries.id, r!.id));
    expect(rr!.status).toBe('rejected');
    const [j] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.journals).where(eq(schema.journals.firmId, F));
    expect(j!.n).toBe(3);
    // An entry of another firm can't be decided through this firm.
    const [x] = await db.insert(schema.clientEntries).values({ firmId: officeFirm, kind: 'dossier', data: {} }).returning();
    await expect(db.transaction((tx) => decideClientEntry(tx, x!.id, firmId, 'approve', userId))).rejects.toThrow('не постои');
  });
});

describe('autopilot run', () => {
  const today = '2026-10-20';
  it('posts → findings; posting the missing invoice resolves them; office firm skipped', async () => {
    await db.transaction((tx) => postJournal(tx, {
      firmId, date: '2026-03-05', kind: 'manual', userId: null, sourceType: 'test', sourceId: 'pay1',
      lines: [{ account: '2200', partnerId: sup, debit: 5000 }, { account: '1000', credit: 5000 }],
    }));
    const r1 = await runAutopilot(db, { today, trigger: 'manual' });
    expect(r1.firms).toBe(1);
    const open = await db.select().from(schema.autopilotFindings).where(and(eq(schema.autopilotFindings.firmId, firmId), isNull(schema.autopilotFindings.resolvedAt)));
    expect(open.some((f) => f.cat === 'Влезни фактури' && f.txt.includes('Добавувач АД'))).toBe(true);
    const msgs = await db.select().from(schema.autopilotMessages).where(eq(schema.autopilotMessages.firmId, firmId));
    expect(msgs.map((m) => m.type)).toEqual(['inv']);

    await db.transaction((tx) => postJournal(tx, {
      firmId, date: '2026-03-01', kind: 'manual', userId: null, sourceType: 'test', sourceId: 'inv1',
      lines: [{ account: '4400', debit: 5000 }, { account: '2200', partnerId: sup, credit: 5000 }],
    }));
    await runAutopilot(db, { today });
    const still = await db.select().from(schema.autopilotFindings).where(and(eq(schema.autopilotFindings.firmId, firmId), isNull(schema.autopilotFindings.resolvedAt)));
    expect(still.some((f) => f.cat === 'Влезни фактури')).toBe(false);
    expect(await db.select().from(schema.autopilotMetrics)).toHaveLength(1);
    await db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'test', sourceId: 'inv1', userId: null }));
  });
  it('auto-sends enabled message types to the portal once (dedupe by key)', async () => {
    await db.transaction((tx) => postJournal(tx, {
      firmId, date: '2026-04-02', kind: 'manual', userId: null, sourceType: 'test', sourceId: 'cash1',
      lines: [{ account: '4400', debit: 300 }, { account: '1020', credit: 300 }],
    }));
    const r = await runAutopilot(db, { today });
    expect(r.autoSent).toBe(1); // apAuto.cash = true (set above)
    const again = await runAutopilot(db, { today });
    expect(again.autoSent).toBe(0);
    const inbox = await db.select().from(schema.inboxItems).where(and(eq(schema.inboxItems.firmId, firmId), eq(schema.inboxItems.fromOffice, true)));
    expect(inbox).toHaveLength(1);
    const [inv] = await db.select().from(schema.autopilotMessages).where(and(eq(schema.autopilotMessages.firmId, firmId), eq(schema.autopilotMessages.type, 'inv')));
    expect((await sendAutopilotMessage(db, inv!.key, { portal: true, mail: false }, userId, 'Ана')).channels).toEqual(['портал']);
    expect((await sendAutopilotMessage(db, inv!.key, { portal: true, mail: false }, userId, 'Ана')).channels).toEqual([]);
  });
  it('data sources from other phases feed the snapshot', async () => {
    const src: OfficeDataSources = {
      invoices: async () => [{ number: '1', date: '2026-01-02', total: 100, paid: 0 }], employees: async () => [{ name: 'Б', active: true }],
      payrollMonths: async () => ['2026-08'], vatClosedPeriods: async () => [], fiscalDays: async () => null, vatEstimate: async () => null,
    };
    const S = await buildFirmSnapshot(db, firmId, { today, sources: src });
    expect(S!.invoices).toHaveLength(1);
    expect(S!.ledger.length).toBeGreaterThan(0);
    expect(S!.partnerNames[cus]).toBe('Купувач ДОО');
  });
});

describe('recurring invoices job', () => {
  it('issues due definitions as drafts, catches up period by period and stops at the end date', async () => {
    const [r] = await db.insert(schema.recurringInvoices).values({
      firmId, partnerId: cus, every: 'month', day: '5', next: '2026-08-05', end: '2026-09-30', dueDays: 10, note: 'Фактура за {месец}',
      items: [{ name: 'Услуги за месец', qty: 1, price: 6000, vat: 18 }],
    }).returning();
    const res = await issueDueRecurring(db, { today: '2026-10-08' });
    expect(res.issued).toBe(2);
    const [after] = await db.select().from(schema.recurringInvoices).where(eq(schema.recurringInvoices.id, r!.id));
    expect(after).toMatchObject({ next: '2026-10-05', active: false, last: '2026-10-08' });
    const D = await db.select().from(schema.invoices).where(and(eq(schema.invoices.firmId, firmId), eq(schema.invoices.partnerId, cus))).orderBy(schema.invoices.date);
    expect(D.map((d) => [d.kind, d.status, d.note])).toEqual([['invoice', 'draft', 'Фактура за август 2026'], ['invoice', 'draft', 'Фактура за септември 2026']]);
    expect(res.mail).toEqual([]);
    expect((await issueDueRecurring(db, { today: '2026-10-08' })).issued).toBe(0);
  });
});

describe('reminders job', () => {
  it('raises a reminder when a deadline enters its window, once', async () => {
    await db.insert(schema.firmDeadlines).values({ firmId, title: 'Лиценца', due: '2026-10-12', remindDays: 7 });
    const now = new Date('2026-10-08T08:00:00Z');
    expect(await dispatchReminders(db, now)).toEqual({ created: 1, sent: 1, mailIds: [] });
    expect(await dispatchReminders(db, now)).toEqual({ created: 0, sent: 0, mailIds: [] });
    // `mail` channel → a queued mail_log row to the reminder's user
    await db.update(schema.users).set({ email: 'ana@example.mk' }).where(eq(schema.users.id, userId));
    await db.insert(schema.reminders).values({ firmId, userId, title: 'Рок ДДВ', dueAt: now, channel: 'mail', key: 'test:mail' });
    const r = await dispatchReminders(db, now);
    expect(r.mailIds).toHaveLength(1);
    const [m] = await db.select().from(schema.mailLog).where(eq(schema.mailLog.id, r.mailIds[0]!));
    expect(m).toMatchObject({ to: ['ana@example.mk'], subject: 'Рок ДДВ', status: 'queued' });
  });
});
