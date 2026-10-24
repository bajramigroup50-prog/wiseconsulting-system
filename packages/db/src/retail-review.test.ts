/**
 * Retail review fixes on PGlite (a firm whose stores are kept at retail value): transfers out of a store, a new МПЦ
 * on a transfer levels the earlier stock, the daily turnover clears 6630 (Z without goods issue, `trgNoVat`), several
 * store sales (ПР) a day next to the real Z report, a store ПЛТ keeps its МПЦ.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { etBook } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadStockContext, replaceSourceMoves } from './stock-service';
import { stockAt } from '@wise/core';
import { deleteSalesDay, repostSalesDay, saveSalesDay, saveStockCount, saveTransfer, type Actor } from './stock-docs';
import { deleteStoreOut, postFiskRead, saveStoreOut } from './parity-retail';
import { savePurchase } from './sales/purchases';
import { loadStockSales, stockDocResolver } from './stock-reports';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let A: Actor;
let firmId = '';
let s1 = '';
let s2 = '';
let s3 = '';
let sup = '';
const I: Record<string, string> = {};
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const r2 = (x: number) => Math.round(x * 100) / 100;

async function journal(sourceType: string, sourceId: string) {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(schema.journalLines.lineNo);
  const by: Record<string, number> = {};
  for (const l of L) by[l.account] = r2((by[l.account] ?? 0) + Number(l.debit) - Number(l.credit));
  return { L, by, d: r2(L.reduce((s, l) => s + Number(l.debit), 0)), c: r2(L.reduce((s, l) => s + Number(l.credit), 0)) };
}
/** Balance (D − C) of an account at a location over the whole ledger. */
async function balanceAt(account: string, loc: string) {
  const L = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, account), eq(schema.journalLines.locationId, loc)));
  return r2(L.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
}
async function etClose(wh: string) {
  const L = await loadStockContext(db, firmId);
  const sales = await loadStockSales(db, firmId);
  return etBook(L.ctx, { wh, from: '2026-01-01', to: '2026-12-31', sales, docOf: await stockDocResolver(db, L), locationName: L.locName }).totals.close;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Маркет ДООЕЛ', vatRegistered: true, settings: { sch: { retailMethod: true } } }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Добавувач', code: '1' }).returning();
  sup = p!.id;
  const rows = await db.insert(schema.items).values([
    { firmId, code: '001', name: 'Кафе', type: 'goods', unit: 'ком', price: '100', vatRate: 18 },
    { firmId, code: '002', name: 'Без цена', type: 'goods', unit: 'ком', vatRate: 18 },
    { firmId, code: '003', name: 'Колач', type: 'product', unit: 'ком', price: '50', vatRate: 18 },
  ]).returning();
  for (const r of rows) I[r.code!] = r.id;
  const locs = await db.insert(schema.codes).values([
    { firmId, cb: 'store', code: '02', name: 'Продавница 1' },
    { firmId, cb: 'store', code: '03', name: 'Продавница 2' },
    { firmId, cb: 'store', code: '04', name: 'Продавница 3' },
  ]).returning();
  s1 = locs[0]!.id;
  s2 = locs[1]!.id;
  s3 = locs[2]!.id;
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'purchase', sourceId: 'P-1', date: '2026-01-05', userId: null, partnerId: sup,
    moves: [{ id: '', date: '2026-01-05', item: I['001']!, qty: 20, value: 1200, type: 'in', wh: 'main', lines: [{ account: '6600', debit: 1200, credit: 0 }, { account: '2200', debit: 0, credit: 1200 }] }],
  }));
  // 10 pieces into store 1 at 118: D 6630 1 180 / C 6600 600 / C 6694 400 / C 6640 180
  await tx((t) => saveTransfer(t, A, { date: '2026-02-01', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 10, sp: 118 }] }));
}, 120_000);

describe('transfer out of a store kept at retail value', () => {
  it('store → warehouse clears 6630 / 6694 / 6640 at the store price; the cost goes back to 6600', async () => {
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-02-02', from: s1, to: 'main', lines: [{ itemId: I['001']!, qty: 2 }] }));
    const j = (await journal('stock:transfer', r.id))!;
    expect(j.by).toEqual({ '6600': 120, '6694': 80, '6640': 36, '6630': -236 });
    expect(j.d).toBe(j.c);
    expect(await balanceAt('6630', s1)).toBe(944);
  });

  it('store → store: the sender is cleared, the receiver gets its retail split; both balance', async () => {
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-02-02', from: s1, to: s2, lines: [{ itemId: I['001']!, qty: 2, sp: 130 }] }));
    const j = (await journal('stock:transfer', r.id))!;
    expect(j.d).toBe(j.c);
    expect(j.by['6600'] ?? 0).toBe(0);
    expect(await balanceAt('6630', s1)).toBe(708);
    expect(await balanceAt('6630', s2)).toBe(260);
    expect(await etClose(s1)).toBe(708);
    expect(await etClose(s2)).toBe(260);
  });
});

describe('a transfer with a new МПЦ', () => {
  it('levels the stock already in the store (stock at the date − received qty)', async () => {
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-02-03', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 2, sp: 125 }] }));
    const [lv] = await db.select().from(schema.levellingDocs).where(and(eq(schema.levellingDocs.firmId, firmId), eq(schema.levellingDocs.date, '2026-02-03')));
    expect(lv!.note).toMatch(/од преносница/);
    expect(lv!.lines).toEqual([{ itemId: I['001'], qty: 6, old: 118, new: 125, qtyImp: true }]);
    // 6 × 7 = 42 incl. VAT
    expect((await journal('levelling', lv!.id))!.by['6630']).toBe(42);
    expect((await journal('stock:transfer', r.id))!.by['6630']).toBe(250);
    expect(await balanceAt('6630', s1)).toBe(1000);
    expect(await etClose(s1)).toBe(1000);
  });
});

describe('the daily turnover of a store kept at retail value clears 6630', () => {
  it('a Z report without „Излез на стока“ in a store with goods on stock is refused (a later попис would clear 6630 again)', async () => {
    const e = await err(tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-05', wh: s1, number: '5', gross: { 18: 250 }, fisk: { sc: 'trg' } })));
    expect(e.message).toMatch(/штиклирајте „Излез на стока“/);
    // the same for a fiscal read posted without the goods issue
    const read = { device: 'AC1', from: '2026-02-05', to: '2026-02-05', days: [{ date: '2026-02-05', z: '5', gross: { 'А': 250 }, vat: { 'А': 38.14 }, total: 250, cash: 250 }] };
    expect((await err(tx((t) => postFiskRead(t, A, { read, today: '2026-02-06', nonVat: false, sum: false, sc: 'trg', wh: s1 })))).message).toMatch(/штиклирајте „Излез на стока“/);
    expect(await balanceAt('6630', s1)).toBe(1000);
  });

  it('a store without goods on stock: the Z report without a goods issue clears 6630 by the turnover', async () => {
    const z = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-05', wh: s3, number: '5', gross: { 18: 118 }, fisk: { sc: 'trg' } }));
    const j = (await journal('sales_daily', z.id))!;
    expect(j.d).toBe(j.c);
    expect([j.by['6630'], j.by['6640']]).toEqual([-118, 18]);
  });

  it('with „Излез на стока“ the issue clears 6630 once (no second clearing in the revenue journal)', async () => {
    const z = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-06', wh: s1, number: '6', gross: { 18: 125 }, fisk: { sc: 'trg' }, issue: true, lines: [{ itemId: I['001']!, qty: 1, price: 125 }] }));
    expect((await journal('sales_daily', z.id))!.by['6630']).toBeUndefined();
    expect((await journal('stock:sales_daily', z.id))!.by['6630']).toBe(-125);
    expect(await balanceAt('6630', s1)).toBe(875);
    expect(await etClose(s1)).toBe(875);
  });

  it('trgNoVat: the turnover leaves 6630 as cost of goods sold 7010 + realised margin 6694', async () => {
    const z = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-07', wh: s2, number: '7', gross: { 18: 130 }, fisk: { sc: 'trgNoVat' } }));
    const j = (await journal('sales_daily', z.id))!;
    expect(j.by['6630']).toBe(-130);
    expect(j.by['7010']).toBeGreaterThan(0);
    expect(r2(j.by['7010']! + j.by['6694']!)).toBe(130);
    expect(j.d).toBe(j.c);
  });
});

describe('store sales (ПР) next to the Z report of the day', () => {
  it('several ПР a day; a Z report is saved without „замени“, its replace and a fiscal read leave the ПР alone', async () => {
    const p1 = await tx((t) => saveStoreOut(t, A, { kind: 'sale', date: '2026-02-10', wh: s2, account: '1009', lines: [{ itemId: I['001']!, qty: 1 }] }));
    const p2 = await tx((t) => saveStoreOut(t, A, { kind: 'sale', date: '2026-02-10', wh: s2, account: '1009', lines: [{ itemId: I['001']!, qty: 1 }] }));
    const so = await db.select().from(schema.storeOuts).where(eq(schema.storeOuts.firmId, firmId));
    expect(so).toHaveLength(2);
    // the ПР's own issue cleared 6630 at the store price: no second clearing on its turnover row
    for (const s of so) {
      expect(s.salesDayId).toBeTruthy();
      expect((await journal('sales_daily', s.salesDayId!))!.by['6630']).toBeUndefined();
    }
    const z = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-10', wh: s2, number: '10', gross: { 18: 250 }, fisk: { sc: 'trg' } }));
    expect((await err(tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-10', wh: s2, number: '10', gross: { 18: 250 }, fisk: { sc: 'trg' } })))).message).toMatch(/веќе има прокнижен фискален извештај/);
    const z2 = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-10', wh: s2, number: '10', gross: { 18: 375 }, fisk: { sc: 'trg' }, replace: true }));
    const rows = () => db.select().from(schema.salesDaily).where(and(eq(schema.salesDaily.firmId, firmId), eq(schema.salesDaily.date, '2026-02-10')));
    let R = await rows();
    expect(R.map((r) => r.id).sort()).toEqual([so[0]!.salesDayId!, so[1]!.salesDayId!, z2.id].sort());
    expect(R.some((r) => r.id === z.id)).toBe(false);
    // a fiscal read of the day overwrites the Z report, not a ПР
    const read = { device: 'AC1', from: '2026-02-10', to: '2026-02-10', days: [{ date: '2026-02-10', z: '10', gross: { 'А': 500 }, vat: { 'А': 76.27 }, total: 500, cash: 500 }] };
    const f = await tx((t) => postFiskRead(t, A, { read, today: '2026-02-11', nonVat: false, sum: false, sc: 'trg', wh: s2 }));
    expect(f.ids).toEqual([z2.id]);
    R = await rows();
    expect(R).toHaveLength(3);
    expect(Number(R.find((r) => r.id === z2.id)!.total)).toBe(500);
    expect(R.filter((r) => r.fisk?.mo).map((r) => r.fisk!.mo).sort()).toEqual([p1.id, p2.id].sort());
  });
});

describe('a ПР with a product line', () => {
  it('clears 6630 by the goods only (the product leaves 6300 by its own issue), the same on a re-post', async () => {
    // 5 cakes made into store 1 at cost 50 (a product stays at cost: D 6300 / C 6000)
    await tx((t) => replaceSourceMoves(t, {
      firmId, sourceType: 'production', sourceId: 'PR-1', date: '2026-02-14', userId: null,
      moves: [{ id: '', date: '2026-02-14', item: I['003']!, qty: 5, value: 250, type: 'in', wh: s1, lines: [{ account: '6300', debit: 250, credit: 0 }, { account: '6000', debit: 0, credit: 250 }] }],
    }));
    const b0 = await balanceAt('6630', s1);
    const p = await tx((t) => saveStoreOut(t, A, { kind: 'sale', date: '2026-02-15', wh: s1, account: '1009', lines: [{ itemId: I['001']!, qty: 1 }, { itemId: I['003']!, qty: 1, price: 59 }] }));
    const [so] = await db.select().from(schema.storeOuts).where(eq(schema.storeOuts.id, p.id));
    const [row] = await db.select().from(schema.salesDaily).where(eq(schema.salesDaily.id, so!.salesDayId!));
    expect(row!.lines).toHaveLength(2);
    const j = (await journal('sales_daily', row!.id))!;
    expect(j.by['6630']).toBeUndefined();
    expect(j.d).toBe(j.c);
    expect(r2(b0 - (await balanceAt('6630', s1)))).toBe(125);
    await tx((t) => repostSalesDay(t, A, row!.id));
    expect((await journal('sales_daily', row!.id))!.by).toEqual(j.by);
    // nothing issued twice: only the ПР's own moves
    expect(await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, 'sales_daily'), eq(schema.stockMoves.sourceId, row!.id)))).toHaveLength(0);
  });
});

describe('the turnover row of a ПР', () => {
  it('is neither deleted nor edited on its own; the ПР deletes it, also when it is already gone', async () => {
    const p = await tx((t) => saveStoreOut(t, A, { kind: 'sale', date: '2026-02-16', wh: s1, account: '1009', lines: [{ itemId: I['001']!, qty: 1 }] }));
    const [so] = await db.select().from(schema.storeOuts).where(eq(schema.storeOuts.id, p.id));
    const sd = so!.salesDayId!;
    expect((await err(tx((t) => deleteSalesDay(t, A, sd)))).message).toMatch(/Овој промет е од ПР/);
    expect((await err(tx((t) => saveSalesDay(t, A, { id: sd, kind: 'fisk', date: '2026-02-16', wh: s1, gross: { 18: 125 }, fisk: { sc: 'trg' }, issue: true, lines: [{ itemId: I['001']!, qty: 1, price: 125 }] })))).message).toMatch(/менувајте го ПР-от/);
    // rows saved before the `mo` marker are known by the ПР's link
    await db.update(schema.salesDaily).set({ fisk: { sc: 'trg' } }).where(eq(schema.salesDaily.id, sd));
    expect((await err(tx((t) => deleteSalesDay(t, A, sd)))).message).toMatch(/Овој промет е од ПР/);
    await tx((t) => deleteStoreOut(t, A, p.id));
    expect(await db.select().from(schema.salesDaily).where(eq(schema.salesDaily.id, sd))).toHaveLength(0);
    expect(await journal('sales_daily', sd)).toBeNull();
    // a ПР whose turnover row was deleted earlier (before that was refused) is still deleted
    const q = await tx((t) => saveStoreOut(t, A, { kind: 'sale', date: '2026-02-16', wh: s1, account: '1009', lines: [{ itemId: I['001']!, qty: 1 }] }));
    const [qo] = await db.select().from(schema.storeOuts).where(eq(schema.storeOuts.id, q.id));
    await db.delete(schema.salesDaily).where(eq(schema.salesDaily.id, qo!.salesDayId!));
    await tx((t) => deleteStoreOut(t, A, q.id));
    expect(await db.select().from(schema.storeOuts).where(eq(schema.storeOuts.id, q.id))).toHaveLength(0);
  });
});

describe('a Z report with its goods issue and a later попис', () => {
  it('the count finds no shortage, so 6630 is cleared once', async () => {
    const q0 = stockAt((await loadStockContext(db, firmId)).ctx, { item: I['001']!, wh: s1, date: '2026-02-17' }).qty;
    const b0 = await balanceAt('6630', s1);
    await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-02-17', wh: s1, number: '17', gross: { 18: 125 }, fisk: { sc: 'trg' }, issue: true, lines: [{ itemId: I['001']!, qty: 1, price: 125 }] }));
    expect(r2(b0 - (await balanceAt('6630', s1)))).toBe(125);
    expect((await err(tx((t) => saveStockCount(t, A, { kind: 'count', date: '2026-02-17', wh: s1, lines: [{ itemId: I['001']!, cnt: q0 - 1 }] })))).message).toMatch(/Нема разлики/);
  });
});

describe('a store purchase (ПЛТ) keeps its МПЦ', () => {
  it('a line without МПЦ stores the store price of the date; no price at all is refused', async () => {
    const r = await tx((t) => savePurchase(t, firmId, {
      number: 'F-1', date: '2026-02-12', partnerId: sup, ptype: 'stock', warehouseId: s1,
      groups: [{ account: '6630', rate: 18, base: 300, vat: 54 }], stock: [{ itemId: I['001']!, qty: 5, price: 60 }], costs: {},
    }, { userId: null, role: 'acc' }));
    const [ln] = await db.select().from(schema.purchaseStockLines).where(eq(schema.purchaseStockLines.purchaseId, r.id));
    expect(Number(ln!.sp)).toBe(125);
    const e = await err(tx((t) => savePurchase(t, firmId, {
      number: 'F-2', date: '2026-02-12', partnerId: sup, ptype: 'stock', warehouseId: s1,
      groups: [{ account: '6630', rate: 18, base: 100, vat: 18 }], stock: [{ itemId: I['002']!, qty: 1, price: 100 }], costs: {},
    }, { userId: null, role: 'acc' })));
    expect(e.message).toMatch(/Внесете МПЦ за „Без цена“/);
  });
});
