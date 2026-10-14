/**
 * Regression: a production firm could not close its year (found while recording the demo, „ДЕМО ПРОИЗВОДСТВО ДООЕЛ“).
 *  - a „🏭 фактура од производство“ receives the product and sells it on the same day: the year control read the
 *    stock moves in table order and reported „залихата во минус“ when the sale came before the production receipt;
 *  - production posted the materials D 6000 / C 3100 and only the labour to 4900: 4900 stayed a credit („погрешна
 *    страна“, outside every AOP) and the ЦРМ income statement (by nature + stock change) differed from the ledger by
 *    the materials value, so АОП 063 ≠ АОП 111.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { zkAopChecks, zkData } from '@wise/core/yearend/kontrola';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { saveInvoice } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';
import { runProductionOrder, runStockReaverage, saveBom } from './stock-docs';
import { closeYear, loadYear, yearFindings } from './yearend';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const office: DocActor = { userId: null, role: 'acc' };
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const TODAY = '2027-02-15';
let firmId = '', cust = '', sup = '', lim = '', prof = '', scr = '', polica = '', regal = '', invId = '';

const journalOf = async (sourceType: string, sourceId: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  return j ? db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id)) : [];
};
const side = (L: { account: string; debit: string | number; credit: string | number }[], k: string) =>
  Math.round(L.filter((l) => l.account === k).reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0) * 100) / 100;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Производство ДООЕЛ', legalForm: 'dooel', edb: '4030000000003', embs: '7000003', activity: '25.11' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Маркет', code: '1' }, { firmId, name: 'Метал', code: '2' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const I = await db.insert(schema.items).values([
    { firmId, code: '100', name: 'Лим', type: 'material', unit: 'm²', vatRate: 18 },
    { firmId, code: '101', name: 'Профил', type: 'material', unit: 'm', vatRate: 18 },
    { firmId, code: '102', name: 'Завртка', type: 'material', unit: 'ком', vatRate: 18 },
    { firmId, code: '200', name: 'Полица', type: 'product', unit: 'ком', vatRate: 18, price: '2600' },
    { firmId, code: '201', name: 'Регал по мерка', type: 'product', unit: 'm²', vatRate: 18 },
  ]).returning();
  [lim, prof, scr, polica, regal] = I.map((x) => x.id) as [string, string, string, string, string];
  const st = [{ itemId: lim, qty: 100, price: 650, type: 'material' }, { itemId: prof, qty: 300, price: 140, type: 'material' }, { itemId: scr, qty: 2000, price: 4, type: 'material' }];
  const base = st.reduce((a, x) => a + x.qty * x.price, 0);
  await tx((t) => savePurchase(t, firmId, { number: 'М-1', date: '2026-12-01', partnerId: sup, ptype: 'stock', groups: [{ account: '3100', rate: 18, base, vat: Math.round(base * 18) / 100 }], stock: st, costs: {} } as never, office));
  // a work order for stock (30 pcs), 20 sold — 10 stay in 6300 at the year end
  await tx((t) => saveBom(t as never, { firmId, userId: null }, { productId: polica, labor: 180, lines: [{ itemId: lim, qty: 1.2 }, { itemId: prof, qty: 4 }, { itemId: scr, qty: 16 }] }));
  await tx((t) => runProductionOrder(t as never, { firmId, userId: null }, { date: '2026-12-03', productId: polica, qty: 30 }));
  await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-12-10', partnerId: cust, due: '2027-01-10', lines: [{ itemId: polica, name: 'Полица', unit: 'ком', qty: 20, price: 2600, rate: 18 }] } as never, office));
  // the production invoice: produced and sold on the same day
  const wo = { number: '014/2026', from: '2026-12-01', to: '2026-12-31' };
  const r = await tx((t) => saveInvoice(t, firmId, {
    kind: 'invoice', date: '2026-12-15', partnerId: cust, due: '2027-01-15',
    lines: [{ itemId: regal, name: 'Регал по мерка 6 × 2,5 m', unit: 'm²', qty: 15, price: 4200, rate: 18 }],
    data: { prod: 'Д', prodInv: '1', woNo: wo.number, woFrom: wo.from, woTo: wo.to },
    production: { mode: 'prodInv', workOrder: wo, lines: [{
      lineNo: 0, productId: regal, qty: 15, main: true, spec: { text: 'Регал', mode: 'm2', l: 6, w: 2.5 },
      materials: [{ itemId: lim, qty: 18 }, { itemId: prof, qty: 60 }, { itemId: scr, qty: 240 }],
      calc: { hours: 24, rate: 450, other: [{ label: 'Транспорт', amount: 3000 }], ovhPct: 10 },
    }] },
  } as never, office));
  invId = r.id;
  expect(r.status).toBe('posted');
  // the database hands the moves back in any order: put the production moves physically after the sale
  await db.execute(sql`update stock_moves set label = label where source_type = 'production'`);
}, 120_000);

describe('production firm: year-end control and the ЦРМ statements', () => {
  it('posts production by nature: D 4000 / C 3100 materials, D 6000 / C 4900 the whole cost, D 6300 / C 6000', async () => {
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invId));
    const run = (inv!.data as schema.InvoiceData).prodRun!;
    const J = await journalOf('stock:production', run.orders[0]!.id);
    const mat = run.orders[0]!.mat, cost = run.lines[0]!.res!.cost;
    expect(mat).toBe(18 * 650 + 60 * 140 + 240 * 4); // 21 060
    expect(side(J, '4000')).toBe(mat);
    expect(side(J, '3100')).toBe(-mat);
    expect(side(J, '4900')).toBe(-cost);
    expect(side(J, '6000')).toBe(0);
    expect(side(J, '6300')).toBe(cost);
  });

  it('no „залихата во минус“ for a product produced and sold on the same day; nothing blocks the close', async () => {
    const L = await tx((t) => loadYear(t, firmId, 2026));
    const F = await tx((t) => yearFindings(t, L, TODAY));
    expect(F.all.filter((x) => x.key.startsWith('st|'))).toEqual([]);
    expect(F.open).toEqual([]);
  });

  it('„Контрола на завршна сметка“: 4900 on its own (credit) side, no account outside the AOP, A = P, БУ 255 = БС 077', async () => {
    const L = await tx((t) => loadYear(t, firmId, 2026));
    const K = zkData(L.inputs.tb, {}, L.rules);
    expect(K.sign).toEqual([]);
    expect(K.unm).toEqual([]);
    const V = L.Y.co.zs.V;
    expect(V.bs063).toBeGreaterThan(0);
    for (const [label, a, b] of zkAopChecks(V, {}).slice(0, 4)) expect(a, label).toBe(b);
    // the income statement equals the ledger: revenue − materials (AOP 208) + the stock of products (AOP 205)
    const tb = new Map(L.inputs.tb.map((r) => [r.account, r2(r.debit - r.credit)]));
    const ledger = -[...tb].filter(([k]) => /^[47]/.test(k)).reduce((a, [, v]) => a + v, 0);
    expect((V.bu250 ?? 0) - (V.bu251 ?? 0)).toBe(Math.round(ledger));
    expect(V.bu205).toBe(Math.round((tb.get('6300') ?? 0) + (tb.get('6000') ?? 0)));
    expect(V.bu208).toBe(Math.round(tb.get('4000') ?? 0));
  });

  it('the year closes and the closed statements still balance', async () => {
    await tx((t) => closeYear(t, { firmId, year: 2026, userId: null, today: TODAY }));
    const L = await tx((t) => loadYear(t, firmId, 2026));
    const V = L.Y.co.zs.V;
    expect(V.bs063).toBe(V.bs111);
    expect(V.bu255).toBe(V.bs077);
  });
});

describe('„Упросечување“ re-posts production booked by the legacy scheme', () => {
  it('D 6000 / C stock for the materials becomes D 4000; the receipt gets the whole-cost transfer through 4900', async () => {
    const [f] = await db.insert(schema.firms).values({ name: 'Стара ДООЕЛ', edb: '4030000000004' }).returning();
    const fid = f!.id;
    const [s] = await db.insert(schema.partners).values({ firmId: fid, name: 'Добавувач' }).returning();
    const I = await db.insert(schema.items).values([{ firmId: fid, code: '1', name: 'Мат', type: 'material', vatRate: 18 }, { firmId: fid, code: '2', name: 'Прод', type: 'product', vatRate: 18 }]).returning();
    const [m, p] = I.map((x) => x.id) as [string, string];
    await tx((t) => savePurchase(t, fid, { number: '1', date: '2026-02-01', partnerId: s!.id, ptype: 'stock', groups: [{ account: '3100', rate: 18, base: 1000, vat: 180 }], stock: [{ itemId: m, qty: 10, price: 100, type: 'material' }], costs: {} } as never, office));
    await tx((t) => saveBom(t as never, { firmId: fid, userId: null }, { productId: p, labor: 50, lines: [{ itemId: m, qty: 2 }] }));
    const o = await tx((t) => runProductionOrder(t as never, { firmId: fid, userId: null }, { date: '2026-02-02', productId: p, qty: 2 }));
    // rewrite the stored moves as the legacy posting left them
    const M = await db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, 'production'), eq(schema.stockMoves.sourceId, o.id)));
    for (const x of M) {
      const v = Math.abs(Number(x.value));
      const lines = x.kind === 'prod-out'
        ? [{ account: '6000', debit: v, credit: 0 }, { account: '3100', debit: 0, credit: v }]
        : [{ account: '6000', debit: 100, credit: 0 }, { account: '4900', debit: 0, credit: 100 }, { account: '6300', debit: v, credit: 0 }, { account: '6000', debit: 0, credit: v }];
      await db.update(schema.stockMoves).set({ lines }).where(eq(schema.stockMoves.id, x.id));
    }
    await tx((t) => runStockReaverage(t as never, { firmId: fid, userId: null }));
    const J = await journalOf('stock:production', o.id);
    expect(side(J, '4000')).toBe(400);
    expect(side(J, '3100')).toBe(-400);
    expect(side(J, '4900')).toBe(-500);
    expect(side(J, '6000')).toBe(0);
    expect(side(J, '6300')).toBe(500);
  });
});

function r2(v: number) { return Math.round(v * 100) / 100; }
