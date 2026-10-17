/**
 * Deleting a „Налог за книжење“ together with its documents (`nalog-delete.ts`): purchases go with the nalog, other
 * nalozi stay untouched, an e-invoiced outgoing invoice is refused (→ storno), a locked period is refused, the preview
 * changes nothing, and one document of a nalog can be deleted on its own. Synthetic data only.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { saveInvoice, type InvoiceInput } from './sales/invoices';
import { savePurchase, type PurchaseInput } from './sales/purchases';
import type { DocActor } from './sales/context';
import { deleteNalogParts, previewNalogDelete } from './nalog-delete';
import type { Tx } from './audit';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const office: DocActor = { userId: null, role: 'acc' };
const tx = <T>(f: (t: Tx) => Promise<T>) => db.transaction((t) => f(t as unknown as Tx));
let firmId = '', cust = '', sup = '', chair = '';

const cost = (number: string, date: string, base: number): Partial<PurchaseInput> & Record<string, unknown> =>
  ({ number, date, partnerId: sup, ptype: 'cost', groups: [{ account: '4410', rate: 18, base, vat: base * 0.18 }] });
const sale = (date: string, qty = 1): InvoiceInput => ({ kind: 'invoice', date, partnerId: cust, lines: [{ itemId: chair, name: 'Стол', qty, price: 1000, rate: 18 }] });
const journalOf = async (sourceType: string, id: string) =>
  (await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, id))))[0];
const purchaseIds = async (ids: string[]) => (await db.select({ id: schema.purchases.id }).from(schema.purchases).where(inArray(schema.purchases.id, ids))).map((r) => r.id);
const invoiceIds = async (ids: string[]) => (await db.select({ id: schema.invoices.id }).from(schema.invoices).where(inArray(schema.invoices.id, ids))).map((r) => r.id);
const purchase = async (number: string, date: string, base: number) =>
  (await tx((t) => savePurchase(t as unknown as DB, firmId, cost(number, date, base) as unknown as PurchaseInput, office))).id;

let p1 = '', p2 = '', p3 = '', p4 = '', i1 = '', i2 = '', nalP = '', nalQ4 = '', nalI = '', nalStock = '';

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Тест Налози ДООЕЛ', edb: '4030000000011' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач Тест', code: '1' }, { firmId, name: 'Добавувач Тест', code: '2' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const [I] = await db.insert(schema.items).values([{ firmId, name: 'Стол', code: '100', type: 'goods', vatRate: 18, price: '1000' }]).returning();
  chair = I!.id;
  // stock for the sales (its own nalog of the first quarter)
  const s0 = (await tx((t) => savePurchase(t as unknown as DB, firmId, { number: 'P-0', date: '2026-01-02', partnerId: sup, ptype: 'stock', groups: [{ account: '6600', rate: 18, base: 6000, vat: 1080 }],
    stock: [{ itemId: chair, qty: 20, price: 300, type: 'goods' }] } as unknown as PurchaseInput, office))).id;
  nalStock = (await journalOf('purchase', s0))!.number;
  p1 = await purchase('114-1', '2026-08-05', 1000);
  p2 = await purchase('114-2', '2026-09-10', 2000);
  p3 = await purchase('114-3', '2026-10-05', 3000);
  p4 = await purchase('114-4', '2026-11-05', 4000);
  i1 = (await tx((t) => saveInvoice(t as unknown as DB, firmId, sale('2026-08-10'), office))).id;
  i2 = (await tx((t) => saveInvoice(t as unknown as DB, firmId, sale('2026-08-20', 2), office))).id;
  nalP = (await journalOf('purchase', p1))!.number;
  nalQ4 = (await journalOf('purchase', p3))!.number;
  nalI = (await journalOf('invoice', i1))!.number;
}, 120_000);

describe('deleting a nalog with its documents', () => {
  it('the nalozi are shared per period as expected by the scenario', async () => {
    expect((await journalOf('purchase', p2))!.number).toBe(nalP);
    expect((await journalOf('purchase', p4))!.number).toBe(nalQ4);
    expect((await journalOf('invoice', i2))!.number).toBe(nalI);
    expect(new Set([nalP, nalQ4, nalI, nalStock]).size).toBe(4);
  });

  it('the preview lists the documents and changes nothing', async () => {
    const r = await tx((t) => previewNalogDelete(t, { firmId, actor: office, no: nalP, year: 2026 }));
    expect(r.parts.map((p) => [p.type, p.number, p.partner, p.total]).sort()).toEqual([
      ['Влезна ф-ра', '114-1', 'Добавувач Тест', 1180], ['Влезна ф-ра', '114-2', 'Добавувач Тест', 2360]]);
    expect(r.perms).toContain('del');
    expect(await purchaseIds([p1, p2])).toHaveLength(2);
    expect(await journalOf('purchase', p1)).toBeTruthy();
  });

  it('deletes the nalog with its purchases; other nalozi and their documents stay', async () => {
    const before = await db.select().from(schema.journals).where(eq(schema.journals.firmId, firmId));
    const r = await tx((t) => deleteNalogParts(t, { firmId, actor: office, no: nalP, year: 2026 }));
    expect(r.parts.every((p) => p.outcome === 'deleted')).toBe(true);
    expect(await purchaseIds([p1, p2, p3, p4])).toEqual(expect.arrayContaining([p3, p4]));
    expect(await purchaseIds([p1, p2])).toHaveLength(0);
    const after = await db.select().from(schema.journals).where(eq(schema.journals.firmId, firmId));
    expect(after.filter((j) => j.number === nalP)).toHaveLength(0);
    expect(after.map((j) => j.id).sort()).toEqual(before.filter((j) => j.number !== nalP).map((j) => j.id).sort());
    expect(await invoiceIds([i1, i2])).toHaveLength(2);
    const [a] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'nalDel')));
    expect((a!.data as { removed: unknown[] }).removed).toHaveLength(2);
  });

  it('one document of a nalog is deleted alone; the rest of the nalog stays', async () => {
    const j3 = (await journalOf('purchase', p3))!;
    await tx((t) => deleteNalogParts(t, { firmId, actor: office, no: nalQ4, year: 2026, journalIds: [j3.id] }));
    expect(await purchaseIds([p3, p4])).toEqual([p4]);
    expect((await journalOf('purchase', p4))!.number).toBe(nalQ4);
  });

  it('refuses an outgoing invoice exported / sent as e-invoice and keeps everything', async () => {
    await db.update(schema.invoices).set({ data: { efExport: { at: '2026-09-01T10:00:00Z', by: null, n: 1 } } }).where(eq(schema.invoices.id, i1));
    await expect(tx((t) => deleteNalogParts(t, { firmId, actor: office, no: nalI, year: 2026 }))).rejects.toThrow(/е-фактура.*Одобрение \(сторно\)/s);
    await expect(tx((t) => previewNalogDelete(t, { firmId, actor: office, no: nalI, year: 2026 }))).rejects.toThrow(/е-фактура/);
    expect(await invoiceIds([i1, i2])).toHaveLength(2);
    expect(await journalOf('invoice', i2)).toBeTruthy();
    await db.update(schema.invoices).set({ data: {} }).where(eq(schema.invoices.id, i1));
  });

  it('refuses a nalog in a locked period', async () => {
    await db.update(schema.firms).set({ lockDate: '2026-09-30' }).where(eq(schema.firms.id, firmId));
    await expect(tx((t) => deleteNalogParts(t, { firmId, actor: office, no: nalI, year: 2026 }))).rejects.toThrow(/заклучен период/);
    expect(await invoiceIds([i1, i2])).toHaveLength(2);
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });

  it('deletes the outgoing invoices of an unlocked nalog (highest number first, so none becomes a storno)', async () => {
    const r = await tx((t) => deleteNalogParts(t, { firmId, actor: office, no: nalI, year: 2026 }));
    expect(r.parts.map((p) => p.outcome)).toEqual(['deleted', 'deleted']);
    expect(await invoiceIds([i1, i2])).toHaveLength(0);
    expect(await purchaseIds([p4])).toEqual([p4]);
  });
});
