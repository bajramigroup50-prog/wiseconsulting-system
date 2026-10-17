/** Numbered posting schemes „Шема 1, 2 …“: per-document choice, partner default, bulk re-post, validation, copy. */
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { vatBookIn, vatBookOut } from '@wise/core';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { saveInvoice } from './sales/invoices';
import { savePurchase } from './sales/purchases';
import type { DocActor } from './sales/context';
import { copySchemeProfile, deleteSchemeProfile, repostWithScheme, saveSchemeProfile } from './scheme-profiles';
import { computeVatPeriod } from './vat-service';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const tx = <T>(f: (t: DB) => Promise<T>) => db.transaction((t) => f(t as unknown as DB));
const office: DocActor = { userId: null, role: 'acc' };
let firmId = '', otherId = '', buyer = '', buyer2 = '', supplier = '', svc = '';

const linesOf = async (sourceType: string, sourceId: string) => (await db.select({ a: schema.journalLines.account, d: schema.journalLines.debit, c: schema.journalLines.credit, m: schema.journals.meta })
  .from(schema.journalLines).innerJoin(schema.journals, eq(schema.journals.id, schema.journalLines.journalId))
  .where(and(eq(schema.journals.sourceType, sourceType), eq(schema.journals.sourceId, sourceId))).orderBy(asc(schema.journalLines.lineNo)))
  .map((l) => ({ a: l.a, d: Number(l.d), c: Number(l.c), scheme: (l.m as { scheme?: number }).scheme }));
const journalOf = async (sourceId: string) => (await db.select().from(schema.journals).where(eq(schema.journals.sourceId, sourceId)).limit(1))[0]!;
const firm = async () => (await db.select().from(schema.firms).where(eq(schema.firms.id, firmId)).limit(1))[0]!;
const service = (price = 1000) => ({ itemId: svc, name: 'Консултантска услуга', qty: 1, price, rate: 18 });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f, o] = await db.insert(schema.firms).values([{ name: 'Шеми ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }, { name: 'Друга ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }]).returning();
  firmId = f!.id; otherId = o!.id;
  const P = await db.insert(schema.partners).values([{ firmId, name: 'Купувач', code: '1' }, { firmId, name: 'Купувач 2', code: '2', data: { scheme: 2 } }, { firmId, name: 'Добавувач', code: '3' }]).returning();
  [buyer, buyer2, supplier] = P.map((p) => p.id) as [string, string, string];
  const [it] = await db.insert(schema.items).values({ firmId, code: 'U1', name: 'Консултантска услуга', type: 'service', vatRate: 18, price: '1000' }).returning();
  svc = it!.id;
});

describe('Шема N — saving and validation', () => {
  it('refuses invalid kontos, summary VAT kontos and kontos outside the chart', async () => {
    await expect(tx((t) => saveSchemeProfile(t, firmId, { name: 'Лоша', sch: { revService_18: 'abc' } }, { userId: null }))).rejects.toThrow(/не е конто/);
    await expect(tx((t) => saveSchemeProfile(t, firmId, { name: 'Лоша', vatOut: { 18: '2300' } }, { userId: null }))).rejects.toThrow(/збирното конто 2300/);
    await expect(tx((t) => saveSchemeProfile(t, firmId, { name: 'Лоша', sch: { r32in: '1300' } }, { userId: null }))).rejects.toThrow(/збирното конто 1300/);
    await expect(tx((t) => saveSchemeProfile(t, firmId, { name: 'Лоша', sch: { revService_18: '7999999' } }, { userId: null }))).rejects.toThrow(/не постои во контниот план/);
    await expect(tx((t) => saveSchemeProfile(t, firmId, { name: '', sch: { revService_18: '7414' } }, { userId: null }))).rejects.toThrow(/назив/);
    expect(((await firm()).settings as { schemeProfiles?: unknown[] }).schemeProfiles ?? []).toEqual([]);
  });
  it('saves Шема 2 with only the changed keys; the method flags and unknown keys are not stored', async () => {
    const p = await tx((t) => saveSchemeProfile(t, firmId, { name: 'Услуги во земјата', sch: { revService_18: '7414', revGoods: '', retailMethod: 'true', bogus: '1' } }, { userId: null }));
    expect(p).toMatchObject({ no: 2, name: 'Услуги во земјата', sch: { revService_18: '7414' } });
    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'schProfileSave'));
    expect(a).toHaveLength(1);
  });
});

describe('posting with a chosen scheme', () => {
  let inv1 = '', inv2 = '';
  it('Шема 2 (revService_18 → 7414) posts the service to 7414, Шема 1 still to 740018; the rest is identical', async () => {
    inv1 = (await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-05-10', partnerId: buyer, lines: [service()] }, office))).id;
    inv2 = (await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-05-10', partnerId: buyer, lines: [service()], data: { scheme: 2 } }, office))).id;
    const L1 = await linesOf('invoice', inv1), L2 = await linesOf('invoice', inv2);
    expect(L1.find((l) => l.c === 1000)?.a).toBe('740018');
    expect(L2.find((l) => l.c === 1000)?.a).toBe('7414');
    // same lines except the overridden konto
    expect(L2.map((l) => ({ ...l, a: l.a === '7414' ? '740018' : l.a, scheme: undefined }))).toEqual(L1.map((l) => ({ ...l, scheme: undefined })));
    expect(L2[0]!.scheme).toBe(2);
    expect(L1[0]!.scheme).toBeUndefined();
  });
  it('the partner card default applies when the document does not choose; an explicit Шема 1 wins', async () => {
    const a = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-05-11', partnerId: buyer2, lines: [service()] }, office));
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, a.id));
    expect(row!.data.scheme).toBe(2);
    expect((await linesOf('invoice', a.id)).some((l) => l.a === '7414')).toBe(true);
    const b = await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-05-11', partnerId: buyer2, lines: [service()], data: { scheme: 1 } as never }, office));
    expect((await linesOf('invoice', b.id)).some((l) => l.a === '740018')).toBe(true);
    await expect(tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-05-11', partnerId: buyer, lines: [service()], data: { scheme: 7 } }, office))).rejects.toThrow(/Шема 7 не постои/);
  });
  it('a purchase with Шема 3 (purDefault, supplier) posts the overridden kontos only', async () => {
    await tx((t) => saveSchemeProfile(t, firmId, { name: 'Добавувачи', sch: { purDefault: '4010', supplier: '2210' } }, { userId: null }));
    const p1 = await tx((t) => savePurchase(t, firmId, { number: 'D-1', date: '2026-05-12', partnerId: supplier, ptype: 'cost', groups: [{ rate: 18, base: 1000, vat: 180 }] }, office));
    const p3 = await tx((t) => savePurchase(t, firmId, { number: 'D-3', date: '2026-05-12', partnerId: supplier, ptype: 'cost', groups: [{ rate: 18, base: 1000, vat: 180 }], data: { scheme: 3 } }, office));
    const A1 = (await linesOf('purchase', p1.id)).map((l) => l.a), A3 = (await linesOf('purchase', p3.id)).map((l) => l.a);
    expect(A1).toEqual(expect.arrayContaining(['4000', '130018', '2200']));
    expect(A3).toEqual(A1.map((a) => (a === '4000' ? '4010' : a === '2200' ? '2210' : a)));
  });
});

describe('bulk „Прекнижи ги избраните со Шема N“', () => {
  it('re-posts only open-period documents; totals and the VAT books are unchanged; audited with before/after', async () => {
    const jan = (await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-01-15', partnerId: buyer, lines: [service(500)] }, office))).id;
    const jun = (await tx((t) => saveInvoice(t, firmId, { kind: 'invoice', date: '2026-06-15', partnerId: buyer, lines: [service(700)] }, office))).id;
    const f0 = await firm();
    const vat0 = await tx((t) => computeVatPeriod(t, f0, '2026-Т2'));
    await db.update(schema.firms).set({ lockDate: '2026-03-31' }).where(eq(schema.firms.id, firmId));
    const jJan = await journalOf(jan), jJun = await journalOf(jun);
    const before = { jan: await linesOf('invoice', jan), jun: await linesOf('invoice', jun) };
    const R = await tx((t) => repostWithScheme(t, firmId, [jJan.id, jJun.id], 2, null));
    expect(R.n).toBe(1);
    expect(R.skipped).toEqual([expect.objectContaining({ journalId: jJan.id, reason: expect.stringMatching(/заклучен/) })]);
    expect(R.diffs).toEqual([
      { konto: '740018', d0: 0, c0: 700, d1: 0, c1: 0 },
      { konto: '7414', d0: 0, c0: 0, d1: 0, c1: 700 },
    ]);
    // the locked January invoice is untouched (lines and its document's scheme)
    expect(await linesOf('invoice', jan)).toEqual(before.jan);
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, jan)))[0]!.data.scheme).toBeUndefined();
    // June: same totals, same journal (id / number), only the revenue konto moved
    const after = await linesOf('invoice', jun);
    const sum = (L: typeof after) => [L.reduce((s, l) => s + l.d, 0), L.reduce((s, l) => s + l.c, 0)];
    expect(sum(after)).toEqual(sum(before.jun));
    expect((await journalOf(jun))).toMatchObject({ id: jJun.id, number: jJun.number });
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, jun)))[0]!.data.scheme).toBe(2);
    // VAT: ДДВ-04 and the books are computed from the documents → unchanged
    const f1 = await firm();
    const vat1 = await tx((t) => computeVatPeriod(t, f1, '2026-Т2'));
    expect(vat1.fields).toEqual(vat0.fields);
    expect(vatBookOut(vat1.data.docs, vat1.from, vat1.to, vat1.ctx)).toEqual(vatBookOut(vat0.data.docs, vat0.from, vat0.to, vat0.ctx));
    expect(vatBookIn(vat1.data.docs, vat1.from, vat1.to, vat1.ctx)).toEqual(vatBookIn(vat0.data.docs, vat0.from, vat0.to, vat0.ctx));
    expect(vat1.close.lines).toEqual(vat0.close.lines);
    const a = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'schemeRepost'));
    expect(a.at(-1)!.data).toMatchObject({ scheme: 2, n: 1, skipped: 1 });
    // back to Шема 1
    const B = await tx((t) => repostWithScheme(t, firmId, [jJun.id], 1, null));
    expect(B.n).toBe(1);
    expect((await linesOf('invoice', jun)).map((l) => l.a)).toEqual(before.jun.map((l) => l.a));
    await db.update(schema.firms).set({ lockDate: null }).where(eq(schema.firms.id, firmId));
  });
});

describe('delete and copy', () => {
  it('a scheme in use cannot be deleted', async () => {
    await expect(tx((t) => deleteSchemeProfile(t, firmId, 2, null))).rejects.toThrow(/се користи/);
  });
  it('copies to another firm (same number when free); a target without the konto is skipped', async () => {
    const R = await tx((t) => copySchemeProfile(t, firmId, 2, [otherId], { userId: null }));
    expect(R.copied).toEqual([expect.objectContaining({ firmId: otherId, no: 2 })]);
    // hide 7414 in the other firm's chart → the next copy is skipped there
    await db.insert(schema.accounts).values({ firmId: otherId, code: '7414', name: 'Услуги во земјата', hidden: true });
    const S = await tx((t) => copySchemeProfile(t, firmId, 2, [otherId], { userId: null }));
    expect(S.copied).toEqual([]);
    expect(S.skipped[0]!.reason).toMatch(/7414/);
  });
  it('an unused scheme is deleted', async () => {
    const p = await tx((t) => saveSchemeProfile(t, firmId, { name: 'Привремена', sch: { revGoods_18: '7414' } }, { userId: null }));
    expect(await tx((t) => deleteSchemeProfile(t, firmId, p.no, null))).toBe('Привремена');
  });
});
