/**
 * „⏸ Минат период – за проверка“: a bulk save never posts a document of a past VAT period (closed / filed, or earlier
 * than today's period when the firm holds those); the owner's decision (own period → listed for correction, an
 * incoming invoice with a receipt date now, reject); setting (b) off; the report of documents posted late. Synthetic
 * firms only.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import type { DocActor } from './sales/context';
import { saveInvoice } from './sales/invoices';
import { saveReadyScanDrafts } from './sales/scan-save';
import { importRows } from './retail-items';
import { closeVatPeriod, reopenVatPeriod } from './vat-service';
import { confirmPastDraft, heldScanCount, heldScanDrafts, latePostedDocuments, pastCorrections, pastPeriodContext, rejectPastDraft, setPastHold } from './vat-past';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const TODAY = '2026-10-17';
const office: DocActor = { userId: null, role: 'acc' };
let firm: schema.Firm, sup = '', cust = '';

const purDraft = (number: string, date: string, o: { docDate?: string; shifted?: boolean } = {}) => ({
  number, date, docDate: o.docDate ?? date, due: '', partnerId: sup, supplierName: 'Добавувач Тест ДОО', supplierEdb: '4030000000022',
  art32: false, ptype: 'cost', cash: false, warehouseId: null, groups: [{ konto: '4000', rate: 18, base: 1000, vat: 180 }], stock: [], shifted: !!o.shifted, credit: false,
});
const saleDraft = (number: string, date: string) => ({
  number, date, due: '', partnerId: cust, art32: false, buyer: { name: 'Купувач Тест ДООЕЛ', edb: '', address: '', city: '' },
  items: [{ itemId: '', name: 'Услуга', unit: 'ком', qty: 1, price: 1000, disc: 0, rate: 18, konto: '' }], total: 1180,
});
async function readDoc(kind: 'purchase' | 'sale', drafts: Record<string, unknown>[]) {
  const [d] = await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind, status: 'done', drafts: drafts.map((draft) => ({ draft, status: 'ok' as const, msg: '' })) }).returning();
  return d!;
}
const ctx = () => pastPeriodContext(db, firm, TODAY);
const reload = async () => { firm = (await db.select().from(schema.firms).where(eq(schema.firms.id, firm.id)))[0]!; };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'МИНАТ ПЕРИОД ТЕСТ ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning() as [schema.Firm];
  const P = await db.insert(schema.partners).values([
    { firmId: firm.id, name: 'Добавувач Тест ДОО', edb: '4030000000022', code: '1' },
    { firmId: firm.id, name: 'Купувач Тест ДООЕЛ', edb: '4030000000011', code: '2' },
  ]).returning();
  sup = P[0]!.id; cust = P[1]!.id;
  // Q2/2026 filed in WISE (a zero return)
  await tx((t) => closeVatPeriod(t, { firmId: firm.id, period: '2026-Т2', userId: null }));
}, 120_000);

describe('bulk save holds past VAT periods', () => {
  it('10 drafts, 2 dated in a closed VAT period: 8 are posted, 2 are held with the reason', async () => {
    const D = [
      ...Array.from({ length: 8 }, (_, k) => purDraft(`ВФ-${k + 1}`, `2026-10-0${k + 1}`)),
      purDraft('ВФ-J1', '2026-06-17'),
      // the read moved it to today because Q2 is closed (`shifted`) — the invoice date decides
      purDraft('ВФ-J2', TODAY, { docDate: '2026-06-17', shifted: true }),
    ];
    const d = await readDoc('purchase', D);
    const R = await saveReadyScanDrafts(db, { firm, kind: 'purchase', where: eq(schema.aiDocuments.id, d.id), actor: office, past: await ctx() });
    expect(R).toMatchObject({ saved: 8, total: 10, errs: [] });
    expect(R.held.map((h) => h.number)).toEqual(['ВФ-J1', 'ВФ-J2']);
    expect(R.held[0]!.text).toMatch(/^ДДВ Q2\/2026 \(април–јуни\), затворен/);
    const [x] = await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, d.id));
    expect(x!.drafts.filter((y) => y.savedId)).toHaveLength(8);
    const held = x!.drafts.filter((y) => y.status === 'past');
    expect(held).toHaveLength(2);
    expect(held[0]!.msg).toBe('⏸ минат период – за проверка: ' + held[0]!.past!.text);
    expect(held[0]!.past).toMatchObject({ period: '2026-Т2', closed: true, reason: 'closed' });
    expect((await db.select().from(schema.purchases).where(eq(schema.purchases.firmId, firm.id))).map((p) => p.number).sort()).not.toContain('ВФ-J1');
    expect(await heldScanCount(db, [firm.id])).toBe(2);
    const H = await heldScanDrafts(db, firm.id);
    expect(H.map((h) => [h.number, h.date])).toEqual([['ВФ-J1', '2026-06-17'], ['ВФ-J2', '2026-06-17']]);
    const [a] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firm.id), eq(schema.auditLog.action, 'pastHold')));
    expect(a!.data).toMatchObject({ held: 2, kind: 'purchase' });
  });

  it('confirm „во својот период“ posts into the past period and lists it for correction', async () => {
    // Q3/2026 is not closed but earlier than today's Q4: held by (b)
    const d = await readDoc('sale', [saleDraft('ИФ-07/26', '2026-07-20')]);
    const R = await saveReadyScanDrafts(db, { firm, kind: 'sale', where: eq(schema.aiDocuments.id, d.id), actor: office, past: await ctx() });
    expect(R).toMatchObject({ saved: 0, held: [{ number: 'ИФ-07/26', text: 'ДДВ Q3/2026 (јули–септември), претходен период' }] });
    const r = await tx((t) => confirmPastDraft(t, { firm, docId: d.id, index: 0, mode: 'own', actor: office, today: TODAY }));
    expect(r).toMatchObject({ entityType: 'invoice', date: '2026-07-20', period: '2026-Т3', correction: true });
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    expect(inv).toMatchObject({ date: '2026-07-20', status: 'posted' });
    const C = await pastCorrections(db, firm.id, '2026-Т3');
    expect(C).toMatchObject([{ entityType: 'invoice', id: r.id, number: inv!.number, date: '2026-07-20', exists: true }]);
    expect(await pastCorrections(db, firm.id, '2026-Т4')).toEqual([]);
    const [a] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firm.id), eq(schema.auditLog.action, 'pastPost')));
    expect(a).toMatchObject({ entityType: 'invoice', entityId: r.id });
    // an outgoing invoice is never moved to the current period
    const d2 = await readDoc('sale', [saleDraft('ИФ-08/26', '2026-08-03')]);
    await saveReadyScanDrafts(db, { firm, kind: 'sale', where: eq(schema.aiDocuments.id, d2.id), actor: office, past: await ctx() });
    await expect(tx((t) => confirmPastDraft(t, { firm, docId: d2.id, index: 0, mode: 'receipt', receiptDate: TODAY, actor: office, today: TODAY }))).rejects.toThrow(/датумот на издавање/);
    // „✕ Отфрли“ deletes the draft (audited)
    await tx((t) => rejectPastDraft(t, { firmId: firm.id, docId: d2.id, index: 0, userId: null }));
    expect(await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, d2.id))).toEqual([]);
    expect((await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firm.id), eq(schema.auditLog.action, 'pastReject'))))).toHaveLength(1);
  });

  it('a closed period refuses „во својот период“ until it is reopened', async () => {
    const [h] = (await heldScanDrafts(db, firm.id)).filter((x) => x.number === 'ВФ-J1');
    await expect(tx((t) => confirmPastDraft(t, { firm, docId: h!.docId, index: h!.index, mode: 'own', actor: office, today: TODAY }))).rejects.toThrow(/затворен – прво отворете го/);
  });

  it('an incoming invoice with a receipt date in the current period posts into the current VAT period', async () => {
    const [h] = (await heldScanDrafts(db, firm.id)).filter((x) => x.number === 'ВФ-J2');
    await expect(tx((t) => confirmPastDraft(t, { firm, docId: h!.docId, index: h!.index, mode: 'receipt', receiptDate: '2026-09-30', actor: office, today: TODAY }))).rejects.toThrow(/тековниот ДДВ период/);
    const r = await tx((t) => confirmPastDraft(t, { firm, docId: h!.docId, index: h!.index, mode: 'receipt', receiptDate: '2026-10-15', actor: office, today: TODAY }));
    expect(r).toMatchObject({ entityType: 'purchase', date: '2026-10-15', period: '2026-Т4', correction: false });
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, r.id));
    expect(p).toMatchObject({ number: 'ВФ-J2', date: '2026-10-15', docDate: '2026-06-17' });
    expect(await pastCorrections(db, firm.id, '2026-Т2')).toEqual([]);
    expect(await heldScanCount(db, [firm.id])).toBe(1);
  });

  it('setting (b) off: only closed periods are held', async () => {
    await tx((t) => setPastHold(t, { firmId: firm.id, on: false, userId: null }));
    await reload();
    expect((await ctx()).holdPrevious).toBe(false);
    const d = await readDoc('purchase', [purDraft('ВФ-Q3', '2026-08-10'), purDraft('ВФ-Q2', '2026-05-10')]);
    const R = await saveReadyScanDrafts(db, { firm, kind: 'purchase', where: eq(schema.aiDocuments.id, d.id), actor: office, past: await ctx() });
    expect(R.saved).toBe(1);
    expect(R.held.map((h) => h.number)).toEqual(['ВФ-Q2']);
    await tx((t) => setPastHold(t, { firmId: firm.id, on: true, userId: null }));
    await reload();
    expect((await ctx()).holdPrevious).toBe(true);
  });
});

describe('sales bulk save rules (services firm, storno files, „Шема“)', () => {
  it('a „check“ draft with only „нов купувач“ / unlinked lines is ready without goods; storno files are never saved; the scheme is kept', async () => {
    await db.update(schema.firms).set({ settings: { ...(firm.settings as object), schemeProfiles: [{ no: 2, name: 'Услуги' }] } }).where(eq(schema.firms.id, firm.id));
    await reload();
    const [f] = await db.insert(schema.files).values({ firmId: firm.id, bucketKey: 'k/storno', name: 'storno-15.pdf', mime: 'application/pdf', size: 1, sha256: 'a'.repeat(64), status: 'ready' }).returning();
    const [ok] = await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind: 'sale', status: 'done', drafts: [
      { draft: saleDraft('ИФ-С1', '2026-10-06'), status: 'check', msg: 'нов купувач: Купувач Тест ДООЕЛ · 1 ставки не се поврзани со артикл' },
      { draft: saleDraft('ИФ-С2', '2026-10-06'), status: 'check', msg: 'збирот не се совпаѓа' },
    ] }).returning();
    const [st] = await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind: 'sale', status: 'done', fileId: f!.id, drafts: [{ draft: saleDraft('ИФ-С3', '2026-10-06'), status: 'ok', msg: '' }] }).returning();
    const R = await saveReadyScanDrafts(db, { firm, kind: 'sale', where: inArray(schema.aiDocuments.id, [ok!.id, st!.id]), actor: office, past: await ctx(), scheme: 2 });
    expect(R).toMatchObject({ saved: 1, total: 1, errs: [] });
    const [d] = await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, ok!.id));
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, d!.drafts[0]!.savedId!));
    expect(inv!.data).toMatchObject({ scheme: 2 });
    expect(d!.drafts[1]!.savedId).toBeUndefined();
    const [s2] = await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, st!.id));
    expect(s2!.drafts[0]!.savedId).toBeUndefined();
  });
});

describe('Excel import', () => {
  it('purchases / invoices of a past VAT period are skipped with the reason, the others imported', async () => {
    const A = { firmId: firm.id, userId: null as unknown as string, role: 'acc' };
    const past = await ctx();
    const r = await tx((t) => importRows(t, A, 'purchases', [
      { number: 'XL-1', date: '2026-10-05', partner: 'Добавувач Тест ДОО', base18: 100, vat18: 18 },
      { number: 'XL-2', date: '2026-06-05', partner: 'Добавувач Тест ДОО', base18: 100, vat18: 18 },
    ], { date: TODAY, today: TODAY, past }));
    expect(r.skip).toEqual([expect.stringMatching(/^XL-2: ⏸ минат период – за проверка \(ДДВ Q2\/2026 \(април–јуни\), затворен/)]);
    const S = await db.select({ n: schema.purchases.number }).from(schema.purchases).where(eq(schema.purchases.firmId, firm.id));
    expect(S.map((x) => x.n)).toContain('XL-1');
    expect(S.map((x) => x.n)).not.toContain('XL-2');
  });
});

describe('Документи книжени во минат/затворен ДДВ период по затворањето', () => {
  it('lists documents created after the period was filed, after the filing deadline, or after a chosen date', async () => {
    const [f2] = await db.insert(schema.firms).values({ name: 'ДОЦНА КНИЖЕЊА ТЕСТ ДОО', vatRegistered: true, vatPeriod: 'quarter' }).returning();
    const [c2] = await db.insert(schema.partners).values({ firmId: f2!.id, name: 'Купувач Б', code: '1' }).returning();
    const inv = (date: string) => tx((t) => saveInvoice(t, f2!.id, { kind: 'invoice', date, partnerId: c2!.id, lines: [{ name: 'Услуга', qty: 1, price: 100, rate: 18 }] }, office));
    // Q1/2025: never closed in WISE — posted now, long after its deadline (25.04.2025)
    const a = await inv('2025-02-10');
    // Q2/2025: filed, then reopened and a document added after the filing
    const b0 = await inv('2025-05-05');
    await tx((t) => closeVatPeriod(t, { firmId: f2!.id, period: '2025-Т2', userId: null }));
    await tx((t) => reopenVatPeriod(t, { firmId: f2!.id, period: '2025-Т2', userId: null }));
    const b = await inv('2025-06-17');
    const L = await latePostedDocuments(db, f2!, { from: '2025-01-01', to: '2025-12-31', today: TODAY });
    expect(L.map((x) => [x.id, x.basis, x.period])).toEqual([[a.id, 'due', '2025-Т1'], [b.id, 'closed', '2025-Т2']]);
    expect(L.some((x) => x.id === b0.id)).toBe(false);
    expect(L[1]!.periodText).toBe('ДДВ Q2/2025 (април–јуни)');
    // after a chosen date (yesterday): every document of the past periods created since
    const all = await latePostedDocuments(db, f2!, { from: '2025-01-01', to: '2025-12-31', after: '2025-01-01', today: TODAY });
    expect(all.map((x) => x.id).sort()).toEqual([a.id, b0.id, b.id].sort());
    expect(all.every((x) => x.basis === 'after')).toBe(true);
    // the current period is never „late“
    await inv(TODAY);
    expect((await latePostedDocuments(db, f2!, { from: '2026-10-01', to: '2026-12-31', today: TODAY }))).toEqual([]);
  });
});
