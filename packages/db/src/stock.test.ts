/**
 * Phase 7 DB flows on PGlite: save → post → unpost for transfers, levelling, stock counts, daily sales, production
 * and re-averaging, with period locks and audit rows.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { etBook, lagerRows, stockAt, tradeBook } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { PostingError } from './posting';
import {
  StockDocError, loadStockContext, removeSourceMoves, replaceSourceMoves, type LoadedStock,
} from './stock-service';
import {
  deleteLevelling, deleteProductionOrder, deleteSalesDay, deleteStockCount, deleteTransfer, posSell, runProductionOrder, runStockReaverage,
  saveBom, saveLevelling, saveSalesDay, saveStockCount, saveTransfer, type Actor,
} from './stock-docs';
import { loadStockSales, stockDocResolver } from './stock-reports';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let A: Actor;
let firmId = '';
const I: Record<string, string> = {};
let s1 = '';
let w2 = '';
let sup = '';

const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const ctx = () => loadStockContext(db, firmId);
const qtyAt = (L: LoadedStock, item: string, wh: string, date = '2026-12-31') => stockAt(L.ctx, { item, wh, date }).qty;
async function journal(sourceType: string, sourceId: string) {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)).orderBy(schema.journalLines.lineNo);
  return { ...j, lines: lines.map((l) => [l.account, Number(l.debit), Number(l.credit)] as const) };
}
const sum = (L: readonly (readonly [string, number, number])[], side: 1 | 2) => Math.round(L.reduce((s, l) => s + l[side], 0) * 100) / 100;
async function setScheme(sch: Record<string, unknown>) {
  const [f] = await db.select().from(schema.firms).where(eq(schema.firms.id, firmId));
  await db.update(schema.firms).set({ settings: { ...(f!.settings as object), sch } }).where(eq(schema.firms.id, firmId));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Маркет ДООЕЛ' }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  const [p] = await db.insert(schema.partners).values({ firmId, name: 'Добавувач', code: '1' }).returning();
  sup = p!.id;
  const rows = await db.insert(schema.items).values([
    { firmId, code: '001', name: 'Кафе', type: 'goods', unit: 'ком', price: '100', vatRate: 18 },
    { firmId, code: '002', name: 'Ориз', type: 'goods', unit: 'кг', price: '40', vatRate: 5 },
    { firmId, code: '100', name: 'Брашно', type: 'material', unit: 'кг', vatRate: 5 },
    { firmId, code: '200', name: 'Леб', type: 'product', unit: 'ком', price: '30', vatRate: 5 },
    { firmId, code: '300', name: 'Услуга', type: 'service', price: '500', vatRate: 18 },
  ]).returning();
  for (const r of rows) I[r.code!] = r.id;
  const locs = await db.insert(schema.codes).values([
    { firmId, cb: 'store', code: '02', name: 'Продавница 1' },
    { firmId, cb: 'warehouse', code: '03', name: 'Магацин 2' },
  ]).returning();
  s1 = locs[0]!.id;
  w2 = locs[1]!.id;
  // opening receipts (a purchase-like source with a posting: D 6600 / C 2200 supplier)
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'purchase', sourceId: 'P-1', date: '2026-01-05', userId: null, partnerId: sup, description: 'Влез 1',
    moves: [
      { id: '', date: '2026-01-05', item: I['001']!, qty: 10, value: 600, type: 'in', wh: 'main', label: 'Влез', lines: [{ account: '6600', debit: 600, credit: 0 }, { account: '2200', debit: 0, credit: 600 }] },
      { id: '', date: '2026-01-05', item: I['002']!, qty: 20, value: 600, type: 'in', wh: 'main', label: 'Влез', lines: [{ account: '6600', debit: 600, credit: 0 }, { account: '2200', debit: 0, credit: 600 }] },
      { id: '', date: '2026-01-05', item: I['100']!, qty: 50, value: 1250, type: 'in', wh: 'main', label: 'Влез', lines: [{ account: '3100', debit: 1250, credit: 0 }, { account: '2200', debit: 0, credit: 1250 }] },
    ],
  }));
}, 60_000);

describe('stock moves service', () => {
  it('writes moves and one aggregated stock journal per source', async () => {
    const j = await journal('stock:purchase', 'P-1');
    expect(j!.kind).toBe('zaliha');
    expect(j!.lines).toEqual([['6600', 1200, 0], ['2200', 0, 2450], ['3100', 1250, 0]]);
    const L = await ctx();
    expect(qtyAt(L, I['001']!, 'main')).toBe(10);
    expect(L.ctx.moves[0]!.src).toBe('pur-P-1');
  });

  it('replacing and removing a source re-posts / un-posts its journal', async () => {
    await tx((t) => replaceSourceMoves(t, { firmId, sourceType: 'purchase', sourceId: 'P-x', date: '2026-01-06', userId: null, partnerId: sup,
      moves: [{ id: '', date: '2026-01-06', item: I['001']!, qty: 1, value: 50, type: 'in', lines: [{ account: '6600', debit: 50, credit: 0 }, { account: '2200', debit: 0, credit: 50 }] }] }));
    expect((await journal('stock:purchase', 'P-x'))!.lines).toEqual([['6600', 50, 0], ['2200', 0, 50]]);
    await tx((t) => removeSourceMoves(t, { firmId, sourceType: 'purchase', sourceId: 'P-x', userId: null }));
    expect(await journal('stock:purchase', 'P-x')).toBeNull();
    expect(qtyAt(await ctx(), I['001']!, 'main')).toBe(10);
  });
});

describe('transfers (prenosi)', () => {
  let id = '';
  it('refuses a transfer above stock and to the same location', async () => {
    expect((await err(tx((t) => saveTransfer(t, A, { date: '2026-02-01', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 11 }] })))).message).toMatch(/Нема доволно залиха/);
    expect((await err(tx((t) => saveTransfer(t, A, { date: '2026-02-01', from: 'main', to: 'main', lines: [{ itemId: I['001']!, qty: 1 }] })))).message).toMatch(/различни/);
  });

  it('cost-value store: moves at average cost, no journal, retail price set on the store', async () => {
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-02-01', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 4, sp: 120 }] }));
    id = r.id;
    expect(r.number).toBe('0001/2026');
    const L = await ctx();
    expect([qtyAt(L, I['001']!, 'main'), qtyAt(L, I['001']!, s1)]).toEqual([6, 4]);
    expect(L.ctx.moves.filter((m) => m.src === 'prn-' + id).map((m) => [m.type, m.qty, m.value])).toEqual([['transfer', -4, -240], ['transfer-in', 4, 240]]);
    expect(await journal('stock:transfer', id)).toBeNull();
    expect((L.items.get(I['001']!)!.data as { sp: Record<string, number> }).sp[s1]).toBe(120);
    const [row] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, id));
    expect(row!.lines).toEqual([{ itemId: I['001'], qty: 4, nabU: 60, sp: 120 }]);
  });

  it('retail-value store (retailMethod): D 6630 / C 6600 / C 6694 / C 6640, re-save keeps the number', async () => {
    await setScheme({ retailMethod: true });
    await tx((t) => saveTransfer(t, A, { id, date: '2026-02-01', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 4, sp: 118 }] }));
    const j = await journal('stock:transfer', id);
    expect(j!.lines).toEqual([['6630', 472, 0], ['6600', 0, 240], ['6694', 0, 160], ['6640', 0, 72]]);
    expect(sum(j!.lines, 1)).toBe(sum(j!.lines, 2));
    expect(j!.number).toBe('3/1-3');
    const [row] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, id));
    expect(row!.number).toBe('0001/2026');
    await setScheme({});
  });

  it('warehouse → warehouse with different stock accounts posts at cost (legacy posted nothing)', async () => {
    await db.update(schema.codes).set({ data: { konto: '6601' } }).where(eq(schema.codes.id, w2));
    const r = await tx((t) => saveTransfer(t, A, { date: '2026-02-02', from: 'main', to: w2, lines: [{ itemId: I['002']!, qty: 2 }] }));
    expect((await journal('stock:transfer', r.id))!.lines).toEqual([['6601', 60, 0], ['6600', 0, 60]]);
    await tx((t) => deleteTransfer(t, A, r.id));
    expect(await journal('stock:transfer', r.id)).toBeNull();
    expect(qtyAt(await ctx(), I['002']!, w2)).toBe(0);
    const au = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, r.id));
    expect(au.map((x) => x.action).sort()).toEqual(['prDel', 'prSave']);
  });
});

describe('levelling (nivel)', () => {
  it('posts the retail difference at a retail-value store, creates the promotion price-back, updates prices; delete reverts', async () => {
    await setScheme({ retailMethod: true });
    const r = await tx((t) => saveLevelling(t, A, { date: '2026-02-10', wh: s1, prices: { [I['001']!]: 130 }, promoTo: '2026-02-20', today: '2026-02-12' }));
    expect([r.number, r.backNumber]).toEqual(['001/2026', '002/2026']);
    const [doc] = await db.select().from(schema.levellingDocs).where(eq(schema.levellingDocs.id, r.id));
    expect(doc!.lines).toEqual([{ itemId: I['001'], qty: 4, old: 118, new: 130 }]);
    // D 6630 48 / C 6694 40.68 / C 6640 7.32
    expect((await journal('levelling', r.id))!.lines).toEqual([['6630', 48, 0], ['6694', 0, 40.68], ['6640', 0, 7.32]]);
    const back = (await db.select().from(schema.levellingDocs).where(eq(schema.levellingDocs.promoBackOf, '001/2026')))[0]!;
    expect([back.date, back.lines[0]!.new]).toEqual(['2026-02-21', 118]);
    expect((await journal('levelling', back.id))!.lines).toEqual([['6630', 0, 48], ['6694', 40.68, 0], ['6640', 7.32, 0]]);
    let L = await ctx();
    expect((L.items.get(I['001']!)!.data as { sp: Record<string, number> }).sp[s1]).toBe(130);
    // the ЕТМ book sees the levelling value
    const T = tradeBook(L.ctx, { retail: true, wh: s1, from: '2026-01-01', to: '2026-02-28', locationName: L.locName });
    expect(T.rows.find((x) => x.doc.startsWith('Нивелација 001'))!.d).toBe(48);
    await tx((t) => deleteLevelling(t, A, back.id, '2026-02-12'));
    await tx((t) => deleteLevelling(t, A, r.id, '2026-02-12'));
    expect(await journal('levelling', r.id)).toBeNull();
    L = await ctx();
    expect((L.items.get(I['001']!)!.data as { sp: Record<string, number> }).sp[s1]).toBe(118);
    await setScheme({});
  });

  it('a store kept at cost gets no levelling journal; nothing to level is refused', async () => {
    const r = await tx((t) => saveLevelling(t, A, { date: '2026-02-11', wh: s1, prices: { [I['001']!]: 125 }, today: '2026-02-11' }));
    expect(await journal('levelling', r.id)).toBeNull();
    expect((await err(tx((t) => saveLevelling(t, A, { date: '2026-02-11', wh: s1, prices: { [I['001']!]: 125 }, today: '2026-02-11' })))).message).toMatch(/нова цена/);
    await tx((t) => deleteLevelling(t, A, r.id, '2026-02-11'));
  });
});

describe('stock counts and write-offs (m_izlez)', () => {
  it('posts shortages and surpluses at average cost; editing re-counts against stock without its own moves', async () => {
    const r = await tx((t) => saveStockCount(t, A, { kind: 'count', date: '2026-03-01', wh: 'main', lines: [{ itemId: I['001']!, cnt: 5 }, { itemId: I['002']!, cnt: 21 }, { itemId: I['100']!, cnt: 50 }] }));
    expect(r).toMatchObject({ number: 'ПП-001/26', lines: 2 });
    const j = await journal('stock:stock_count', r.id);
    expect(j!.lines).toEqual([['4690', 60, 0], ['6600', 0, 60], ['6600', 30, 0], ['7690', 0, 30]]);
    let L = await ctx();
    expect([qtyAt(L, I['001']!, 'main'), qtyAt(L, I['002']!, 'main')]).toEqual([5, 21]);
    await tx((t) => saveStockCount(t, A, { id: r.id, kind: 'count', date: '2026-03-01', wh: 'main', lines: [{ itemId: I['001']!, cnt: 4 }] }));
    L = await ctx();
    expect([qtyAt(L, I['001']!, 'main'), qtyAt(L, I['002']!, 'main')]).toEqual([4, 20]);
    await tx((t) => deleteStockCount(t, A, r.id));
    L = await ctx();
    expect([qtyAt(L, I['001']!, 'main'), qtyAt(L, I['002']!, 'main')]).toEqual([6, 20]);
    expect(await journal('stock:stock_count', r.id)).toBeNull();
  });

  it('write-off: refused above stock, posted D shortage account / C stock', async () => {
    expect((await err(tx((t) => saveStockCount(t, A, { kind: 'writeoff', date: '2026-03-02', wh: 'main', lines: [{ itemId: I['001']!, qty: 7 }] })))).message).toMatch(/Нема доволно залиха/);
    const r = await tx((t) => saveStockCount(t, A, { kind: 'writeoff', date: '2026-03-02', wh: 'main', shortageAccount: '4691', lines: [{ itemId: I['001']!, qty: 1 }] }));
    expect(r.number).toBe('ОТ-001/26');
    expect((await journal('stock:stock_count', r.id))!.lines).toEqual([['4691', 60, 0], ['6600', 0, 60]]);
    await tx((t) => deleteStockCount(t, A, r.id));
  });
});

describe('daily sales (kasa / fiskPer)', () => {
  it('POS: sales of a day accumulate in one document; revenue, VAT, card with the POS partner; goods issued at cost', async () => {
    const a = await tx((t) => posSell(t, A, { date: '2026-03-05', wh: 'main', cart: [{ itemId: I['001']!, qty: 2, price: 118 }] }));
    const b = await tx((t) => posSell(t, A, { date: '2026-03-05', wh: 'main', cart: [{ itemId: I['002']!, qty: 1, price: 42 }, { itemId: I['300']!, qty: 1, price: 590 }], card: 100 }));
    expect(b.id).toBe(a.id);
    expect(b.total).toBe(868);
    const j = await journal('sales_daily', a.id);
    expect(j!.kind).toBe('kasa');
    expect(sum(j!.lines, 1)).toBe(868);
    expect(sum(j!.lines, 2)).toBe(868);
    expect(j!.lines.filter((l) => l[0] === '1200001')).toEqual([['1200001', 100, 0]]);
    expect(j!.lines.find((l) => l[0] === '741118')).toEqual(['741118', 0, 200]);
    const [card] = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.journalId, j!.id), eq(schema.journalLines.account, '1200001')));
    const [pos] = await db.select().from(schema.partners).where(eq(schema.partners.id, card!.partnerId!));
    expect(pos!.name).toBe('POS терминал');
    // services are not issued; goods at average cost D 7010 / C 6600
    const sj = await journal('stock:sales_daily', a.id);
    expect(sj!.lines).toEqual([['7010', 150, 0], ['6600', 0, 150]]);
    const L = await ctx();
    // ЕТ (wholesale, main) shows the issue; ЕТМ skips POS issues
    expect(lagerRows(L.ctx, { date: '2026-03-05', wh: 'main' }).find((r) => r.item.id === I['001'])!.s.qty).toBe(4);
    await tx((t) => deleteSalesDay(t, A, a.id));
    expect(await journal('sales_daily', a.id)).toBeNull();
    expect(await journal('stock:sales_daily', a.id)).toBeNull();
  });

  it('fiscal report, scheme trg with goods issued; usl issues nothing; trgNoVat books 6694 / 6630', async () => {
    const r = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-03-06', wh: s1, number: '15', gross: { 18: 236 }, card: 36, fisk: { sc: 'trg' }, issue: true, lines: [{ itemId: I['001']!, qty: 2, price: 118 }] }));
    const j = await journal('sales_daily', r.id);
    expect(sum(j!.lines, 1)).toBe(236);
    expect(sum(j!.lines, 2)).toBe(236);
    expect((await journal('stock:sales_daily', r.id))!.lines).toEqual([['7010', 120, 0], ['6600', 0, 120]]);
    const L = await ctx();
    const sales = await loadStockSales(db, firmId);
    const et = etBook(L.ctx, { wh: s1, from: '2026-01-01', to: '2026-12-31', sales, docOf: await stockDocResolver(db, L), locationName: L.locName });
    expect(et.rows.find((x) => x.no.startsWith('Дн. фин. изв. Z бр. 15'))!.pr).toBe(236);
    expect(et.rows.some((x) => x.no === 'Преносница 0001/2026' && x.nab === 240 && x.sp === 472)).toBe(true);
    await tx((t) => deleteSalesDay(t, A, r.id));
    const u = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-03-06', wh: s1, number: '16', gross: { 18: 118 }, fisk: { sc: 'usl' }, issue: true, lines: [{ itemId: I['001']!, qty: 1, price: 118 }] }));
    expect(await journal('stock:sales_daily', u.id)).toBeNull();
    expect((await journal('sales_daily', u.id))!.lines).toEqual([['1009', 118, 0], ['230018', 0, 18], ['7414', 0, 100]]);
    await tx((t) => deleteSalesDay(t, A, u.id));
    const n = await tx((t) => saveSalesDay(t, A, { kind: 'fisk', date: '2026-03-07', wh: s1, number: '17', gross: { 18: 500 }, fisk: { sc: 'trgNoVat' } }));
    const nj = await journal('sales_daily', n.id);
    expect(nj!.lines.filter((l) => ['6694', '6630', '6690'].includes(l[0]))).toEqual([['6694', 500, 0], ['6630', 0, 500]]);
    await tx((t) => deleteSalesDay(t, A, n.id));
  });
});

describe('production (normativ / prod)', () => {
  it('refuses a cyclic BOM; runs a work order (material, labour, product at cost); storno removes it', async () => {
    await tx((t) => saveBom(t, A, { productId: I['200']!, labor: 2.5, lines: [{ itemId: I['100']!, qty: 0.5 }] }));
    expect((await err(tx((t) => saveBom(t, A, { productId: I['200']!, labor: 0, lines: [{ itemId: I['200']!, qty: 1 }] })))).message).toMatch(/кружен/);
    expect((await err(tx((t) => runProductionOrder(t, A, { date: '2026-03-10', productId: I['200']!, qty: 1000 })))).message).toMatch(/Недостига/);
    const r = await tx((t) => runProductionOrder(t, A, { date: '2026-03-10', productId: I['200']!, qty: 10 }));
    expect(r.unitCost).toBe(15);
    const j = await journal('stock:production', r.id);
    expect(j!.lines).toEqual([['6000', 150, 0], ['3100', 0, 125], ['4900', 0, 25], ['6300', 150, 0], ['6000', 0, 150]]); // D 6000 = material 125 + labour 25
    expect(qtyAt(await ctx(), I['200']!, 'main')).toBe(10);
    await tx((t) => deleteProductionOrder(t, A, r.id));
    expect(qtyAt(await ctx(), I['200']!, 'main')).toBe(0);
    expect(await journal('stock:production', r.id)).toBeNull();
  });
});

describe('re-averaging and period lock', () => {
  it('re-values issues after a back-dated receipt and re-posts their journal', async () => {
    const w = await tx((t) => saveStockCount(t, A, { kind: 'writeoff', date: '2026-04-02', wh: 'main', lines: [{ itemId: I['002']!, qty: 2 }] }));
    expect((await journal('stock:stock_count', w.id))!.lines).toEqual([['4690', 60, 0], ['6600', 0, 60]]);
    // a receipt dated before the write-off at a higher price: average (20 @ 30 + 2 @ 50) = 31.8182 → 2 × = 63.64
    await tx((t) => replaceSourceMoves(t, { firmId, sourceType: 'purchase', sourceId: 'P-2', date: '2026-04-01', userId: null, partnerId: sup,
      moves: [{ id: '', date: '2026-04-01', item: I['002']!, qty: 2, value: 100, type: 'in', lines: [{ account: '6600', debit: 100, credit: 0 }, { account: '2200', debit: 0, credit: 100 }] }] }));
    const r = await tx((t) => runStockReaverage(t, A));
    expect(r.changed).toBeGreaterThanOrEqual(1);
    expect((await journal('stock:stock_count', w.id))!.lines).toEqual([['4690', 63.64, 0], ['6600', 0, 63.64]]);
  });

  it('locked period: documents cannot be saved, changed or deleted', async () => {
    const [t1] = await db.select().from(schema.transfers).where(like(schema.transfers.number, '0001/%'));
    await db.update(schema.firms).set({ lockDate: '2026-02-28' }).where(eq(schema.firms.id, firmId));
    const e1 = await err(tx((t) => saveTransfer(t, A, { date: '2026-02-15', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 1 }] })));
    expect(e1).toBeInstanceOf(PostingError);
    expect((e1 as PostingError).code).toBe('locked');
    expect(await err(tx((t) => deleteTransfer(t, A, t1!.id)))).toBeInstanceOf(PostingError);
    expect(await err(tx((t) => saveStockCount(t, A, { kind: 'writeoff', date: '2026-01-31', wh: 'main', lines: [{ itemId: I['001']!, qty: 1 }] })))).toBeInstanceOf(PostingError);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('unknown items and services are refused', async () => {
    expect(await err(tx((t) => saveTransfer(t, A, { date: '2026-03-01', from: 'main', to: s1, lines: [{ itemId: I['300']!, qty: 1 }] })))).toBeInstanceOf(StockDocError);
  });
});
