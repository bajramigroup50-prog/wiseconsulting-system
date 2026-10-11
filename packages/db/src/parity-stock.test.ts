/** Parity services on PGlite: bulk stock delete (lgDel), custom / no-BOM work orders, codebook and chart imports. */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { stockAt } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadStockContext, replaceSourceMoves } from './stock-service';
import { saveBom, saveTransfer, type Actor } from './stock-docs';
import { deleteItemsStock, importAccounts, importCodebook, runCustomProductionOrder } from './parity-stock';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let A: Actor;
let firmId = '';
const I: Record<string, string> = {};
let s1 = '';
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const qty = async (item: string, wh = 'main') => stockAt((await loadStockContext(db, firmId)).ctx, { item, wh, date: '2026-12-31' }).qty;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Пекара ДООЕЛ' }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  const rows = await db.insert(schema.items).values([
    { firmId, code: '001', name: 'Кафе', type: 'goods', unit: 'ком', price: '100', vatRate: 18 },
    { firmId, code: '100', name: 'Брашно', type: 'material', unit: 'кг', vatRate: 5 },
    { firmId, code: '101', name: 'Квасец', type: 'material', unit: 'кг', vatRate: 5 },
    { firmId, code: '200', name: 'Леб', type: 'product', unit: 'ком', price: '50', vatRate: 5 },
  ]).returning();
  for (const r of rows) I[r.code!] = r.id;
  const [loc] = await db.insert(schema.codes).values({ firmId, cb: 'store', code: '02', name: 'Продавница' }).returning();
  s1 = loc!.id;
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'opening', sourceId: 'O-1', date: '2026-01-02', userId: null, description: 'Почетна',
    moves: [
      { id: '', date: '2026-01-02', item: I['001']!, qty: 10, value: 600, type: 'in', wh: 'main', label: 'Почетна', lines: [] },
      { id: '', date: '2026-01-02', item: I['100']!, qty: 100, value: 3000, type: 'in', wh: 'main', label: 'Почетна', lines: [] },
      { id: '', date: '2026-01-02', item: I['101']!, qty: 2, value: 400, type: 'in', wh: 'main', label: 'Почетна', lines: [] },
    ],
  }));
  await tx((t) => replaceSourceMoves(t, {
    firmId, sourceType: 'purchase', sourceId: 'P-1', date: '2026-01-03', userId: null, description: 'Влез',
    moves: [{ id: '', date: '2026-01-03', item: I['001']!, qty: 5, value: 300, type: 'in', wh: 'main', label: 'Влез', lines: [] }],
  }));
}, 60_000);

describe('runCustomProductionOrder', () => {
  it('custom materials: exact totals, labour from the product, optional save as normativ', async () => {
    await tx((t) => saveBom(t, A, { productId: I['200']!, labor: 2, lines: [{ itemId: I['100']!, qty: 0.5 }] }));
    const r = await tx((t) => runCustomProductionOrder(t, A, { date: '2026-02-01', productId: I['200']!, qty: 3, mode: 'custom', lines: [{ itemId: I['100']!, qty: 1 }, { itemId: I['101']!, qty: 0.1 }], saveAsBom: true }));
    // material 1 × 30 + 0.1 × 200 = 50; labour 2 × 3 = 6 → 56 / 3
    expect(r.unitCost).toBe(18.67);
    expect(await qty(I['200']!)).toBe(3);
    expect(await qty(I['100']!)).toBe(99);
    const [b] = await db.select().from(schema.boms).where(eq(schema.boms.productId, I['200']!));
    expect(b!.lines).toEqual([{ itemId: I['100']!, qty: 0.3333 }, { itemId: I['101']!, qty: 0.0333 }]);
  });
  it('no normativ: materials as % of the sale price', async () => {
    const r = await tx((t) => runCustomProductionOrder(t, A, { date: '2026-02-02', productId: I['200']!, qty: 10, mode: 'pct', pct: 60 }));
    const [o] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, r.id));
    // plan 10 × 50 × 60 % = 300, spread by stock value; issues are valued by postOut (whole denars) → 210 + 27 + 64
    expect(Number(o!.mat)).toBe(301);
    expect(Number(o!.lab)).toBe(0);
    expect(o!.note).toBe('без норматив 60%');
  });
});

describe('deleteItemsStock (lgDel)', () => {
  it('deletes opening / transfer moves, keeps document-owned moves', async () => {
    await tx((t) => saveTransfer(t, A, { date: '2026-03-01', from: 'main', to: s1, lines: [{ itemId: I['001']!, qty: 4, sp: 120 }] }));
    expect(await qty(I['001']!, s1)).toBe(4);
    const r = await tx((t) => deleteItemsStock(t, A, { itemIds: [I['001']!], wh: s1 }));
    expect(r.deleted).toBe(2); // both legs of the transfer
    expect(r.docsRemoved).toBe(1);
    expect(await qty(I['001']!, s1)).toBe(0);
    const all = await tx((t) => deleteItemsStock(t, A, { itemIds: [I['001']!] }));
    expect(all.kept).toEqual({ purchase: 1, production: 1 }); // the purchase receipt and the no-BOM work order stay
    expect(await qty(I['001']!)).toBeCloseTo(5 - 1.0588, 4);
    const [au] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'lgDel')));
    expect(au).toBeTruthy();
  });
});

describe('imports', () => {
  it('codebook rows: add then update by code', async () => {
    const a = await tx((t) => importCodebook(t, { userId: null as unknown as string, firmId, k: 'warehouse', rows: [{ code: '05', name: 'Магацин 5', konto: '6601' }, { code: '', name: '' }] }));
    expect(a).toMatchObject({ add: 1, upd: 0 });
    expect(a.skip.length).toBe(1);
    const b = await tx((t) => importCodebook(t, { userId: null as unknown as string, firmId, k: 'warehouse', rows: [{ code: '05', name: 'Магацин пет' }] }));
    expect(b).toMatchObject({ add: 0, upd: 1 });
  });
  it('chart of accounts rows', async () => {
    const r = await tx((t) => importAccounts(t, { userId: null as unknown as string, firmId, rows: [{ code: '66011', name: 'Залиха М2' }, { code: '12', name: 'x' }] }));
    expect(r.add).toBe(1);
    expect(r.skip.length).toBe(1);
  });
});
