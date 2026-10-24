/**
 * Save guards of Влез / Излез / Скен: the firm is never its own partner; a dispatch note / proforma is invoiced once;
 * new partner codes under a per-firm lock; „💶 Платено во готово“ skips paid / sold purchases; approving a pending
 * store purchase applies its retail prices; the check list moves only expenses into the open VAT period; a read sale's
 * number is a duplicate only in its own year; VAT marks only for a VAT payer. Synthetic data only.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import type { Tx } from './audit';
import { postJournal } from './posting';
import { DocumentError, type DocActor } from './sales/context';
import { markInvoicesVat, saveInvoice, type InvoiceInput } from './sales/invoices';
import { approvePurchase, savePurchase, setPurchasesCash, type PurchaseInput } from './sales/purchases';
import { ensurePartner } from './sales/partners-auto';
import { saveSelectedScanDrafts } from './sales/scan-save';
import { saleDrafts } from './sales/scan-drafts';

const db = drizzle(new PGlite(), { schema });
const tx = <R>(f: (t: Tx) => Promise<R>) => db.transaction((t) => f(t as unknown as Tx));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected an error'); };
const office: DocActor = { userId: null, role: 'acc' };
const klient: DocActor = { userId: null, role: 'klient' };
let firm: schema.Firm, cust = '', sup = '', own = '', goods = '';

const inv = (o: Partial<InvoiceInput> = {}): InvoiceInput => ({ kind: 'invoice', date: '2026-03-10', partnerId: cust, lines: [{ itemId: goods, name: 'Шраф', qty: 1, price: 200, rate: 18 }], ...o });
const pur = (o: Partial<PurchaseInput> = {}): PurchaseInput => ({
  number: 'G-1', date: '2026-03-01', partnerId: sup, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 100, vat: 18 }], ...o,
});
const partnerCount = async () => (await db.select().from(schema.partners).where(eq(schema.partners.firmId, firm.id))).length;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'ЧУВАРИ ТЕСТ ДООЕЛ Скопје', edb: '4030000000555', vatRegistered: true }).returning() as [schema.Firm];
  const P = await db.insert(schema.partners).values([
    { firmId: firm.id, name: 'Купувач', code: '1' }, { firmId: firm.id, name: 'Добавувач', code: '2', edb: '4030999000111' },
    { firmId: firm.id, name: 'Чувари Тест ДООЕЛ', code: '3', edb: '4030000000555' },
  ]).returning();
  cust = P[0]!.id; sup = P[1]!.id; own = P[2]!.id;
  const [it] = await db.insert(schema.items).values({ firmId: firm.id, name: 'Шраф', code: '10', type: 'goods', vatRate: 18, price: '200' }).returning();
  goods = it!.id;
}, 120_000);

describe('the firm is never its own partner', () => {
  it('savePurchase refuses the own partner card and never creates one from the own name / ЕДБ', async () => {
    expect(await err(tx((t) => savePurchase(t, firm.id, pur({ partnerId: own }), office)))).toBeInstanceOf(DocumentError);
    const n0 = await partnerCount();
    const e = await err(tx((t) => savePurchase(t, firm.id, pur({ partnerId: null, supplierName: 'Друго име', supplierEdb: 'MK4030000000555' }), office)));
    expect(e.message).toMatch(/оваа фирма/);
    expect(await err(tx((t) => savePurchase(t, firm.id, pur({ partnerId: null, supplierName: '„Чувари Тест“ DOOEL' }), office)))).toBeInstanceOf(DocumentError);
    expect(await partnerCount()).toBe(n0);
  });
  it('saveInvoice refuses the own partner card', async () => {
    const e = await err(tx((t) => saveInvoice(t, firm.id, inv({ partnerId: own }), office)));
    expect(e).toBeInstanceOf(DocumentError);
    expect(e.message).toMatch(/оваа фирма/);
  });
});

describe('a dispatch note / proforma is invoiced once', () => {
  it('a second invoice from the same dispatch note is refused; re-saving the first is fine; only dispatch / proforma of the firm', async () => {
    const d = await tx((t) => saveInvoice(t, firm.id, inv({ kind: 'dispatch' }), office));
    const i1 = await tx((t) => saveInvoice(t, firm.id, inv({ fromDocId: d.id }), office));
    const e = await err(tx((t) => saveInvoice(t, firm.id, inv({ fromDocId: d.id }), office)));
    expect(e.message).toMatch(/веќе фактурирана со фактура/);
    await tx((t) => saveInvoice(t, firm.id, inv({ id: i1.id, number: i1.number, fromDocId: d.id }), office));
    const [src] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, d.id));
    expect(src!.invoicedId).toBe(i1.id);
    // an invoice is no source document
    expect((await err(tx((t) => saveInvoice(t, firm.id, inv({ fromDocId: i1.id }), office)))).message).toMatch(/не е најдена/);
    // another firm's dispatch note
    const [f2] = await db.insert(schema.firms).values({ name: 'Друга ДООЕЛ', edb: '4030000000666' }).returning();
    const [c2] = await db.insert(schema.partners).values({ firmId: f2!.id, name: 'К2', code: '1' }).returning();
    const d2 = await tx((t) => saveInvoice(t, f2!.id, { kind: 'dispatch', date: '2026-03-10', partnerId: c2!.id, lines: [{ name: 'Нешто', qty: 1, price: 10, rate: 18 }] }, office));
    expect((await err(tx((t) => saveInvoice(t, firm.id, inv({ fromDocId: d2.id }), office)))).message).toMatch(/не е најдена/);
  });
});

describe('ensurePartner', () => {
  it('takes a per-firm advisory lock before the next code; parallel creates get distinct codes', async () => {
    const held = await tx(async (t) => {
      await ensurePartner(t, firm.id, { name: 'Заклучен Партнер' });
      const r = await t.execute(sql`select count(*)::int as n from pg_locks where locktype = 'advisory'`);
      return Number((r as unknown as { rows: { n: number }[] }).rows[0]!.n);
    });
    expect(held).toBeGreaterThan(0);
    const R = await Promise.all(['Паралелен А', 'Паралелен Б', 'Паралелен В'].map((name) => tx((t) => ensurePartner(t, firm.id, { name }))));
    expect(new Set(R.map((r) => r.code)).size).toBe(3);
  });
});

describe('„💶 Платено во готово“', () => {
  it('skips a purchase with a payment and one whose goods were sold after it; turns a plain one into cash', async () => {
    const paid = await tx((t) => savePurchase(t, firm.id, pur({ number: 'PAY-1' }), office));
    await tx((t) => postJournal(t, { firmId: firm.id, date: '2026-03-05', kind: 'manual', userId: null, meta: { ref: { type: 'purchase', id: paid.id, amt: 50 } },
      lines: [{ account: '2200', debit: 50, partnerId: sup }, { account: '1000', credit: 50 }] }));
    const sold = await tx((t) => savePurchase(t, firm.id, pur({ number: 'STK-1', ptype: 'stock', groups: [{ account: '6600', rate: 18, base: 500, vat: 90 }], stock: [{ itemId: goods, qty: 5, price: 100 }] }), office));
    await tx((t) => saveInvoice(t, firm.id, inv({ date: '2026-03-20' }), office));
    const plain = await tx((t) => savePurchase(t, firm.id, pur({ number: 'CASH-1' }), office));
    const r = await tx((t) => setPurchasesCash(t, firm, [paid.id, sold.id, plain.id], null));
    expect(r.n).toBe(1);
    expect(r.skipped).toEqual([expect.stringMatching(/^PAY-1 \(има плаќање/), expect.stringMatching(/^STK-1 \(стоката е веќе продадена/)]);
    const P = await db.select({ id: schema.purchases.id, cash: schema.purchases.cash }).from(schema.purchases).where(eq(schema.purchases.firmId, firm.id));
    expect(P.filter((p) => p.cash).map((p) => p.id)).toEqual([plain.id]);
  });
});

describe('approving a pending store purchase', () => {
  it('applies the store retail price and levels the earlier stock (as a posted save does)', async () => {
    const [st] = await db.insert(schema.codes).values({ firmId: firm.id, cb: 'store', code: '09', name: 'Продавница' }).returning();
    const [it] = await db.insert(schema.items).values({ firmId: firm.id, name: 'Чоколадо', code: '77', type: 'goods', vatRate: 18, price: '50' }).returning();
    const p = (no: string, date: string, sp: number) => pur({ number: no, date, ptype: 'stock', warehouseId: st!.id, groups: [{ account: '6600', rate: 18, base: 400, vat: 72 }], stock: [{ itemId: it!.id, qty: 10, price: 40, sp }] });
    const nivs = () => db.select().from(schema.levellingDocs).where(eq(schema.levellingDocs.locationId, st!.id));
    await tx((t) => savePurchase(t, firm.id, p('ST-1', '2026-04-01', 100), office));
    const r = await tx((t) => savePurchase(t, firm.id, p('ST-2', '2026-04-10', 120), klient));
    expect(r.status).toBe('pending');
    expect(await nivs()).toHaveLength(0);
    await tx((t) => approvePurchase(t, firm.id, r.id, office));
    const L = await nivs();
    expect(L).toHaveLength(1);
    expect(L[0]!.lines).toMatchObject([{ itemId: it!.id, qty: 10, old: 100, new: 120 }]);
    expect((await db.select().from(schema.items).where(eq(schema.items.id, it!.id)))[0]!.data).toMatchObject({ sp: { [st!.id]: 120 } });
  });
});

describe('the check list (saveSelectedScanDrafts)', () => {
  it('moves a late expense into the open VAT period; goods on stock keep their date', async () => {
    const base = { due: '', partnerId: sup, supplierName: 'Добавувач', supplierEdb: '4030999000111', art32: false, cash: false, warehouseId: null, shifted: false, credit: false };
    const cost = { ...base, number: 'LATE-C', date: '2025-02-10', docDate: '2025-02-10', ptype: 'cost', groups: [{ konto: '4000', rate: 18, base: 100, vat: 18 }], stock: [] };
    const stock = { ...base, number: 'LATE-S', date: '2025-02-11', docDate: '2025-02-11', ptype: 'stock', groups: [{ konto: '6600', rate: 18, base: 200, vat: 36 }],
      stock: [{ itemId: goods, name: 'Шраф', code: '', barcode: '', qty: 2, price: 100, amount: 200 }] };
    const [d] = await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind: 'purchase', status: 'done', drafts: [cost, stock].map((draft) => ({ draft, status: 'ok' as const, msg: '' })) as never }).returning();
    const r = await tx((t) => saveSelectedScanDrafts(t, { firmId: firm.id, kind: 'purchase', ids: [d!.id + ':0', d!.id + ':1'], actor: office }));
    expect(r.failed).toEqual([]);
    const P = await db.select().from(schema.purchases).where(and(eq(schema.purchases.firmId, firm.id), sql`${schema.purchases.number} like 'LATE-%'`));
    const c = P.find((x) => x.number === 'LATE-C')!, s = P.find((x) => x.number === 'LATE-S')!;
    expect(c.date > '2025-02-10').toBe(true);
    expect(c.docDate).toBe('2025-02-10');
    expect(s.date).toBe('2025-02-11');
  });
});

describe('read sales: duplicate numbers in the invoice\'s own year', () => {
  it('a number taken in 2025 is a duplicate for a 2025 read, not for a 2026 one', async () => {
    await tx((t) => saveInvoice(t, firm.id, inv({ date: '2025-05-01', number: '77' }), office));
    const x = (date: string) => ({ number: '77', date, buyerName: 'Купувач', total: 236, lines: [{ name: 'Шраф', qty: 1, price: 200, amount: 200, rate: 18 }], groups: [{ rate: 18, base: 200, vat: 36 }] });
    const [a, b] = await saleDrafts(db as never, firm, { invoices: [x('2025-06-01'), x('2026-06-01')] } as never);
    expect(a!.msg).toMatch(/77 веќе постои/);
    expect(b!.msg).not.toMatch(/77 веќе постои|двапати/);
  });
});

describe('VAT marks', () => {
  it('are refused for a firm that is not a VAT payer', async () => {
    const [f3] = await db.insert(schema.firms).values({ name: 'Без ДДВ ДООЕЛ', edb: '4030000000888', vatRegistered: false }).returning();
    expect((await err(tx((t) => markInvoicesVat(t, f3!.id, [], 'ded', office)))).message).toMatch(/не е ДДВ обврзник/);
  });
});
