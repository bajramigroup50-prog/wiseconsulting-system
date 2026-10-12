/**
 * Transfer ↔ source calculation on PGlite: deleting a calculation deletes the transfers made from it (cascade, audit
 * `delTransfer` / `cascade`), refuses when the store already sold the goods, standalone transfer delete with the same
 * guard, the orphan check and the note heuristic for older transfers.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { stockAt } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { loadStockContext } from './stock-service';
import { deleteSalesDay, deleteTransfer, posSell, saveTransfer, type Actor } from './stock-docs';
import { deletePurchase, savePurchase } from './sales/purchases';
import { mergePurchases } from './parity-retail';
import { dependentLabel, dependentTransfers, noteCalcNos, transferSources } from './transfer-links';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let A: Actor;
let firmId = '';
let store = '';
let sup = '';
const I: Record<string, string> = {};
const act = { userId: null, role: 'admin' };
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const qty = async (item: string, wh: string) => stockAt((await loadStockContext(db, firmId)).ctx, { item, wh, date: '2026-12-31' }).qty;
const calc = (n: string, q: number, d = '2026-03-01') => tx((t) => savePurchase(t, firmId, {
  number: n, date: d, partnerId: sup, ptype: 'stock', groups: [{ account: '6600', rate: 18, base: q * 2 * 30, vat: q * 2 * 5.4 }],
  stock: [{ itemId: I['001']!, qty: q, price: 30 }, { itemId: I['002']!, qty: q, price: 30 }],
}, act));
const calcNo = async (id: string) => (await db.select().from(schema.purchases).where(eq(schema.purchases.id, id)))[0]!.calcNo!;
const transfer = (src: string[] | undefined, note: string, q = 4, d = '2026-03-02') => tx((t) => saveTransfer(t, A, {
  date: d, from: 'main', to: store, note, sourcePurchaseIds: src,
  lines: [{ itemId: I['001']!, qty: q, sp: 100 }, { itemId: I['002']!, qty: q, sp: 100 }],
}));
const exists = async (id: string) => (await db.select().from(schema.transfers).where(eq(schema.transfers.id, id))).length === 1;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Модна ДООЕЛ', vatRegistered: true }).returning();
  firmId = f!.id;
  A = { firmId, userId: null };
  sup = (await db.insert(schema.partners).values({ firmId, name: 'FULLAMODA TURKEY', code: 'F1' }).returning())[0]!.id;
  store = (await db.insert(schema.codes).values({ firmId, cb: 'store', code: '02', name: 'GOSTIVAR' }).returning())[0]!.id;
  const rows = await db.insert(schema.items).values([
    { firmId, code: '001', name: 'Фустан', type: 'goods', unit: 'ком', price: '85', vatRate: 18 },
    { firmId, code: '002', name: 'Кошула', type: 'goods', unit: 'ком', price: '85', vatRate: 18 },
  ]).returning();
  for (const r of rows) I[r.code!] = r.id;
}, 120_000);

describe('note heuristic', () => {
  it('parses the calculation numbers of „Од калкулација …“', () => {
    expect(noteCalcNos('Од калкулација 0001 01, 0002 01')).toEqual(['0001 01', '0002 01']);
    expect(noteCalcNos('нешто друго')).toEqual([]);
  });
});

describe('purchase delete cascades to the transfers made from it', () => {
  it('lists, refuses without confirmation, deletes both with audit on confirm', async () => {
    const p = await calc('F-1', 10);
    const t = await transfer([p.id], 'Од калкулација ' + await calcNo(p.id));
    expect([await qty(I['001']!, 'main'), await qty(I['001']!, store)]).toEqual([6, 4]);
    const dep = await dependentTransfers(db, firmId, [p.id]);
    expect(dep.map(dependentLabel)).toEqual([`Преносница ${t.number} Главен магацин → GOSTIVAR (2 ставки)`]);
    expect((await err(tx((x) => deletePurchase(x, firmId, p.id, act)))).message).toMatch(/Потврдете го бришењето/);
    expect(await exists(t.id)).toBe(true);
    const r = await tx((x) => deletePurchase(x, firmId, p.id, act, { cascade: true }));
    expect(r.transfers).toEqual([t.number]);
    expect(await exists(t.id)).toBe(false);
    expect((await db.select().from(schema.purchases).where(eq(schema.purchases.id, p.id))).length).toBe(0);
    expect([await qty(I['001']!, 'main'), await qty(I['001']!, store)]).toEqual([0, 0]);
    expect((await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, 'transfer'), eq(schema.stockMoves.sourceId, t.id)))).length).toBe(0);
    const au = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, t.id));
    const del = au.find((x) => x.action === 'delTransfer');
    expect(del?.data).toMatchObject({ reason: 'cascade', purchaseId: p.id, number: t.number });
    expect((await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, p.id), eq(schema.auditLog.action, 'delPur')))).length).toBe(1);
  });

  it('older transfer linked only by the note is found by calc number + year + warehouse', async () => {
    const p = await calc('F-2', 5);
    const t = await transfer(undefined, 'Од калкулација ' + await calcNo(p.id), 2);
    const [row] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, t.id));
    expect(row!.sourcePurchaseIds).toBeNull();
    expect((await transferSources(db, firmId, [row!])).get(t.id)).toEqual({ ids: [p.id], missing: [], inferred: true });
    await tx((x) => deletePurchase(x, firmId, p.id, act, { cascade: true }));
    expect(await exists(t.id)).toBe(false);
  });

  it('refuses when the store already sold some of the goods; nothing is deleted', async () => {
    const p = await calc('F-3', 10);
    const t = await transfer([p.id], 'Од калкулација ' + await calcNo(p.id), 4);
    const sale = await tx((x) => posSell(x, A, { date: '2026-03-05', wh: store, cart: [{ itemId: I['001']!, qty: 3, price: 100, rate: 18 }] }));
    const e = await err(tx((x) => deletePurchase(x, firmId, p.id, act, { cascade: true })));
    expect(e.message).toMatch(/веќе продадена\/издадена во GOSTIVAR/);
    expect(e.message).toMatch(/Фустан \(недостасуваат 3\)/);
    expect(e.message).toMatch(/сторнирајте/);
    expect(await exists(t.id)).toBe(true);
    expect((await db.select().from(schema.purchases).where(eq(schema.purchases.id, p.id))).length).toBe(1);
    // standalone transfer delete: same guard
    expect((await err(tx((x) => deleteTransfer(x, A, t.id)))).message).toMatch(/веќе продадена/);
    // storno the sale first → the transfer can be deleted on its own
    await tx((x) => deleteSalesDay(x, A, sale.id));
    await tx((x) => deleteTransfer(x, A, t.id));
    expect(await exists(t.id)).toBe(false);
    const au = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, t.id));
    expect(au.map((x) => x.action).sort()).toEqual(['prDel', 'prSave']);
    // without dependents the purchase deletes without confirmation
    await tx((x) => deletePurchase(x, firmId, p.id, act));
  });

  it('refuses a transfer in a locked period', async () => {
    const p = await calc('F-4', 3, '2026-01-10');
    const t = await transfer([p.id], '', 1, '2026-01-11');
    await db.update(schema.firms).set({ lockDate: '2026-01-31' }).where(eq(schema.firms.id, firmId));
    expect((await err(tx((x) => deleteTransfer(x, A, t.id)))).message).toMatch(/заклучен период/);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
    await tx((x) => deletePurchase(x, firmId, p.id, act, { cascade: true }));
    expect(await exists(t.id)).toBe(false);
  });
});

describe('orphan transfers and merge', () => {
  it('flags a transfer whose source calculation no longer exists (explicit link and note link)', async () => {
    const p = await calc('F-5', 4);
    const no = await calcNo(p.id);
    const t1 = await transfer([p.id], 'Од калкулација ' + no, 1);
    const t2 = await transfer(undefined, 'Од калкулација ' + no, 1);
    // legacy / pre-fix delete: the purchase is gone, the transfers stayed
    await db.delete(schema.purchases).where(eq(schema.purchases.id, p.id));
    const rows = await db.select().from(schema.transfers).where(eq(schema.transfers.firmId, firmId));
    const S = await transferSources(db, firmId, rows);
    expect(S.get(t1.id)).toEqual({ ids: [], missing: [p.id], inferred: false });
    expect(S.get(t2.id)).toEqual({ ids: [], missing: [no], inferred: true });
    await tx((x) => deleteTransfer(x, A, t1.id, { reason: 'orphan' }));
    await tx((x) => deleteTransfer(x, A, t2.id, { reason: 'orphan' }));
    const au = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, t1.id), eq(schema.auditLog.action, 'prDel')));
    expect(au[0]!.data).toMatchObject({ reason: 'orphan' });
  });

  it('merging calculations re-links their transfer to the merged one', async () => {
    const a = await calc('F-6', 2), b = await calc('F-7', 2);
    const t = await transfer([a.id, b.id], 'Од калкулација ' + await calcNo(a.id) + ', ' + await calcNo(b.id), 1);
    const m = await tx((x) => mergePurchases(x, firmId, [a.id, b.id], act));
    const [row] = await db.select().from(schema.transfers).where(eq(schema.transfers.id, t.id));
    expect(row!.sourcePurchaseIds).toEqual([m.id]);
    expect((await dependentTransfers(db, firmId, [m.id])).map((d) => d.id)).toEqual([t.id]);
  });
});
