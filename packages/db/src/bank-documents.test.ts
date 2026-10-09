/**
 * Bank ↔ Phase 3 documents and Phase 6 payroll on PGlite: open items from invoices / purchases (paid / remaining,
 * credit notes, supplier credits, compensations, ledger-item refs) and net-salary matching (legacy `payMatch`).
 */
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { payDraft, payTotals, resolvePayParams } from '@wise/core';
import {
  addManualLine, applyMatches, documentOpenItemsSource, documentPayments, kompOpenItems, lineOpenDocs, linkLine, openItemsSource,
  proposeMatches, saveBankAccount, saveCompensation,
} from './bank/index';
import { saveInvoice, type InvoiceInput } from './sales/invoices';
import { savePurchase, type PurchaseInput } from './sales/purchases';
import { saveSupplierCredit } from './sales/supplier-credits';
import type { DocActor } from './sales/context';
import { loadRun, saveRun } from './payroll';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
const T = <R>(f: (tx: typeof db) => Promise<R>) => db.transaction((tx) => f(tx as unknown as typeof db));
const office: DocActor = { userId: null, role: 'acc' };
let firmId = '', cust = '', sup = '', svc = '', mkd = '';
let inv1 = '', inv2 = '', pur1 = '', pur2 = '';

const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({
  kind: 'invoice', date: '2026-03-10', partnerId: cust, lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 1000, rate: 18 }], ...o,
});
const pur = (o: Partial<PurchaseInput> = {}): PurchaseInput => ({
  number: 'D-1', date: '2026-03-01', partnerId: sup, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 500, vat: 90 }], stock: [], costs: {}, ...o,
});
const pay = (ids: { invoiceIds?: string[]; purchaseIds?: string[] }) => T((tx) => documentPayments(tx, firmId, ids));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Документи ДООЕЛ' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач ДОО', code: '1' }, { firmId, name: 'Добавувач ДООЕЛ', code: '2' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  svc = (await db.insert(schema.items).values({ firmId, name: 'Консалтинг', code: '20', type: 'service', vatRate: 18 }).returning())[0]!.id;
  mkd = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Стопанска', account: '200000000111111', cur: 'MKD', konto: '1000' } }));
}, 60_000);

describe('open items from documents', () => {
  it('is the default source', () => {
    expect(openItemsSource()).toBe(documentOpenItemsSource);
  });

  it('new invoice and purchase are fully open', async () => {
    inv1 = (await T((tx) => saveInvoice(tx, firmId, inv(), office))).id;
    pur1 = (await T((tx) => savePurchase(tx, firmId, pur(), office))).id;
    const M = await pay({ invoiceIds: [inv1], purchaseIds: [pur1] });
    expect(M.get(inv1)).toEqual({ type: 'invoice', total: 1180, paid: 0, remaining: 1180 });
    expect(M.get(pur1)).toEqual({ type: 'purchase', total: 590, paid: 0, remaining: 590 });
    const O = await T((tx) => documentOpenItemsSource.load(tx, firmId, 2026));
    expect(O.invoices.map((d) => [d.id, d.total, d.paidOther, d.partner])).toEqual([[inv1, 118000, 0, cust]]);
    expect(O.purchases.map((d) => [d.id, d.total, d.paidOther])).toEqual([[pur1, 59000, 0]]);
  });

  it('partial bank payment linked manually → paid / remaining', async () => {
    const line = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-03-15', amount: 500, desc: 'Купувач ДОО уплата' }));
    const D = await T((tx) => lineOpenDocs(tx, firmId, 2026, line));
    expect(D.docs.map((z) => [z.doc.id, z.open])).toEqual([[inv1, 118000]]);
    await T((tx) => linkLine(tx, { firmId, userId: null, year: 2026, lineId: line, docIds: [inv1] }));
    expect((await pay({ invoiceIds: [inv1] })).get(inv1)).toMatchObject({ paid: 500, remaining: 680 });
  });

  it('the rest is matched automatically by amount and closes the invoice', async () => {
    const number = (await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv1)))[0]!.number;
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-03-20', amount: 680, desc: `Плаќање по фактура ${number}` }));
    await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-03-20', amount: -590, desc: 'Добавувач ДООЕЛ D-1' }));
    const P = await T((tx) => proposeMatches(tx, firmId, 2026));
    expect(P.map((p) => [p.amount, p.how, p.konto, p.partnerId])).toEqual(expect.arrayContaining([
      [680, expect.stringMatching(/num|amt/), '1200', cust], [-590, expect.stringMatching(/num|amt|purchase/), '2200', sup],
    ]));
    await T((tx) => applyMatches(tx, { firmId, userId: null, year: 2026, accept: P.map((p) => p.lineId) }));
    const M = await pay({ invoiceIds: [inv1], purchaseIds: [pur1] });
    expect(M.get(inv1)).toMatchObject({ paid: 1180, remaining: 0 });
    expect(M.get(pur1)).toMatchObject({ paid: 590, remaining: 0 });
  });

  it('credit note and supplier credit reduce the open amount', async () => {
    inv2 = (await T((tx) => saveInvoice(tx, firmId, inv({ date: '2026-04-01', lines: [{ itemId: svc, name: 'Консалтинг', qty: 2, price: 1000, rate: 18 }] }), office))).id;
    await T((tx) => saveInvoice(tx, firmId, inv({ kind: 'credit', date: '2026-04-05', refInvoiceId: inv2, creditKind: 'price', lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 500, rate: 18 }] }), office));
    pur2 = (await T((tx) => savePurchase(tx, firmId, pur({ number: 'D-2', date: '2026-04-02', groups: [{ account: '4000', rate: 18, base: 1000, vat: 180 }] }), office))).id;
    await T((tx) => saveSupplierCredit(tx, firmId, { kind: 'disc', date: '2026-04-06', partnerId: sup, refPurchaseId: pur2, rows: [{ name: 'Попуст', qty: 1, price: 100, rate: 18, account: '4000' }] }, office));
    const M = await pay({ invoiceIds: [inv2], purchaseIds: [pur2] });
    expect(M.get(inv2)).toMatchObject({ total: 2360, paid: 590, remaining: 1770 });
    expect(M.get(pur2)).toMatchObject({ total: 1180, paid: 118, remaining: 1062 });
  });

  it('a compensation reduces both sides; closed documents of the year stay listed', async () => {
    const K = await T((tx) => kompOpenItems(tx, firmId, 2026, [cust, sup]));
    expect(K.map((k) => [k.refId, k.side, k.konto, k.open])).toEqual([[inv2, 'rec', '1200', 177000], [pur2, 'pay', '2200', 106200]]);
    await T((tx) => saveCompensation(tx, { firmId, userId: null, input: { kind: 'multi', date: '2026-04-10', year: 2026, partnerIds: [cust, sup], amounts: { [inv2]: 1000, [pur2]: 1000 } } }));
    const M = await pay({ invoiceIds: [inv2], purchaseIds: [pur2] });
    expect(M.get(inv2)).toMatchObject({ paid: 1590, remaining: 770 });
    expect(M.get(pur2)).toMatchObject({ paid: 1118, remaining: 62 });
    const O = await T((tx) => documentOpenItemsSource.load(tx, firmId, 2026));
    expect(O.invoices.map((d) => d.id).sort()).toEqual([inv1, inv2].sort());
    // Next year: only documents still open are carried.
    const O27 = await T((tx) => documentOpenItemsSource.load(tx, firmId, 2027));
    expect(O27.invoices.map((d) => d.id)).toEqual([inv2]);
    expect(O27.purchases.map((d) => d.id)).toEqual([pur2]);
  });

  it('cash purchases are paid; bank lines linked to ledger items count on the document with that number', async () => {
    const c = (await T((tx) => savePurchase(tx, firmId, pur({ number: 'ФС-9', date: '2026-04-03', cash: true }), office))).id;
    expect((await pay({ purchaseIds: [c] })).get(c)).toMatchObject({ paid: 590, remaining: 0 });
    const line = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-04-20', amount: -62, desc: 'стара врска', konto: '2200', partnerId: sup }));
    await db.update(schema.bankLines).set({ refType: 'purchase', refId: `L|2200|${sup}|D-2`, refLabel: 'D-2' }).where(eq(schema.bankLines.id, line));
    expect((await pay({ purchaseIds: [pur2] })).get(pur2)).toMatchObject({ paid: 1180, remaining: 0 });
  });
});

describe('payroll net-salary matching (legacy payMatch)', () => {
  it('books a bank outflow equal to the run net on pay_net with the payroll month', async () => {
    const E = await db.insert(schema.employees).values([
      { firmId, no: '1', name: 'Ана Петрова', embg: '0101990450001', netBase: '30000', start: '2020-03-01' },
      { firmId, no: '2', name: 'Борис Илиев', embg: '0202985450002', netBase: '45000', start: '2015-06-15' },
    ]).returning();
    const d = payDraft('2026-04', E.map((e) => ({ id: e.id, no: e.no ?? '', name: e.name, embg: e.embg ?? '', netBase: Number(e.netBase), coef: Number(e.coef), start: e.start ?? undefined, active: e.active })));
    const { id } = await T((tx) => saveRun(tx, { firmId, month: d.month, params: d.params, emps: d.emps, userId: null }));
    const run = (await loadRun(db, firmId, { id }))!;
    const tot = payTotals(run.emps, resolvePayParams(run.params, run.month));
    const one = tot.emps[0]!.net;
    const a = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-05-10', amount: -tot.net, desc: 'Исплата плати' }));
    const b = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: mkd, date: '2026-05-11', amount: -one, desc: 'Плата Ана' }));
    const P = await T((tx) => proposeMatches(tx, firmId, 2026));
    expect(P.find((p) => p.lineId === a)).toMatchObject({ how: 'payroll', konto: '2401' });
    expect(P.find((p) => p.lineId === b)).toMatchObject({ how: 'payroll', konto: '2401' });
    await T((tx) => applyMatches(tx, { firmId, userId: null, year: 2026, accept: [a, b] }));
    const L = await db.select().from(schema.bankLines).where(eq(schema.bankLines.id, a));
    expect(L[0]).toMatchObject({ konto: '2401', payRef: '2026-04', auto: 'payroll' });
  });
});
