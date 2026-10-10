import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { approveInvoice, deleteInvoice, saveInvoice, type InvoiceInput } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const office: DocActor = { userId: null, role: 'acc' };
const klient: DocActor = { userId: null, role: 'klient' };
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '', cust = '', sup = '', wood = '', glue = '', table = '';

const moves = (sourceType: string, sourceId: string) =>
  db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, sourceType), eq(schema.stockMoves.sourceId, sourceId)));
const qtyOf = async (item: string) => (await db.select().from(schema.stockMoves).where(eq(schema.stockMoves.itemId, item))).reduce((a, m) => a + Number(m.qty), 0);

const sale = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({
  kind: 'invoice', date: '2026-03-10', partnerId: cust, lines: [{ itemId: table, name: 'Маса', qty: 2, price: 5000, rate: 18 }],
  data: { prod: 'Д' },
  production: { wh: null, extra: 100, saveBom: true, lines: [{ lineNo: 0, productId: table, qty: 2, materials: [{ itemId: wood, qty: 4 }, { itemId: glue, qty: 1 }] }] },
  ...o,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Столарија ДООЕЛ', edb: '4030000000002' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач', code: '1' }, { firmId, name: 'Пилана', code: '2' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const I = await db.insert(schema.items).values([
    { firmId, name: 'Штица', code: '100', type: 'material', vatRate: 18 }, { firmId, name: 'Лепак', code: '101', type: 'material', vatRate: 18 },
    { firmId, name: 'Маса', code: '200', type: 'product', vatRate: 18, price: '5000' },
  ]).returning();
  wood = I[0]!.id; glue = I[1]!.id; table = I[2]!.id;
  await tx((t) => savePurchase(t, firmId, { number: 'P-1', date: '2026-03-01', partnerId: sup, ptype: 'stock', groups: [{ account: '3100', rate: 18, base: 1100, vat: 198 }],
    stock: [{ itemId: wood, qty: 10, price: 100, type: 'material' }, { itemId: glue, qty: 2, price: 50, type: 'material' }] }, office));
}, 60_000);

describe('production from a sales invoice', () => {
  let id = '';
  it('issues the materials, receives the product at the materials cost + extra and sells it', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, sale(), office));
    id = r.id;
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    const run = (inv!.data as schema.InvoiceData).prodRun!;
    expect(run.orders).toHaveLength(1);
    expect(run.mat).toBe(450); // 4 × 100 + 1 × 50
    expect((inv!.data as schema.InvoiceData).prodCost).toBe('550.00');
    const [o] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, run.orders[0]!.id));
    expect(o).toMatchObject({ date: '2026-03-10', mat: '450.00', lab: '100.00', note: `Фактура ${r.number}` });
    const M = await moves('production', o!.id);
    expect(M.map((m) => [m.itemId, Number(m.qty), Number(m.value)]).sort()).toEqual([[glue, -1, -50], [table, 2, 550], [wood, -4, -400]].sort());
    expect(await qtyOf(table)).toBe(0); // produced 2, sold 2
    expect(await qtyOf(wood)).toBe(6);
    const [bom] = await db.select().from(schema.boms).where(eq(schema.boms.productId, table));
    expect(bom!.lines).toEqual([{ itemId: wood, qty: 2 }, { itemId: glue, qty: 0.5 }]);
  });
  it('editing replaces the production; deleting removes it', async () => {
    const before = (await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.firmId, firmId))).length;
    await tx((t) => saveInvoice(t, firmId, sale({ id, lines: [{ itemId: table, name: 'Маса', qty: 1, price: 5000, rate: 18 }],
      production: { wh: null, extra: 0, lines: [{ lineNo: 0, productId: table, qty: 1, materials: [{ itemId: wood, qty: 2 }] }] } }), office));
    expect((await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.firmId, firmId))).length).toBe(before);
    expect(await qtyOf(wood)).toBe(8);
    await tx((t) => deleteInvoice(t, firmId, id, office));
    expect((await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.firmId, firmId))).length).toBe(before - 1);
    expect(await qtyOf(wood)).toBe(10);
    expect(await qtyOf(table)).toBe(0);
  });
  it('a client entry keeps the plan; approval runs the production', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, sale(), klient));
    expect(r.status).toBe('pending');
    let [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    expect((inv!.data as schema.InvoiceData).prodRun!.orders).toEqual([]);
    expect(await qtyOf(wood)).toBe(10);
    await tx((t) => approveInvoice(t, firmId, r.id, office));
    [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    expect((inv!.data as schema.InvoiceData).prodRun!.orders).toHaveLength(1);
    expect(await qtyOf(wood)).toBe(6);
  });
});
