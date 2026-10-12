/**
 * Collective „Налог за книжење“ of sales invoices and the header-first draft workflow (нацрт → прокнижи):
 * - several invoices booked into one opened nalog keep their own journal rows; editing / cancelling one leaves the
 *   others and the balance intact; period and lock rules hold;
 * - a draft has no journals / VAT / stock, carries a provisional number and gets the series number when booked;
 *   deleting a draft leaves no gap in the issued numbers; empty rows are ignored.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { approveInvoice, deleteInvoice, saveInvoice, type InvoiceInput } from './sales/invoices';
import { createInvoiceNalog, listInvoiceNalozi } from './sales/invoice-nalog';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const office: DocActor = { userId: null, role: 'acc' };
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
let firmId = '', cust = '', sup = '', chair = '', a = '', b = '';

const sale = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({
  kind: 'invoice', date: '2026-10-05', partnerId: cust, lines: [{ itemId: chair, name: 'Стол', qty: 1, price: 1000, rate: 18 }], ...o,
});
const journalsOf = (number: string) => db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.number, number)));
const linesOf = (journalId: string) => db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, journalId));
const sourceJournal = async (id: string) => (await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, id))))[0];
const balance = async (number: string) => {
  let d = 0, c = 0;
  for (const j of await journalsOf(number)) for (const l of await linesOf(j.id)) { d += Number(l.debit); c += Number(l.credit); }
  return { d: Math.round(d * 100) / 100, c: Math.round(c * 100) / 100 };
};
const stockOf = async (sourceId: string) => db.select().from(schema.stockMoves).where(eq(schema.stockMoves.sourceId, sourceId));
const firm = async () => (await db.select().from(schema.firms).where(eq(schema.firms.id, firmId)))[0]!;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'Мебел ДООЕЛ', edb: '4030000000003' }).returning();
  firmId = f!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач', code: '1' }, { firmId, name: 'Добавувач', code: '2' }]).returning();
  cust = P[0]!.id; sup = P[1]!.id;
  const [I] = await db.insert(schema.items).values([{ firmId, name: 'Стол', code: '100', type: 'goods', vatRate: 18, price: '1000' }]).returning();
  chair = I!.id;
  await tx((t) => savePurchase(t, firmId, { number: 'P-1', date: '2026-01-02', partnerId: sup, ptype: 'stock', groups: [{ account: '6600', rate: 18, base: 6000, vat: 1080 }],
    stock: [{ itemId: chair, qty: 20, price: 300, type: 'goods' }] }, office));
}, 60_000);

describe('collective nalog („Налог за книжење“ shared by several invoices)', () => {
  it('books two invoices into one opened nalog, each with its own balanced row', async () => {
    const F = await firm();
    const n = await tx(async (t) => createInvoiceNalog(t, F, { number: '500', date: '2026-10-01', description: 'Излезни фактури 10/2026', periodFrom: '2026-10-01', periodTo: '2026-10-31' }, null));
    expect(n.number).toBe('500');
    a = (await tx((t) => saveInvoice(t, firmId, sale({ data: { nalogNo: '500' } }), office))).id;
    b = (await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-10-20', data: { nalogNo: '500' }, lines: [{ itemId: chair, name: 'Стол', qty: 2, price: 1000, rate: 18 }] }), office))).id;
    const J = await journalsOf('500');
    expect(J).toHaveLength(3); // header + 2 invoices
    expect(J.filter((j) => j.sourceType === 'invoice').map((j) => j.sourceId).sort()).toEqual([a, b].sort());
    for (const j of J) { const L = await linesOf(j.id); expect(L.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBeCloseTo(0, 2); }
    // each invoice's lines are identifiable: own row + the invoice number on every line
    const [ia] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, a));
    expect((await linesOf((await sourceJournal(a))!.id)).every((l) => l.doc === ia!.number)).toBe(true);
    const bal = await balance('500');
    expect(bal.d).toBe(bal.c);
    expect(bal.d).toBeGreaterThan(0);
    const L = await listInvoiceNalozi(db, firmId, 2026);
    expect(L.find((x) => x.number === '500')).toMatchObject({ invoices: 2, collective: true, periodFrom: '2026-10-01', periodTo: '2026-10-31' });
  });
  it('editing one invoice replaces only its row; the other stays untouched and the nalog balanced', async () => {
    const jb = (await sourceJournal(b))!;
    const lb = (await linesOf(jb.id)).map((l) => [l.account, l.debit, l.credit]);
    const ja = (await sourceJournal(a))!;
    await tx((t) => saveInvoice(t, firmId, sale({ id: a, number: '001/2026', data: { nalogNo: '500' }, lines: [{ itemId: chair, name: 'Стол', qty: 3, price: 1000, rate: 18 }] }), office));
    expect((await sourceJournal(a))!).toMatchObject({ id: ja.id, number: '500' });
    expect((await linesOf(jb.id)).map((l) => [l.account, l.debit, l.credit])).toEqual(lb);
    const bal = await balance('500');
    expect(bal.d).toBe(bal.c);
  });
  it('an invoice outside the nalog period, or into a locked nalog, is refused', async () => {
    await expect(tx((t) => saveInvoice(t, firmId, sale({ date: '2026-11-03', data: { nalogNo: '500' } }), office))).rejects.toThrow(/надвор од периодот/);
    await expect(tx((t) => saveInvoice(t, firmId, sale({ data: { nalogNo: '999' } }), office))).rejects.toThrow(/не постои/);
    const [h] = (await journalsOf('500')).filter((j) => !j.sourceId);
    await db.update(schema.journals).set({ locked: true }).where(eq(schema.journals.id, h!.id));
    await expect(tx((t) => saveInvoice(t, firmId, sale({ date: '2026-10-25', data: { nalogNo: '500' } }), office))).rejects.toThrow(/заклучен/);
    expect((await listInvoiceNalozi(db, firmId, 2026)).some((x) => x.number === '500')).toBe(false);
    await db.update(schema.journals).set({ locked: false }).where(eq(schema.journals.id, h!.id));
  });
  it('cancelling one invoice removes only its row; the other invoice stays in the nalog', async () => {
    const r = await tx((t) => deleteInvoice(t, firmId, a, office, 'грешка'));
    expect(r.cancelled).toBe(true); // a is not the last number (b came after)
    const J = await journalsOf('500');
    expect(J.filter((j) => j.sourceType === 'invoice').map((j) => j.sourceId)).toEqual([b]);
    const bal = await balance('500');
    expect(bal.d).toBe(bal.c);
    expect(bal.d).toBeGreaterThan(0);
  });
  it('choosing „Нов налог (автоматски број)“ again takes the invoice out of the collective nalog', async () => {
    await tx((t) => saveInvoice(t, firmId, sale({ id: b, number: '002/2026', date: '2026-10-20', data: { nalogNo: '' }, lines: [{ itemId: chair, name: 'Стол', qty: 2, price: 1000, rate: 18 }] }), office));
    expect((await sourceJournal(b))!.number).not.toBe('500');
    expect((await journalsOf('500')).filter((j) => j.sourceId)).toHaveLength(0);
  });
  it('a new nalog number already used in the year is refused', async () => {
    const F = await firm();
    await expect(tx(async (t) => createInvoiceNalog(t, F, { number: '500', date: '2026-10-02' }, null))).rejects.toThrow(/веќе постои/);
  });
});

describe('header-first draft (нацрт) → прокнижи', () => {
  let d1 = '';
  it('a header-only draft has a provisional number and no journals / VAT / stock', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-12-01', lines: [], draft: true }), office));
    d1 = r.id;
    expect(r.status).toBe('draft');
    expect(r.number).toMatch(/^НАЦРТ-\d+$/);
    expect(await sourceJournal(d1)).toBeUndefined();
    // the lines entered „from inside“, saved again as a draft: still nothing booked
    const r2 = await tx((t) => saveInvoice(t, firmId, sale({ id: d1, date: '2026-12-01', number: '', draft: true }), office));
    expect(r2.number).toBe(r.number);
    expect(await sourceJournal(d1)).toBeUndefined();
    expect(await stockOf(d1)).toHaveLength(0);
    expect((await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceId, d1))))).toHaveLength(0);
  });
  it('an invoice issued meanwhile takes the next series number (the draft holds none)', async () => {
    const [last] = await db.select({ n: schema.invoices.number }).from(schema.invoices).where(and(eq(schema.invoices.firmId, firmId), eq(schema.invoices.id, (await sourceJournal(b))!.sourceId!)));
    const x = await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-12-02' }), office));
    const num = (s: string) => parseInt(s, 10);
    expect(num(x.number)).toBe(num(last!.n) + 1);
  });
  it('„Зачувај и прокнижи“ gives the draft the next series number and books it', async () => {
    const before = (await db.select({ n: schema.invoices.number }).from(schema.invoices).where(and(eq(schema.invoices.firmId, firmId), eq(schema.invoices.status, 'posted')))).map((r) => parseInt(r.n, 10));
    const r = await tx((t) => saveInvoice(t, firmId, sale({ id: d1, date: '2026-12-01', number: 'НАЦРТ-1' }), office));
    expect(r.status).toBe('posted');
    expect(parseInt(r.number, 10)).toBe(Math.max(...before) + 1);
    expect(await sourceJournal(d1)).toBeDefined();
    expect((await stockOf(d1)).length).toBeGreaterThan(0);
  });
  it('deleting a draft leaves no gap; approving a draft numbers it', async () => {
    const dd = await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-12-03', lines: [], draft: true }), office));
    const dl = await tx((t) => deleteInvoice(t, firmId, dd.id, office));
    expect(dl.cancelled).toBe(false);
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.id, dd.id))).toHaveLength(0);
    const nums = (await db.select({ n: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.firmId, firmId))).map((r) => r.n).filter((n) => !n.startsWith('НАЦРТ'));
    const N = nums.map((n) => parseInt(n, 10)).sort((p, q) => p - q);
    expect(N).toEqual(N.map((_, i) => N[0]! + i)); // unbroken series
    // a draft without lines cannot be booked; with lines it is numbered on approval
    const e = await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-12-04', lines: [], draft: true }), office));
    await expect(tx((t) => approveInvoice(t, firmId, e.id, office))).rejects.toThrow(/нема ставки/);
    await tx((t) => saveInvoice(t, firmId, sale({ id: e.id, date: '2026-12-04', draft: true }), office));
    await tx((t) => approveInvoice(t, firmId, e.id, office));
    const [ie] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, e.id));
    expect(ie!.status).toBe('posted');
    expect(parseInt(ie!.number, 10)).toBe(N.at(-1)! + 1);
    expect(await sourceJournal(e.id)).toBeDefined();
  });
  it('empty rows are ignored (not saved, not blocking)', async () => {
    const r = await tx((t) => saveInvoice(t, firmId, sale({ date: '2026-12-05', lines: [{ itemId: chair, name: 'Стол', qty: 1, price: 1000, rate: 18 }, { name: '', qty: 1, price: '', rate: 18 }, { name: '  ', qty: '', price: '', rate: 18 }] }), office));
    expect(await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, r.id))).toHaveLength(1);
  });
});
