/**
 * A read (скенирана) invoice whose saved purchase / outgoing invoice was deleted (with its nalog, or on its own) is no
 * longer „зачувано“: its draft is saved again from the stored read (no new AI read), with its own number; a cancelled
 * (сторно) invoice and a merged calculation stay saved; duplicates are still refused. Drafts saved before the delete
 * released them (a dangling `savedId`) are released when the list is shown / before a bulk save. Synthetic data only.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import type { Tx } from './audit';
import type { DocActor } from './sales/context';
import { deleteInvoice, saveInvoice } from './sales/invoices';
import { deletePurchase, savePurchase, type PurchaseInput } from './sales/purchases';
import { releaseDeletedScanDrafts } from './sales/ai-docs';
import { saveReadyScanDrafts } from './sales/scan-save';
import { deleteNalogParts } from './nalog-delete';
import { mergePurchases } from './parity-retail';

const db = drizzle(new PGlite(), { schema });
const T = db as unknown as Tx;
const tx = <R>(f: (t: Tx) => Promise<R>) => db.transaction((t) => f(t as unknown as Tx));
const office: DocActor = { userId: null, role: 'acc' };
let firm: schema.Firm, sup = '', cust = '';

const purDraft = (number: string, date: string, base = 1000) => ({
  number, date, docDate: date, due: '', partnerId: sup, supplierName: 'Добавувач Тест ДОО', supplierEdb: '4030000000022',
  art32: false, ptype: 'cost', cash: false, warehouseId: null, groups: [{ konto: '4000', rate: 18, base, vat: base * 0.18 }], stock: [], shifted: false, credit: false,
});
const saleDraft = (number: string, date: string) => ({
  number, date, due: '', partnerId: cust, art32: false, buyer: { name: 'Купувач Тест ДООЕЛ', edb: '', address: '', city: '' },
  items: [{ itemId: '', name: 'Услуга', unit: 'ком', qty: 1, price: 1000, disc: 0, rate: 18, konto: '' }], total: 1180,
});
async function readDoc(kind: 'purchase' | 'sale', drafts: Record<string, unknown>[]) {
  const [d] = await db.insert(schema.aiDocuments).values({ firmId: firm.id, kind, status: 'done', drafts: drafts.map((draft) => ({ draft, status: 'ok' as const, msg: '' })) }).returning();
  return d!;
}
const load = async (id: string) => (await db.select().from(schema.aiDocuments).where(eq(schema.aiDocuments.id, id)))[0]!;
const bulk = (kind: 'purchase' | 'sale', id: string) => saveReadyScanDrafts(T, { firm, kind, where: eq(schema.aiDocuments.id, id), actor: office, past: null });
const purNumbers = async () => (await db.select({ n: schema.purchases.number }).from(schema.purchases).where(eq(schema.purchases.firmId, firm.id))).map((x) => x.n).sort();
const invRows = async () => db.select().from(schema.invoices).where(eq(schema.invoices.firmId, firm.id));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'ИЗБРИШАНИ СКЕНОВИ ТЕСТ ДООЕЛ', vatRegistered: false }).returning() as [schema.Firm];
  const P = await db.insert(schema.partners).values([
    { firmId: firm.id, name: 'Добавувач Тест ДОО', edb: '4030000000022', code: '1' },
    { firmId: firm.id, name: 'Купувач Тест ДООЕЛ', edb: '4030000000011', code: '2' },
  ]).returning();
  sup = P[0]!.id; cust = P[1]!.id;
}, 120_000);

describe('incoming invoices (purchases)', () => {
  it('deleted with its nalog: the draft can be saved again and the bulk save re-creates it with the same number', async () => {
    const d = await readDoc('purchase', [purDraft('ВФ-101', '2026-10-01'), purDraft('ВФ-102', '2026-10-02', 2000)]);
    expect(await bulk('purchase', d.id)).toMatchObject({ saved: 2, total: 2, errs: [] });
    const s = await load(d.id);
    expect(s.status).toBe('saved');
    const [id0, id1] = s.drafts.map((x) => x.savedId!);
    const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'purchase'), eq(schema.journals.sourceId, id0!)));
    // the nalog holds both purchases: deleting only the first one of it
    await tx((t) => deleteNalogParts(t, { firmId: firm.id, actor: office, no: j!.number, year: 2026, journalIds: [j!.id] }));
    const r = await load(d.id);
    expect(r.status).toBe('done');
    expect(r.drafts[0]!.savedId).toBeUndefined();
    expect(r.drafts[0]!.deleted).toBeTruthy();
    expect(r.drafts[0]!.status).toBe('ok');
    expect(r.drafts[1]!.savedId).toBe(id1);
    expect(await bulk('purchase', d.id)).toMatchObject({ saved: 1, total: 1, errs: [] });
    const a = await load(d.id);
    expect(a.status).toBe('saved');
    expect(a.drafts[0]!.savedId).toBeTruthy();
    expect(a.drafts[0]!.savedId).not.toBe(id0);
    expect(a.drafts[0]!.deleted).toBeUndefined();
    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.id, a.drafts[0]!.savedId!));
    expect(p).toMatchObject({ number: 'ВФ-101', date: '2026-10-01' });
    expect((await purNumbers()).filter((n) => n === 'ВФ-101')).toHaveLength(1);
  });

  it('a dangling savedId (deleted before this fix) is released; the duplicate check still refuses an existing invoice', async () => {
    const d = await readDoc('purchase', [purDraft('ВФ-201', '2026-10-03')]);
    await bulk('purchase', d.id);
    const old = (await load(d.id)).drafts[0]!.savedId!;
    await tx((t) => deletePurchase(t, firm.id, old, office));
    // the old behaviour: the draft still points to the deleted purchase and the read is „зачувано“
    await db.update(schema.aiDocuments).set({ status: 'saved', drafts: [{ draft: purDraft('ВФ-201', '2026-10-03'), status: 'ok', msg: '', savedId: old }] }).where(eq(schema.aiDocuments.id, d.id));
    expect(await bulk('purchase', d.id)).toMatchObject({ saved: 1, errs: [] });
    expect((await purNumbers()).filter((n) => n === 'ВФ-201')).toHaveLength(1);

    // released again while the same invoice was entered by hand meanwhile: not saved twice
    const d2 = await readDoc('purchase', [purDraft('ВФ-202', '2026-10-04')]);
    await bulk('purchase', d2.id);
    const id2 = (await load(d2.id)).drafts[0]!.savedId!;
    await tx((t) => deletePurchase(t, firm.id, id2, office));
    await tx((t) => savePurchase(t, firm.id, { number: 'ВФ-202', date: '2026-10-04', docDate: '2026-10-04', partnerId: sup, supplierEdb: '4030000000022', ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 1000, vat: 180 }] } as unknown as PurchaseInput, office));
    const R = await bulk('purchase', d2.id);
    expect(R.saved).toBe(0);
    expect(R.errs[0]).toMatch(/веќе е внесена/);
    expect((await purNumbers()).filter((n) => n === 'ВФ-202')).toHaveLength(1);
  });

  it('merged calculations: the drafts point to the merged one and stay saved', async () => {
    const d = await readDoc('purchase', [purDraft('ВФ-301', '2026-10-05'), purDraft('ВФ-302', '2026-10-06', 500)]);
    await bulk('purchase', d.id);
    const ids = (await load(d.id)).drafts.map((x) => x.savedId!);
    const m = await tx((t) => mergePurchases(t, firm.id, ids, office));
    const a = await load(d.id);
    expect(a.status).toBe('saved');
    expect(a.drafts.map((x) => x.savedId)).toEqual([m.id, m.id]);
    expect(await releaseDeletedScanDrafts(T, firm.id)).toBe(0);
  });
});

describe('outgoing invoices (sales)', () => {
  it('a deleted invoice is saved again with its ORIGINAL number; a cancelled (сторно) one stays saved', async () => {
    const d = await readDoc('sale', [saleDraft('ИФ-1/26', '2026-10-01'), saleDraft('ИФ-2/26', '2026-10-02'), saleDraft('ИФ-3/26', '2026-10-03')]);
    expect(await bulk('sale', d.id)).toMatchObject({ saved: 3, total: 3, errs: [] });
    const ids = (await load(d.id)).drafts.map((x) => x.savedId!);
    // the last number is deleted; an earlier one is cancelled (retention lock), its row and number stay
    expect(await tx((t) => deleteInvoice(t, firm.id, ids[2]!, office))).toEqual({ cancelled: false });
    expect(await tx((t) => deleteInvoice(t, firm.id, ids[0]!, office))).toEqual({ cancelled: true });
    const r = await load(d.id);
    expect(r.status).toBe('done');
    expect(r.drafts[0]!.savedId).toBe(ids[0]);
    expect(r.drafts[1]!.savedId).toBe(ids[1]);
    expect(r.drafts[2]!.savedId).toBeUndefined();
    expect(r.drafts[2]!.deleted).toBeTruthy();
    // a new invoice issued meanwhile took the next free number: the read one still keeps its own
    await tx((t) => saveInvoice(t, firm.id, { kind: 'invoice', number: 'ИФ-4/26', date: '2026-10-04', partnerId: cust, lines: [{ name: 'Услуга', qty: 1, price: 50, rate: 18 }] }, office));
    expect(await bulk('sale', d.id)).toMatchObject({ saved: 1, total: 1, errs: [] });
    const a = await load(d.id);
    expect(a.status).toBe('saved');
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, a.drafts[2]!.savedId!));
    expect(inv).toMatchObject({ number: 'ИФ-3/26', date: '2026-10-03', scanned: true });
    expect((await invRows()).filter((x) => x.number === 'ИФ-3/26')).toHaveLength(1);
  });

  it('a dangling savedId is released; an invoice with the same number already there is never entered again', async () => {
    const d = await readDoc('sale', [saleDraft('ИФ-9/26', '2026-10-09')]);
    await bulk('sale', d.id);
    const old = (await load(d.id)).drafts[0]!.savedId!;
    await tx((t) => deleteInvoice(t, firm.id, old, office));
    await db.update(schema.aiDocuments).set({ status: 'saved', drafts: [{ draft: saleDraft('ИФ-9/26', '2026-10-09'), status: 'ok', msg: '', savedId: old }] }).where(eq(schema.aiDocuments.id, d.id));
    expect(await releaseDeletedScanDrafts(T, firm.id, ['sale'])).toBe(1);
    expect((await load(d.id)).status).toBe('done');
    // the same invoice typed in by hand meanwhile
    await tx((t) => saveInvoice(t, firm.id, { kind: 'invoice', number: 'ИФ-9/26', date: '2026-10-09', partnerId: cust, lines: [{ name: 'Услуга', qty: 1, price: 1000, rate: 18 }] }, office));
    const R = await bulk('sale', d.id);
    expect(R.saved).toBe(0);
    expect(R.errs[0]).toMatch(/ИФ-9\/26 веќе постои/);
    expect((await invRows()).filter((x) => x.number === 'ИФ-9/26')).toHaveLength(1);
  });
});
