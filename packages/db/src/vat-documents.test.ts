/**
 * Phase 5 × 3/4/7 integration: ДДВ-04 and the VAT books from the real document tables (`documentsVatSource`),
 * the manual-journal ledger fallback (`defaultVatSource`, no double counting), `VAT_SOURCE_TYPES` alignment with
 * the services' `sourceType`s, and `vatDueEstimate`.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { vatBookIn, vatBookOut } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { postJournal } from './posting';
import { saveInvoice } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import { saveSupplierCredit } from './sales/supplier-credits';
import type { DocActor } from './sales/context';
import { saveSalesDay } from './stock-docs';
import { CASH_SOURCE_TYPE, createDefaultRegisters, loadRegisters, saveVoucher } from './bank/cash';
import { firmPostingContext } from './bank/context';
import { loadVatPostingContext } from './vat-context';
import { VAT_SOURCE_TYPES } from './vat-lock';
import { closeVatPeriod, computeVatPeriod } from './vat-service';
import { defaultVatSource, documentsVatSource, ledgerVatSource, manualLedgerVatSource } from './vat-source';
import { previousVatPeriod, vatDueEstimate } from './vat-estimate';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '', cust = '', sup = '', p1 = '';
let firm: schema.Firm;
const office: DocActor = { userId: null, role: 'acc' };
const klient: DocActor = { userId: null, role: 'klient' };
const line = (name: string, price: number, rate: number) => ({ name, qty: 1, price, rate });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'ДДВ Документи ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning();
  firmId = f!.id;
  firm = f!;
  const P = await db.insert(schema.partners).values([
    { firmId, name: 'Купувач ДООЕЛ', edb: 'MK4000000000011', code: '1' },
    { firmId, name: 'Добавувач ДОО', edb: 'MK4000000000022', code: '2' },
  ]).returning();
  cust = P[0]!.id; sup = P[1]!.id;

  // Sales: 18% + 0% (exempt with deduction) line, an export invoice, an art. 32-a invoice, a pending (client) invoice.
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-10', partnerId: cust, lines: [line('Услуга', 1000, 18), line('Ослободено', 500, 0)] }, office));
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-12', partnerId: cust, export: true, lines: [line('Извоз', 2000, 18)] }, office));
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-14', partnerId: cust, art32: true, lines: [line('Градежни работи', 300, 18)] }, office));
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-15', partnerId: cust, lines: [line('Нацрт', 10000, 18)] }, klient));
  // Purchases: deductible 18% + a non-deductible part (no VAT), a travel-type noDed purchase, an art. 32-a purchase.
  p1 = (await tx((t) => savePurchase(t, firmId, { number: 'D-1', date: '2026-02-01', partnerId: sup, ptype: 'cost', groups: [
    { account: '4000', rate: 18, base: 1000, vat: 180 }, { account: '4490', rate: 18, base: 200, vat: 0 },
  ] }, office))).id;
  await tx((t) => savePurchase(t, firmId, { number: 'D-2', date: '2026-02-02', partnerId: sup, ptype: 'cost', noDed: true, groups: [{ account: '4000', rate: 18, base: 400, vat: 72 }] }, office));
  await tx((t) => savePurchase(t, firmId, { number: 'D-3', date: '2026-02-05', partnerId: sup, ptype: 'cost', art32: true, groups: [{ account: '4000', rate: 18, base: 500, vat: 0 }] }, office));
  // Supplier credit (discount) on D-1: −100 / −18 input VAT.
  await tx((t) => saveSupplierCredit(t, firmId, { kind: 'disc', date: '2026-02-20', partnerId: sup, refPurchaseId: p1, supNo: 'ОД-5', rows: [{ name: 'Попуст', qty: 1, price: 100, rate: 18 }] }, office));
  // Z report: 1180 at 18% + 105 at 5%.
  await tx((t) => saveSalesDay(t, { firmId, userId: null }, { kind: 'fisk', date: '2026-02-10', number: '42', gross: { 18: 1180, 5: 105 } }));
  // Cash voucher with VAT: fiscal receipt 1180 incl. 18%.
  await tx((t) => createDefaultRegisters(t, { firmId, userId: null }));
  const reg = (await tx((t) => loadRegisters(t, firmId))).find((r) => r.konto === '1020')!;
  await tx((t) => saveVoucher(t, { firmId, userId: null, input: { registerId: reg.id, kind: 'out', date: '2026-03-02', amt: 1180, vatRate: 18, cat: 'other', merchant: 'Маркет', docNo: 'ФС-9' } }));
  // A manual nalog on VAT kontos (no document behind it): input 50 / 9.
  await tx((t) => postJournal(t, { firmId, date: '2026-03-05', kind: 'manual', userId: null, description: 'Рачно', lines: [
    { account: '4400', debit: 50 }, { account: '130018', debit: 9 }, { account: '2200', credit: 59, partnerId: sup },
  ] }));
}, 120_000);

describe('VAT_SOURCE_TYPES', () => {
  it('matches the sourceType of every document journal and nothing stale', async () => {
    expect([...VAT_SOURCE_TYPES].sort()).toEqual(['cash_voucher', 'invoice', 'purchase', 'sales_daily', 'supplier_credit']);
    expect(VAT_SOURCE_TYPES.has(CASH_SOURCE_TYPE)).toBe(true);
    const J = await db.select({ s: schema.journals.sourceType }).from(schema.journals)
      .where(and(eq(schema.journals.firmId, firmId), isNotNull(schema.journals.sourceType)));
    const posted = new Set(J.map((j) => j.s!).filter((s) => !s.startsWith('stock:')));
    expect([...posted].sort()).toEqual([...VAT_SOURCE_TYPES].sort());
  });
});

describe('document VAT source', () => {
  it('maps every document table (pending flagged, proformas skipped)', async () => {
    const ctx = await loadVatPostingContext(db, firm);
    const d = await tx((t) => documentsVatSource.load(t, firm, '2026-01-01', '2026-03-31', ctx));
    expect(d.origin).toBe('documents');
    expect(d.docs.invoices).toHaveLength(4);
    expect(d.docs.invoices!.filter((i) => i.pend)).toHaveLength(1);
    expect(d.docs.invoices!.find((i) => i.export)!.items).toEqual([expect.objectContaining({ price: 2000, rate: 0 })]);
    expect(d.docs.purchases!.map((p) => [p.number, !!p.noDed, !!p.art32])).toEqual([['D-1', false, false], ['D-2', true, false], ['D-3', false, true]]);
    expect(d.docs.supplierCredits).toEqual([expect.objectContaining({ kind: 'disc', partner: sup, rows: [expect.objectContaining({ qty: 1, price: 100, rate: 18 })] })]);
    expect(d.docs.sales![0]!.groups).toEqual([expect.objectContaining({ rate: 5, base: 100, vat: 5 }), expect.objectContaining({ rate: 18, base: 1000, vat: 180 })]);
    expect(d.docs.cashVouchers).toEqual([expect.objectContaining({ kind: 'out', amt: 1180, rate: 18 })]);
    expect(d.partners[sup]).toEqual({ name: 'Добавувач ДОО', edb: 'MK4000000000022' });
  });

  it('the manual ledger part only sees the journal without a document', async () => {
    const ctx = await loadVatPostingContext(db, firm);
    const m = await tx((t) => manualLedgerVatSource.load(t, firm, '2026-01-01', '2026-03-31', ctx));
    expect(m.ledgerJournals).toBe(1);
    expect(m.docs.invoices).toEqual([]);
    expect(m.docs.purchases).toEqual([expect.objectContaining({ partner: sup, groups: [{ rate: 18, base: 50, vat: 9 }] })]);
  });

  it('ДДВ-04 from documents + manual journals: 0%, export, exempt, art. 32-a, non-deductible, Z, cash, credit', async () => {
    const C = await tx((t) => computeVatPeriod(t, firm, '2026-Т1'));
    expect(C.data.origin).toBe('documents');
    expect(C.data.ledgerJournals).toBe(1);
    expect(C.fields).toMatchObject({
      '01': 2000, '02': 360, // invoice 1000/180 + Z 1000/180 (pending 10000 skipped)
      '05': 100, '06': 5, // Z at 5%
      '07': 2000, // export
      '08': 500, // 0% line, exempt with right of deduction
      '11': 300, // art. 32-a sale
      '16': 500, '17': 90, // art. 32-a purchase (reverse charge)
      '20': 455,
      '21': 1950, '22': 351, // D-1 1000/180 + cash 1000/180 + manual 50/9 − credit 100/18 (non-deductible parts excluded)
      '25': 500, '26': 90,
      '29': 441, '31': 14,
    });
    // Same totals through the full ledger fallback would lose 07/08/11 — the default source is not the ledger.
    const L = await tx((t) => computeVatPeriod(t, firm, '2026-Т1', ledgerVatSource));
    expect(L.fields['07']).toBe(0);
    expect(L.fields['08']).toBe(0);

    const out = vatBookOut(C.data.docs, C.from, C.to, C.ctx, { partners: C.data.partners });
    expect(out.map((r) => [r.b18, r.v18, r.b5, r.b0, r.exp, r.a32])).toEqual([
      [1000, 180, 0, 500, 0, 0], [0, 0, 0, 0, 2000, 0], [0, 0, 0, 0, 0, 300], [1000, 180, 100, 0, 0, 0],
    ]);
    const inn = vatBookIn(C.data.docs, C.from, C.to, C.ctx, { partners: C.data.partners });
    expect(inn.map((r) => [r.no, r.b18, r.v18, r.ab, r.av, r.nd])).toEqual([
      ['D-1', 1000, 180, 0, 0, 200],
      ['D-2', 0, 0, 0, 0, 472],
      ['D-3', 0, 0, 500, 90, 0],
      ['ОД-5', -100, -18, 0, 0, 0],
      ['ФС-9', 1000, 180, 0, 0, 0],
      [expect.stringContaining('Рачно'), 50, 9, 0, 0, 0],
    ]);
  });
});

describe('posting context', () => {
  it('firmPostingContext is the VAT resolver', async () => {
    await db.update(schema.firms).set({ settings: { vatInKonto: '1301', posK: '1290' } }).where(eq(schema.firms.id, firmId));
    const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
    const a = await tx((t) => firmPostingContext(t, f!, 'p-1'));
    const b = await tx((t) => loadVatPostingContext(t, f!, 'p-1'));
    expect(a).toEqual(b);
    expect(a.firm).toMatchObject({ ddv: true, vatInKonto: '1301', posK: '1290', posPartnerId: 'p-1' });
    await db.update(schema.firms).set({ settings: {} }).where(eq(schema.firms.id, firmId));
  });
});

describe('vatDueEstimate', () => {
  it('previous period by frequency', () => {
    expect(previousVatPeriod('2026-04-15', 'quarter')).toBe('2026-Т1');
    expect(previousVatPeriod('2026-01-03', 'quarter')).toBe('2025-Т4');
    expect(previousVatPeriod('2026-01-03', 'month')).toBe('2025-12');
  });

  it('computes the last finished period, then returns the filed figure once closed', async () => {
    expect(await tx((t) => vatDueEstimate(t, firmId, '2026-04-15'))).toEqual({
      period: '2026-Т1', from: '2026-01-01', to: '2026-03-31', due: '2026-04-25', amount: 14, closed: false,
    });
    const r = await tx((t) => closeVatPeriod(t, { firmId, period: '2026-Т1', userId: null }));
    expect(r.row.ddv04).toMatchObject({ origin: 'documents', fields: { '31': 14 } });
    expect(await tx((t) => vatDueEstimate(t, firmId, '2026-05-02'))).toMatchObject({ period: '2026-Т1', amount: 14, closed: true });
    // An empty period is computed as 0.
    expect(await tx((t) => vatDueEstimate(t, firmId, '2026-08-01'))).toMatchObject({ period: '2026-Т2', due: '2026-07-25', amount: 0, closed: false });
  });

  it('null for a firm that is not VAT-registered', async () => {
    const [g] = await db.insert(schema.firms).values({ name: 'Не-ДДВ', vatRegistered: false }).returning();
    expect(await tx((t) => vatDueEstimate(t, g!.id, '2026-04-15'))).toBeNull();
  });
});
