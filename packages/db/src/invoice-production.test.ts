import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { approveInvoice, deleteInvoice, saveInvoice, type InvoiceInput } from './sales/invoices';
import { invoiceProdSheet } from './sales/invoice-production';
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
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'stock:production'), eq(schema.journals.sourceId, o!.id)));
    const JL = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
    expect(JL.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2);
    expect(JL.reduce((a, l) => a + Number(l.debit), 0)).toBeGreaterThan(0);
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

describe('production invoice („🏭 Фактура од производство“)', () => {
  let prof = '', screw = '', pergola = '', id = '';
  const journalOf = async (sourceType: string, sourceId: string) => {
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
    return j ? db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)) : [];
  };
  const wo = { number: '050/2026', from: '2026-04-01', to: '2026-04-30' };
  const spec = { text: 'Алуминиум, антрацит', mode: 'm2' as const, l: 4, w: 3 };
  const pinv = (o: Partial<InvoiceInput> & { hours?: number } = {}): InvoiceInput => ({
    kind: 'invoice', date: '2026-04-15', partnerId: cust, lines: [{ itemId: pergola, name: 'ТЕРАСА ПЕРГОЛА – Алуминиум, антрацит, 4 × 3 m = 12 m²', unit: 'm²', qty: 12, price: 1000, rate: 18 }],
    data: { prod: 'Д', prodInv: '1', woNo: wo.number, woFrom: wo.from, woTo: wo.to },
    production: {
      mode: 'prodInv', workOrder: wo, lines: [{
        lineNo: 0, productId: pergola, qty: 12, main: true, spec, materials: [{ itemId: prof, qty: 12 }, { itemId: screw, qty: 50 }],
        calc: { hours: o.hours ?? 10, rate: 400, other: [{ label: 'Транспорт', amount: 1000 }, { label: 'Монтажа', amount: 500 }], ovhPct: 10 },
      }],
    },
    ...o,
  });

  beforeAll(async () => {
    const I = await db.insert(schema.items).values([
      { firmId, name: 'Алу профил', code: '300', type: 'material', vatRate: 18, unit: 'm' }, { firmId, name: 'Шраф', code: '301', type: 'material', vatRate: 18 },
    ]).returning();
    prof = I[0]!.id; screw = I[1]!.id;
    await tx((t) => savePurchase(t, firmId, { number: 'P-2', date: '2026-04-01', partnerId: sup, ptype: 'stock', groups: [{ account: '3100', rate: 18, base: 2200, vat: 396 }],
      stock: [{ itemId: prof, qty: 10, price: 200, type: 'material' }, { itemId: screw, qty: 100, price: 2, type: 'material' }] }, office));
    // the main product typed on the invoice is created on the spot as a finished product (createProductAction)
    const [p] = await db.insert(schema.items).values({ firmId, name: 'ТЕРАСА ПЕРГОЛА', code: '400', type: 'product', vatRate: 18, unit: 'm²' }).returning();
    pergola = p!.id;
  });

  it('new main product: materials short → warning, not a block; received at the calculated cost and sold; postings exact', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, pinv(), office));
    id = r.id;
    expect(r.status).toBe('posted');
    expect(r.warnings.some((w) => w.includes('Недостига репроматеријал „Алу профил“'))).toBe(true);
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    const run = (inv!.data as schema.InvoiceData).prodRun!;
    expect(run.mode).toBe('prodInv');
    expect(run.workOrder).toEqual(wo);
    expect(run.notes?.length).toBe(1);
    // materials 12 × 200 + 50 × 2 = 2500; labour 10 × 400 = 4000; other 1500; overhead 10% × 8000 = 800
    expect(run.lines[0]!.res).toEqual({ mat: 2500, lab: 4000, other: 1500, ovh: 800, cost: 8800, unit: 733.3333 });
    expect((inv!.data as schema.InvoiceData).prodCost).toBe('8800.00');
    const [o] = await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, run.orders[0]!.id));
    expect(o).toMatchObject({ number: '050/2026', mat: '2500.00', lab: '6300.00', note: `Фактура ${r.number} · Работен налог 050/2026 (01.04.2026 – 30.04.2026)` });
    const M = await moves('production', o!.id);
    expect(M.map((m) => [m.itemId, Number(m.qty), Number(m.value)]).sort()).toEqual([[prof, -12, -2400], [screw, -50, -100], [pergola, 12, 8800]].sort());
    expect(await qtyOf(prof)).toBe(-2); // issued into the minus: the shortage is a warning
    expect(await qtyOf(pergola)).toBe(0); // produced 12, sold 12
    const PJ = await journalOf('stock:production', o!.id);
    const D = (x: typeof PJ) => Math.round(x.reduce((a, l) => a + Number(l.debit), 0) * 100) / 100;
    expect(D(PJ)).toBe(Math.round(PJ.reduce((a, l) => a + Number(l.credit), 0) * 100) / 100);
    expect(PJ.some((l) => Number(l.debit) === 8800)).toBe(true); // product received at cost
    expect(PJ.some((l) => Number(l.credit) === 6300)).toBe(true); // labour + other + overhead
    expect(PJ.some((l) => Number(l.credit) === 2500)).toBe(true); // materials issued (one stock account)
    const SJ = await journalOf('stock:invoice', id);
    expect(SJ.some((l) => Number(l.debit) === 8800) && SJ.some((l) => Number(l.credit) === 8800)).toBe(true); // cost of sales
    const IJ = await journalOf('invoice', id);
    expect(IJ.some((l) => Number(l.debit) === 14_160)).toBe(true); // 12 × 1000 + 18% VAT
    expect(IJ.some((l) => Number(l.credit) === 12_000) && IJ.some((l) => Number(l.credit) === 2160)).toBe(true);
  });

  it('the calculation sheet (print) shows the header, materials as issued, cost elements and the margin', async () => {
    const S = (await invoiceProdSheet(db, firmId, id))!;
    expect(S).toMatchObject({ booked: true, prodInv: true, partner: 'Купувач', currency: 'MKD', workOrder: 'Работен налог 050/2026 (01.04.2026 – 30.04.2026)' });
    const p = S.products[0]!;
    expect(p).toMatchObject({ orderNo: '050/2026', main: true, spec: 'Алуминиум, антрацит, 4 × 3 m = 12 m²', mat: 2500, lab: 4000, otherTotal: 1500, ovhPct: 10, ovh: 800, cost: 8800, unitCost: 733.3333, sale: 12_000, margin: 3200, pct: 26.67, below: false });
    expect(p.materials.map((m) => [m.name, m.qty, m.value])).toEqual([['Алу профил', 12, 2400], ['Шраф', 50, 100]]);
    expect(p.other).toEqual([{ label: 'Транспорт', amount: 1000 }, { label: 'Монтажа', amount: 500 }]);
    expect(S.notes[0]).toContain('Алу профил');
  });

  it('editing re-calculates and replaces the order (same work order number)', async () => {
    const before = (await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.firmId, firmId))).length;
    await tx((t) => saveInvoice(t, firmId, pinv({ id, hours: 5 }), office));
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    const run = (inv!.data as schema.InvoiceData).prodRun!;
    // labour 2000, overhead 10% × 6000 = 600 → cost 2500 + 2000 + 1500 + 600 = 6600
    expect(run.lines[0]!.res).toMatchObject({ lab: 2000, ovh: 600, cost: 6600 });
    expect((inv!.data as schema.InvoiceData).prodCost).toBe('6600.00');
    expect((await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.firmId, firmId))).length).toBe(before);
    expect(run.orders[0]!.number).toBe('050/2026');
    expect(await qtyOf(prof)).toBe(-2);
    expect((await invoiceProdSheet(db, firmId, id))!.products[0]).toMatchObject({ cost: 6600, margin: 5400, pct: 45 });
  });

  it('another invoice of the same work order: „050/2026-2“; a labour-only main product is produced too; deleting reverses', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, pinv({
      lines: [{ itemId: pergola, name: 'ТЕРАСА ПЕРГОЛА', unit: 'm²', qty: 2, price: 1000, rate: 18 }],
      production: { mode: 'prodInv', workOrder: wo, lines: [{ lineNo: 0, productId: pergola, qty: 2, main: true, materials: [], calc: { labour: 900 } }] },
    }), office));
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    const run = (inv!.data as schema.InvoiceData).prodRun!;
    expect(run.orders.map((o) => o.number)).toEqual(['050/2026-2']);
    expect(run.lines[0]!.res).toMatchObject({ mat: 0, lab: 900, cost: 900 });
    expect(await qtyOf(pergola)).toBe(0);
    await tx((t) => deleteInvoice(t, firmId, r.id, office));
    expect(await db.select().from(schema.productionOrders).where(eq(schema.productionOrders.id, run.orders[0]!.id))).toEqual([]);
    expect(await qtyOf(pergola)).toBe(0);
  });

  it('a client entry keeps the plan (sheet at current average cost); approval runs it under the work order', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, pinv({ date: '2026-04-20' }), klient));
    let S = (await invoiceProdSheet(db, firmId, r.id))!;
    expect(S.booked).toBe(false);
    expect(S.products[0]!.materials.find((m) => m.name === 'Шраф')).toMatchObject({ qty: 50, price: 2, value: 100, short: false });
    expect(S.notes.some((n) => n.includes('Алу профил'))).toBe(true); // stock is already in the minus
    await tx((t) => approveInvoice(t, firmId, r.id, office));
    S = (await invoiceProdSheet(db, firmId, r.id))!;
    expect(S.booked).toBe(true);
    expect(S.products[0]!.orderNo).toBe('050/2026-2');
  });
});
