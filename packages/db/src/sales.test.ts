import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { approveInvoice, deleteInvoice, saveInvoice, type InvoiceInput } from './sales/invoices';
import { approvePurchase, deletePurchase, savePurchase, type PurchaseInput } from './sales/purchases';
import { deleteSupplierCredit, saveSupplierCredit } from './sales/supplier-credits';
import { DocumentError, type Actor } from './sales/context';
import { PostingError } from './posting';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
let firmId = '', cust = '', sup = '', goods = '', svc = '';
const office: Actor = { userId: null, role: 'acc' };
const klient: Actor = { userId: null, role: 'klient' };

const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };

async function journal(sourceType: string, sourceId: string) {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId)));
  if (!j) return null;
  const L = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j.id));
  const by: Record<string, number> = {};
  for (const l of L) by[l.account] = Math.round(((by[l.account] ?? 0) + Number(l.debit) - Number(l.credit)) * 100) / 100;
  return { j, L, by };
}
const moves = (sourceType: string, sourceId: string) =>
  db.select().from(schema.stockMoves).where(and(eq(schema.stockMoves.sourceType, sourceType), eq(schema.stockMoves.sourceId, sourceId)));

const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({
  kind: 'invoice', date: '2026-03-10', partnerId: cust, lines: [{ itemId: goods, name: 'Шраф', qty: 4, price: 200, rate: 18 }], ...o,
});
const pur = (o: Partial<PurchaseInput> = {}): PurchaseInput => ({
  number: 'D-100', date: '2026-03-01', partnerId: sup, ptype: 'stock',
  groups: [{ account: '6600', rate: 18, base: 1000, vat: 180 }],
  stock: [{ itemId: goods, qty: 10, price: 100 }],
  costs: { trans: { amount: 100, partnerId: sup, lines: [{ base: 100, rate: 18, vat: 18 }] } }, ...o,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Трговија ДООЕЛ', edb: '4030000000001' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач', code: '1' }, { firmId, name: 'Добавувач', code: '2', edb: '4030999000111' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const I = await db.insert(schema.items).values([{ firmId, name: 'Шраф', code: '10', type: 'goods', vatRate: 18, price: '200' }, { firmId, name: 'Консалтинг', code: '20', type: 'service', vatRate: 18 }]).returning();
  goods = I[0]!.id; svc = I[1]!.id;
}, 60_000);

describe('purchases', () => {
  let pid = '';
  it('saves, posts a balanced journal with landed costs and receipt moves', async () => {
    const r = await tx((t) => savePurchase(t, firmId, pur(), office));
    pid = r.id;
    expect(r.status).toBe('posted');
    const J = (await journal('purchase', pid))!;
    expect(J.j.kind).toBe('vlez');
    expect(J.j.number).toBe('2/1-3');
    expect(J.by['6600']).toBe(1100);
    expect(J.by['2200']).toBe(-1298);
    const M = await moves('purchase', pid);
    expect(M.map((m) => [m.direction, Number(m.qty), Number(m.value)])).toEqual([['in', 10, 1100]]);
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, pid));
    expect(p).toMatchObject({ total: '1180.00', calcNo: '0001 01' });
  });
  it('rejects a duplicate (partner + number + amount)', async () => {
    const e = await err(tx((t) => savePurchase(t, firmId, pur({ number: 'd 100' }), office)));
    expect(e).toBeInstanceOf(DocumentError);
    expect(e.message).toMatch(/веќе е внесена/);
    const ok = await tx((t) => savePurchase(t, firmId, pur({ number: 'd 100', allowDuplicate: true, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 10, vat: 1.8 }] }), office));
    await tx((t) => deletePurchase(t, firmId, ok.id, office));
  });
  it('creates missing items and a new supplier from a scan', async () => {
    const r = await tx((t) => savePurchase(t, firmId, pur({ number: 'X-1', partnerId: null, supplierName: 'Нов добавувач', supplierEdb: '4030555000111', costs: {},
      groups: [{ account: '6600', rate: 5, base: 50, vat: 2.5 }], stock: [{ name: 'Нов артикл', qty: 5, price: 10, code: 'S-77' }] }), office));
    expect(r.createdItems).toBe(1);
    const [it] = await db.select().from(schema.items).where(eq(schema.items.name, 'Нов артикл'));
    expect(it).toMatchObject({ code: '1000', price: '12.5000', revenueAccount: null });
    const sc = await db.select().from(schema.itemSupplierCodes).where(eq(schema.itemSupplierCodes.itemId, it!.id));
    expect(sc.map((x) => x.code)).toEqual(['S-77']);
    await tx((t) => deletePurchase(t, firmId, r.id, office));
    expect(await journal('purchase', r.id)).toBeNull();
  });
  it('klient purchases are pending until approved', async () => {
    const r = await tx((t) => savePurchase(t, firmId, pur({ number: 'K-1', ptype: 'cost', stock: [], costs: {}, groups: [{ account: '4000', rate: 18, base: 100, vat: 18 }] }), klient));
    expect(r.status).toBe('pending');
    expect(await journal('purchase', r.id)).toBeNull();
    await tx((t) => approvePurchase(t, firmId, r.id, office));
    expect((await journal('purchase', r.id))!.by['2200']).toBe(-118);
    await tx((t) => deletePurchase(t, firmId, r.id, office));
  });
});

describe('invoices', () => {
  let id = '';
  it('posts the sale and the cost of goods sold', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, inv(), office));
    id = r.id;
    expect(r).toMatchObject({ number: '001/2026', status: 'posted', renumbered: false });
    const J = (await journal('invoice', id))!;
    expect(J.j.kind).toBe('izlez');
    expect(J.by['1200']).toBe(944);
    expect(J.by['741018']).toBe(-800); // goods → revGoods 7410 per rate (scheme, not the literal 7400)
    expect(J.L.find((l) => l.account === '1200')!.partnerId).toBe(cust);
    const S = (await journal('invoice_stock', id))!;
    expect(S.j.kind).toBe('zaliha');
    expect(S.by).toEqual({ '7010': 440, '6600': -440 });
    expect((await moves('invoice', id)).map((m) => [m.direction, Number(m.qty), Number(m.value)])).toEqual([['out', -4, -440]]);
  });
  it('re-saving replaces journal and moves in place; a taken number is renumbered', async () => {
    const before = (await journal('invoice', id))!.j;
    await tx((t) => saveInvoice(t, firmId, inv({ id, number: '001/2026', lines: [{ itemId: goods, name: 'Шраф', qty: 5, price: 200, rate: 18 }] }), office));
    const after = (await journal('invoice', id))!;
    expect(after.j.id).toBe(before.id);
    expect(after.by['1200']).toBe(1180);
    expect((await moves('invoice', id)).map((m) => Number(m.qty))).toEqual([-5]);
    const r2 = await tx((t) => saveInvoice(t, firmId, inv({ number: '001/2026', lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 1000, rate: 18 }] }), office));
    expect(r2).toMatchObject({ number: '002/2026', renumbered: true });
    expect(await journal('invoice_stock', r2.id)).toBeNull();
    await tx((t) => deleteInvoice(t, firmId, r2.id, office));
  });
  it('credit note (return) reverses revenue and returns goods to stock', async () => {
    const e = await err(tx((t) => saveInvoice(t, firmId, inv({ kind: 'credit', refInvoiceId: id, creditKind: 'ret', lines: [{ itemId: goods, name: 'Шраф', qty: 9, price: 200, rate: 18 }] }), office)));
    expect(e.message).toMatch(/повеќе|поголемо/);
    const c = await tx((t) => saveInvoice(t, firmId, inv({ kind: 'credit', date: '2026-03-12', refInvoiceId: id, creditKind: 'ret', lines: [{ itemId: goods, name: 'Шраф', qty: 2, price: 200, rate: 18 }] }), office));
    expect(c.number).toBe('001/2026');
    const J = (await journal('invoice', c.id))!;
    expect(J.j.kind).toBe('odobr');
    expect(J.by['1200']).toBe(-472);
    expect((await journal('invoice_stock', c.id))!.by).toEqual({ '6600': 220, '7010': -220 });
    expect((await moves('invoice', c.id)).map((m) => [m.direction, Number(m.qty), Number(m.value)])).toEqual([['in', 2, 220]]);
    expect((await err(tx((t) => deleteInvoice(t, firmId, id, office)))).message).toMatch(/одобрение/);
    await tx((t) => deleteInvoice(t, firmId, c.id, office));
    expect(await journal('invoice', c.id)).toBeNull();
  });
  it('klient invoices are pending (no journal, no moves) until approved', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, inv({ lines: [{ itemId: goods, name: 'Шраф', qty: 1, price: 200, rate: 18 }] }), klient));
    expect(r.status).toBe('pending');
    expect(await journal('invoice', r.id)).toBeNull();
    expect(await moves('invoice', r.id)).toHaveLength(0);
    await tx((t) => approveInvoice(t, firmId, r.id, office));
    expect((await journal('invoice', r.id))!.by['1200']).toBe(236);
    expect(await moves('invoice', r.id)).toHaveLength(1);
    await tx((t) => deleteInvoice(t, firmId, r.id, office));
  });
  it('proforma is never posted; converting it links both documents', async () => {
    const p = await tx((t) => saveInvoice(t, firmId, inv({ kind: 'proforma', lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 500, rate: 18 }] }), office));
    expect(p.status).toBe('draft');
    expect(await journal('invoice', p.id)).toBeNull();
    const i = await tx((t) => saveInvoice(t, firmId, inv({ fromDocId: p.id, lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 500, rate: 18 }] }), office));
    const [src] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, p.id));
    expect(src!.invoicedId).toBe(i.id);
    await tx((t) => deleteInvoice(t, firmId, i.id, office));
    await tx((t) => deleteInvoice(t, firmId, p.id, office));
  });
  it('dispatch note issues stock; the invoice made from it does not issue again', async () => {
    const d = await tx((t) => saveInvoice(t, firmId, inv({ kind: 'dispatch', lines: [{ itemId: goods, name: 'Шраф', qty: 1, price: 200, rate: 18 }] }), office));
    expect(await journal('invoice', d.id)).toBeNull();
    expect((await journal('invoice_stock', d.id))!.by['7010']).toBe(110);
    const i = await tx((t) => saveInvoice(t, firmId, inv({ fromDocId: d.id, lines: [{ itemId: goods, name: 'Шраф', qty: 1, price: 200, rate: 18 }] }), office));
    expect(await moves('invoice', i.id)).toHaveLength(0);
    expect((await journal('invoice', i.id))!.by['1200']).toBe(236);
    await tx((t) => deleteInvoice(t, firmId, i.id, office));
    await tx((t) => deleteInvoice(t, firmId, d.id, office));
  });
  it('foreign currency: posted in denars, customer line keeps the currency amount (FIX 11)', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, inv({ currency: 'EUR', fx: 61.5, lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 100, rate: 18 }] }), office));
    const J = (await journal('invoice', r.id))!;
    const c = J.L.find((l) => l.account === '1200')!;
    expect([Number(c.debit), c.currency, Number(c.amountCur)]).toEqual([7257, 'EUR', 118]);
    await tx((t) => deleteInvoice(t, firmId, r.id, office));
  });
  it('advance invoice and its deduction', async () => {
    const a = await tx((t) => saveInvoice(t, firmId, inv({ advance: true, lines: [{ name: 'Аванс', qty: 1, price: 1000, rate: 18 }] }), office));
    expect((await journal('invoice', a.id))!.by['2220']).toBe(-1000);
    const e = await err(tx((t) => saveInvoice(t, firmId, inv({ lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 3000, rate: 18 }], advances: [{ advanceId: a.id, amount: 1500 }] }), office)));
    expect(e.message).toMatch(/остатокот/);
    const f = await tx((t) => saveInvoice(t, firmId, inv({ lines: [{ itemId: svc, name: 'Консалтинг', qty: 1, price: 3000, rate: 18 }], advances: [{ advanceId: a.id, amount: 1000 }] }), office));
    const J = (await journal('invoice', f.id))!;
    expect(J.by['2220']).toBe(1000);
    expect(J.by['1200']).toBe(3540 - 1180);
    expect((await err(tx((t) => deleteInvoice(t, firmId, a.id, office)))).message).toMatch(/Авансот/);
    await tx((t) => deleteInvoice(t, firmId, f.id, office));
    await tx((t) => deleteInvoice(t, firmId, a.id, office));
  });
  it('respects the period lock', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    const e = await err(tx((t) => saveInvoice(t, firmId, inv({ id, lines: [{ itemId: goods, name: 'Шраф', qty: 1, price: 1, rate: 18 }] }), office)));
    expect(e).toBeInstanceOf(PostingError);
    expect((e as PostingError).code).toBe('locked');
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });
});

describe('supplier credits', () => {
  it('return to supplier posts povrat and reduces stock; checks received quantity', async () => {
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.number, 'D-100'));
    const e = await err(tx((t) => saveSupplierCredit(t, firmId, { kind: 'ret', date: '2026-03-20', partnerId: sup, refPurchaseId: p!.id, rows: [{ itemId: goods, name: 'Шраф', qty: 11, price: 110, rate: 18 }] }, office)));
    expect(e.message).toMatch(/примено/);
    const r = await tx((t) => saveSupplierCredit(t, firmId, { kind: 'ret', date: '2026-03-20', partnerId: sup, refPurchaseId: p!.id, rows: [{ itemId: goods, name: 'Шраф', qty: 1, price: 110, rate: 18 }] }, office));
    expect(r.number).toBe('001/2026');
    const J = (await journal('supplier_credit', r.id))!;
    expect(J.j.kind).toBe('povrat');
    expect(J.by['2200']).toBe(130);
    expect(J.by['6600']).toBe(-110);
    expect((await moves('supplier_credit', r.id)).map((m) => Number(m.qty))).toEqual([-1]);
    expect((await err(tx((t) => deletePurchase(t, firmId, p!.id, office)))).message).toMatch(/повратница/);
    await tx((t) => deleteSupplierCredit(t, firmId, r.id, office));
    expect(await journal('supplier_credit', r.id)).toBeNull();
  });
});
