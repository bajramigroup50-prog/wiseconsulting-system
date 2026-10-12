/**
 * ЕТ образец за мало per store — production flow: a foreign-currency purchase (ПЛТ) into the main warehouse, then
 * transfers (преносници) from the main warehouse to two stores. Each store's ЕТ shows only the transfer into that
 * store with its own values; the purchase belongs to the warehouse (МЕТГ / wholesale books), never to the stores.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { etBook, metgCard, tradeBook } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadStockContext, removeSourceMoves, replaceSourceMoves } from './stock-service';
import { saveTransfer, type Actor } from './stock-docs';
import { stockDocResolver } from './stock-reports';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '';
let A: Actor;
let MAIN = '';
let T = '';
let S = '';
let G = '';
let itA = '';
let itB = '';
let purId = '';
const R = { from: '2026-01-01', to: '2026-12-31' };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Модна куќа ДООЕЛ' }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  const locs = await db.insert(schema.codes).values([
    { firmId, cb: 'warehouse', code: '01', name: 'Главен магацин' },
    { firmId, cb: 'store', code: '02', name: 'TETOVO' },
    { firmId, cb: 'store', code: '03', name: 'STRUGA' },
    { firmId, cb: 'store', code: '04', name: 'GOSTIVAR' },
  ]).returning();
  [MAIN, T, S, G] = locs.map((l) => l.id) as [string, string, string, string];
  const items = await db.insert(schema.items).values([
    { firmId, code: 'J1', name: 'Јакна', type: 'goods', unit: 'ком', price: '1000', vatRate: 18 },
    { firmId, code: 'P1', name: 'Панталони', type: 'goods', unit: 'ком', price: '500', vatRate: 18 },
  ]).returning();
  [itA, itB] = items.map((i) => i.id) as [string, string];
  // ПЛТ бр. 0001 · FULLAMODA TURKEY — import in EUR into the main warehouse
  const [p] = await db.insert(schema.purchases).values({
    firmId, number: 'TR-77', calcNo: '0001', date: '2026-03-02', supplierName: 'FULLAMODA TURKEY', ptype: 'stock', imp: true,
    currency: 'EUR', fx: '61.5', warehouseId: MAIN,
  }).returning();
  purId = p!.id;
  await db.insert(schema.purchaseStockLines).values([
    { purchaseId: purId, lineNo: 0, itemId: itA, qty: '100', price: '10', value: '615', sp: '1500' },
    { purchaseId: purId, lineNo: 1, itemId: itB, qty: '200', price: '5', value: '615', sp: '800' },
  ]);
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'purchase', sourceId: purId, date: '2026-03-02', userId: null,
    moves: [
      { id: '', date: '2026-03-02', item: itA, qty: 100, value: 61500, type: 'in', wh: MAIN, label: 'Влезна ф-ра TR-77', lines: [] },
      { id: '', date: '2026-03-02', item: itB, qty: 200, value: 61500, type: 'in', wh: MAIN, label: 'Влезна ф-ра TR-77', lines: [] },
    ],
  }));
  // split to the stores: TETOVO 40 A + 50 B, STRUGA 60 A
  await tx((t) => saveTransfer(t, A, { date: '2026-03-05', from: MAIN, to: T, lines: [{ itemId: itA, qty: 40, sp: 1500 }, { itemId: itB, qty: 50, sp: 800 }] }));
  await tx((t) => saveTransfer(t, A, { date: '2026-03-05', from: MAIN, to: S, lines: [{ itemId: itA, qty: 60, sp: 1500 }] }));
}, 60_000);

const et = async (wh: string) => {
  const L = await loadStockContext(db, firmId);
  return etBook(L.ctx, { wh, ...R, docOf: await stockDocResolver(db, L), locationName: L.locName });
};

describe('ЕТ образец (мало): purchase → main warehouse → transfers split to 2 stores', () => {
  it('each store shows only the transfer into it, at its own purchase / retail value', async () => {
    const t = await et(T);
    expect(t.rows.map((r) => [r.no, r.name, r.nab, r.sp, r.wh])).toEqual([['Преносница 0001/2026', 'од Главен магацин', 40 * 615 + 50 * 307.5, 40 * 1500 + 50 * 800, T]]);
    const s = await et(S);
    expect(s.rows.map((r) => [r.no, r.name, r.nab, r.sp, r.wh])).toEqual([['Преносница 0002/2026', 'од Главен магацин', 60 * 615, 60 * 1500, S]]);
    expect((await et(G)).rows).toEqual([]);
  });

  it('the purchase into the main warehouse does not appear in any store', async () => {
    for (const wh of ['', T, S, G]) expect((await et(wh)).rows.some((r) => r.no.includes('ПЛТ'))).toBe(false);
  });

  it('„сите продавници“: one row per store (with its store), totals = Σ of the stores', async () => {
    const all = await et('');
    expect(all.rows.map((r) => r.wh).sort()).toEqual([T, S].sort());
    const [t, s] = [await et(T), await et(S)];
    expect(all.totals.nab).toBe(Math.round((t.totals.nab + s.totals.nab) * 100) / 100);
    expect(all.totals.sp).toBe(Math.round((t.totals.sp + s.totals.sp) * 100) / 100);
  });

  it('a ПЛТ whose stock moves landed directly in 2 stores (imported data) books each store only its part', async () => {
    const [p] = await db.insert(schema.purchases).values({ firmId, number: 'TR-78', calcNo: '0002', date: '2026-04-01', supplierName: 'FULLAMODA TURKEY', ptype: 'stock', warehouseId: T }).returning();
    await db.insert(schema.purchaseStockLines).values([
      { purchaseId: p!.id, lineNo: 0, itemId: itA, qty: '10', price: '600', value: '6000', sp: '1500' },
      { purchaseId: p!.id, lineNo: 1, itemId: itB, qty: '10', price: '300', value: '3000', sp: '800' },
    ]);
    await tx((t) => replaceSourceMoves(t, {
      firmId, sourceType: 'purchase', sourceId: p!.id, date: '2026-04-01', userId: null,
      moves: [
        { id: '', date: '2026-04-01', item: itA, qty: 10, value: 6000, type: 'in', wh: T, label: 'Влезна ф-ра TR-78', lines: [] },
        { id: '', date: '2026-04-01', item: itB, qty: 10, value: 3000, type: 'in', wh: S, label: 'Влезна ф-ра TR-78', lines: [] },
      ],
    }));
    const row = async (wh: string) => (await et(wh)).rows.filter((r) => r.no.startsWith('Од ПЛТ бр. 0002')).map((r) => [r.nab, r.sp, r.wh]);
    // a non-VAT firm: input VAT (18 %) is part of the purchase value
    expect(await row(T)).toEqual([[7080, 15000, T]]);
    expect(await row(S)).toEqual([[3540, 8000, S]]);
    expect(await row(G)).toEqual([]);
    const all = await row('');
    expect(all.reduce((s, r) => s + (r[0] as number), 0)).toBe(10620);
    expect(all.reduce((s, r) => s + (r[1] as number), 0)).toBe(23000);
    await tx((t) => removeSourceMoves(t, { firmId, sourceType: 'purchase', sourceId: p!.id, userId: null }));
  });

  it('the main warehouse books the purchase in and the transfers out (МЕТГ), not the stores', async () => {
    const L = await loadStockContext(db, firmId);
    const docOf = await stockDocResolver(db, L);
    const c = metgCard(L.ctx, { item: itA, wh: MAIN, ...R, docOf });
    expect(c.rows.map((r) => [r.no, r.in, r.out])).toEqual([['Од ПЛТ бр. 0001 (ф-ра TR-77)', 100, 0], ['Преносница 0001/2026', 0, 40], ['Преносница 0002/2026', 0, 60]]);
    // wholesale ЕТ of the warehouse: the purchase in at cost (transfers are not wholesale turnover)
    const w = tradeBook(L.ctx, { retail: false, wh: MAIN, ...R });
    expect(w.totals.d).toBe(123000);
    // ЕТМ (retail value) per store: only that store's transfer
    expect(tradeBook(L.ctx, { retail: true, wh: T, ...R }).totals.d).toBe(40 * 1500 + 50 * 800);
    expect(tradeBook(L.ctx, { retail: true, wh: S, ...R }).totals.d).toBe(60 * 1500);
  });
});
