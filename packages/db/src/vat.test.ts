import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { vatBookIn, vatBookOut, type InvoiceDoc, type PurchaseDoc } from '@wise/core';
import { deleteJournal, postJournal, PostingError, unpostSource, type PostJournalInput } from './posting';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { vatPostingContext } from './vat-context';
import { assertVatPeriodOpen } from './vat-lock';
import {
  closeVatPeriod, computeVatPeriod, normalizeVatPeriod, reopenVatPeriod, saveVatCorrections, vatPeriodKindOf, vatYearOverview,
} from './vat-service';
import { fixtureVatSource, ledgerVatSource, VAT_CLOSE_SOURCE } from './vat-source';

const db = drizzle(new PGlite(), { schema });
let firmId = '';
let cust = '';
let sup = '';
let firm: schema.Firm;

const post = (i: Partial<PostJournalInput> & Pick<PostJournalInput, 'lines'>) =>
  db.transaction((tx) => postJournal(tx, { firmId, date: '2026-02-10', kind: 'manual', userId: null, ...i }));
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as PostingError; } throw new Error('expected an error'); };
const reload = async () => { [firm] = (await db.select().from(schema.firms).where(eq(schema.firms.id, firmId))) as [schema.Firm]; return firm; };

/** Invoice 1000 + 18% (D 1200 / P 7400 / P 230018), purchase 500 + 18% (D 4400 / D 130018 / P 2200), credit note 100 + 18%. */
async function postQ1Documents() {
  await post({ date: '2026-01-15', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-1', description: 'Фактура 1', lines: [
    { account: '1200', debit: 1180, partnerId: cust }, { account: '7400', credit: 1000 }, { account: '230018', credit: 180 },
  ] });
  await post({ date: '2026-02-03', kind: 'vlez', sourceType: 'purchase', sourceId: 'pur-1', description: 'Влезна 7', lines: [
    { account: '4400', debit: 500 }, { account: '130018', debit: 90 }, { account: '2200', credit: 590, partnerId: sup },
  ] });
  await post({ date: '2026-03-20', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-2', description: 'Одобрение 2', lines: [
    { account: '1200', credit: 118, partnerId: cust }, { account: '7400', debit: 100 }, { account: '230018', debit: 18 },
  ] });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'ДДВ Тест ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter' }).returning();
  firmId = f!.id;
  firm = f!;
  const [c] = await db.insert(schema.partners).values({ firmId, name: 'Купувач ДООЕЛ', edb: 'MK4000000000001', code: '1' }).returning();
  const [s] = await db.insert(schema.partners).values({ firmId, name: 'Добавувач ДОО', edb: 'MK4000000000002', code: '2' }).returning();
  cust = c!.id;
  sup = s!.id;
  await postQ1Documents();
}, 60_000);

describe('period ids', () => {
  it('recognises month / quarter ids and normalises a Latin T', () => {
    expect(vatPeriodKindOf('2026-03')).toBe('month');
    expect(vatPeriodKindOf('2026-Т2')).toBe('quarter');
    expect(vatPeriodKindOf('2026-13')).toBeNull();
    expect(normalizeVatPeriod('2026-T3')).toBe('2026-Т3');
    expect(normalizeVatPeriod('x')).toBeNull();
  });
});

describe('ledger VAT source', () => {
  it('rebuilds documents from the VAT kontos and feeds ДДВ-04', async () => {
    const C = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т1', ledgerVatSource));
    expect(C.data.origin).toBe('ledger');
    expect(C.data.docs.invoices).toHaveLength(2);
    expect(C.data.docs.invoices!.find((i) => i.credit)).toMatchObject({ partner: cust, items: [{ price: 100, rate: 18 }] });
    expect(C.data.docs.purchases).toEqual([expect.objectContaining({ partner: sup, groups: [{ rate: 18, base: 500, vat: 0.9 * 100 }] })]);
    expect(C.fields).toMatchObject({ '01': 900, '02': 162, '21': 500, '22': 90, '20': 162, '29': 90, '31': 72 });
    expect(C.close).toEqual({
      diff: 72,
      lines: [
        { account: '230018', debit: 162, credit: 0, note: 'Затворање на обврска за ДДВ' },
        { account: '130018', debit: 0, credit: 90, note: 'Затворање на претходен ДДВ' },
        { account: '23008', debit: 0, credit: 72, note: 'Обврска за плаќање ДДВ' },
      ],
    });
    // Books from the same documents: partner names resolved.
    const out = vatBookOut(C.data.docs, C.from, C.to, C.ctx, { partners: C.data.partners });
    expect(out.map((r) => [r.name, r.b18, r.v18])).toEqual([['Купувач ДООЕЛ', 1000, 180], ['Купувач ДООЕЛ', -100, -18]]);
    const inn = vatBookIn(C.data.docs, C.from, C.to, C.ctx, { partners: C.data.partners });
    expect(inn.map((r) => [r.name, r.edb, r.b18, r.v18])).toEqual([['Добавувач ДОО', 'MK4000000000002', 500, 90]]);
  });

  it('matches the fixture source built from the equivalent documents', async () => {
    const invoices: InvoiceDoc[] = [
      { date: '2026-01-15', number: '1', partner: cust, items: [{ qty: 2, price: 500, rate: 18 }] },
      { date: '2026-03-20', number: '2', partner: cust, credit: true, items: [{ qty: 1, price: 100, rate: 18 }] },
    ];
    const purchases: PurchaseDoc[] = [{ date: '2026-02-03', number: '7', partner: sup, groups: [{ rate: 18, base: 500, vat: 90 }] }];
    const src = fixtureVatSource({ docs: { invoices, purchases } });
    const A = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т1', src));
    const B = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т1', ledgerVatSource));
    expect(A.data.origin).toBe('fixture');
    expect(A.fields).toEqual(B.fields);
    // The fixture filters by date.
    const Q2 = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т2', src));
    expect(Q2.fields['01']).toBe(0);
  });

  it('maps import and art. 32-a kontos', async () => {
    const ctx = vatPostingContext(firm);
    await post({ date: '2026-04-05', kind: 'vlez', sourceType: 'purchase', sourceId: 'imp-1', lines: [
      { account: '13001811', debit: 36 }, { account: '1309', debit: 18 }, { account: '2309', credit: 18 }, { account: '2200', credit: 36, partnerId: sup },
    ] });
    const d = await db.transaction((tx) => ledgerVatSource.load(tx, firm, '2026-04-01', '2026-04-30', ctx));
    expect(d.docs.purchases?.map((p) => [p.imp ?? false, p.art32 ?? false])).toEqual([[true, false], [false, true]]);
    const C = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т2', ledgerVatSource));
    expect(C.fields).toMatchObject({ '16': 100, '17': 18, '20': 18, '26': 18, '27': 200, '28': 36, '29': 54, '31': -36 });
    await db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'purchase', sourceId: 'imp-1', userId: null }));
  });
});

describe('close / lock / reopen', () => {
  it('closes Q1: posts the VAT-close journal, freezes ДДВ-04, audits', async () => {
    const r = await db.transaction((tx) => closeVatPeriod(tx, { firmId, period: '2026-Т1', userId: null, source: ledgerVatSource }));
    expect(r.journal).toMatchObject({ number: '4/1-3', replaced: false });
    expect(r.row).toMatchObject({ status: 'closed', periodKind: 'quarter', dateFrom: '2026-01-01', dateTo: '2026-03-31', closingJournalId: r.journal!.id });
    expect(r.row.ddv04).toMatchObject({ origin: 'ledger', closeDiff: 72, fields: { '31': 72 } });
    const [j] = await db.select().from(schema.journals).where(eq(schema.journals.id, r.journal!.id));
    expect(j).toMatchObject({ kind: 'ddv', date: '2026-03-31', sourceType: VAT_CLOSE_SOURCE, sourceId: r.row.id });
    const acts = (await db.select().from(schema.auditLog).where(eq(schema.auditLog.firmId, firmId))).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['ddvPost', 'ddvClose']));
    // The close journal itself does not feed the next computation.
    const C = await db.transaction((tx) => computeVatPeriod(tx, firm, '2026-Т1', ledgerVatSource));
    expect(C.close.lines).toHaveLength(3);
    expect((await err(db.transaction((tx) => closeVatPeriod(tx, { firmId, period: '2026-Т1', userId: null, source: ledgerVatSource })))).message).toMatch(/веќе затворен/);
  });

  it('blocks VAT documents and VAT-konto journals in the closed period, nothing else', async () => {
    expect((await err(post({ date: '2026-02-01', lines: [{ account: '1200', debit: 118, partnerId: cust }, { account: '7400', credit: 100 }, { account: '230018', credit: 18 }] }))).code).toBe('vat_closed');
    // 0% invoice without a VAT line is still a VAT document (field 08).
    expect((await err(post({ date: '2026-02-01', sourceType: 'invoice', sourceId: 'inv-0', lines: [{ account: '1200', debit: 50, partnerId: cust }, { account: '7400', credit: 50 }] }))).code).toBe('vat_closed');
    // Changing or removing existing VAT documents is blocked too.
    expect((await err(db.transaction((tx) => unpostSource(tx, { firmId, sourceType: 'invoice', sourceId: 'inv-1', userId: null })))).code).toBe('vat_closed');
    expect((await err(post({ date: '2026-04-02', kind: 'izlez', sourceType: 'invoice', sourceId: 'inv-2', lines: [{ account: '1200', debit: 1, partnerId: cust }, { account: '7400', credit: 1 }] }))).code).toBe('vat_closed');
    // Moving a document *into* the closed period is blocked as well.
    await post({ date: '2026-04-10', sourceType: 'invoice', sourceId: 'inv-3', lines: [{ account: '1200', debit: 10, partnerId: cust }, { account: '7400', credit: 10 }] });
    expect((await err(post({ date: '2026-03-10', sourceType: 'invoice', sourceId: 'inv-3', lines: [{ account: '1200', debit: 10, partnerId: cust }, { account: '7400', credit: 10 }] }))).code).toBe('vat_closed');
    // Non-VAT manual journals and later dates are fine.
    const ok = await post({ date: '2026-02-01', lines: [{ account: '4400', debit: 5 }, { account: '1000', credit: 5 }] });
    await db.transaction((tx) => deleteJournal(tx, { firmId, journalId: ok.id, userId: null }));
    await post({ date: '2026-04-01', lines: [{ account: '1200', debit: 118, partnerId: cust }, { account: '7400', credit: 100 }, { account: '230018', credit: 18 }] });
    // A deleted manual VAT journal inside the period is blocked through its stored lines.
    const [vj] = await db.select().from(schema.journals).where(and(eq(schema.journals.firmId, firmId), eq(schema.journals.sourceId, 'inv-1')));
    expect((await err(db.transaction((tx) => deleteJournal(tx, { firmId, journalId: vj!.id, userId: null })))).code).toBe('vat_closed');
    await expect(db.transaction((tx) => assertVatPeriodOpen(tx, firm, { date: '2026-03-31', sourceType: VAT_CLOSE_SOURCE, accounts: ['230018'] }))).resolves.toBeUndefined();
  });

  it('uses the stored range after a month ↔ quarter switch and rejects overlaps', async () => {
    await db.update(schema.firms).set({ vatPeriod: 'month' }).where(eq(schema.firms.id, firmId));
    await reload();
    expect((await err(post({ date: '2026-02-01', lines: [{ account: '130018', debit: 1 }, { account: '1000', credit: 1 }] }))).code).toBe('vat_closed');
    expect((await err(db.transaction((tx) => closeVatPeriod(tx, { firmId, period: '2026-02', userId: null, source: ledgerVatSource })))).message).toMatch(/преклопува.*2026-Т1/);
    expect((await err(db.transaction((tx) => closeVatPeriod(tx, { firmId, period: '2026-Т2', userId: null, source: ledgerVatSource })))).message).toMatch(/месечно/);
    const ov = await db.transaction((tx) => vatYearOverview(tx, firm, 2026, ledgerVatSource));
    expect(ov.periods.filter((p) => p.status === 'closed').map((p) => [p.period, p.fields['31']])).toEqual([['2026-Т1', 72]]);
    expect(ov.periods).toHaveLength(13);
    await db.update(schema.firms).set({ vatPeriod: 'quarter' }).where(eq(schema.firms.id, firmId));
    await reload();
  });

  it('reopens: removes the close journal, unlocks the period, keeps the snapshot', async () => {
    const r = await db.transaction((tx) => reopenVatPeriod(tx, { firmId, period: '2026-Т1', userId: null }));
    expect(r).toMatchObject({ status: 'open', closingJournalId: null });
    expect(r.ddv04?.fields['31']).toBe(72);
    expect(await db.select().from(schema.journals).where(eq(schema.journals.sourceType, VAT_CLOSE_SOURCE))).toHaveLength(0);
    const j = await post({ date: '2026-03-30', lines: [{ account: '4400', debit: 50 }, { account: '130018', debit: 9 }, { account: '2200', credit: 59, partnerId: sup }] });
    expect(j.number).toBeTruthy();
    expect((await err(db.transaction((tx) => reopenVatPeriod(tx, { firmId, period: '2026-Т1', userId: null })))).message).toMatch(/не е затворен/);
  });

  it('corrections (field 30) flow into field 31 and the filed snapshot', async () => {
    await db.transaction((tx) => saveVatCorrections(tx, { firmId, period: '2026-Т1', userId: null, corrections: { field30: 10, note: 'Исправка', amendmentNo: '1' } }));
    const ov = await db.transaction((tx) => vatYearOverview(tx, firm, 2026, ledgerVatSource));
    const q1 = ov.periods.find((p) => p.period === '2026-Т1')!;
    expect(q1.fields).toMatchObject({ '22': 99, '29': 99, '30': 10, '31': 162 - 99 - 10 });
    const r = await db.transaction((tx) => closeVatPeriod(tx, { firmId, period: '2026-Т1', userId: null, source: ledgerVatSource }));
    expect(r.row.corrections).toEqual({ field30: 10, note: 'Исправка', amendmentNo: '1' });
    expect(r.fields['31']).toBe(53);
    expect(r.diff).toBe(63);
    expect((await err(db.transaction((tx) => saveVatCorrections(tx, { firmId, period: '2026-Т1', userId: null, corrections: { field30: 1 } })))).message).toMatch(/затворен/);
  });

  it('refuses firms that are not VAT-registered', async () => {
    const [g] = await db.insert(schema.firms).values({ name: 'Не-ДДВ', vatRegistered: false }).returning();
    expect((await err(db.transaction((tx) => closeVatPeriod(tx, { firmId: g!.id, period: '2026-Т1', userId: null, source: ledgerVatSource })))).message).toMatch(/не е регистрирана/);
  });
});
