/**
 * ЗДДВ чл. 32-а (domestic reverse charge) on outgoing invoices — the case of a services firm whose invoices were read
 * by the scan as 0 % / exempt (field 08) instead of art. 32-a (field 11):
 * - a scan with the 32-а note → art32 lines at 18 % without VAT, D 1200 (customer32 empty) / P revenue, field 11 (not 08);
 * - a scan with an exemption note → rate 0 with the legal basis, field 08;
 * - 0 % sales exempt with the right to deduct (чл. 24, field 08) post the receivable on 1200009 (customerExempt default
 *   when the chart has it, as in the old program); the bulk „Означи како чл. 32-а“ moves invoices 08 → 11 and the
 *   receivable 1200009 → 1200, open periods only; a bank payment closes an invoice on 1200009;
 * - without 1200009 in the firm's chart the receivable stays on 1200;
 * - the ДДВ-04 annex („промет по членови“) lists the invoices of each field and sums to it.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { saleDraftFromScan, type ScanSaleDraft } from '@wise/core/sales';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';
import { markInvoicesVat, saveInvoice, type InvoiceInput } from './sales/invoices';
import type { DocActor } from './sales/context';
import { addManualLine, documentPayments, linkLine, saveBankAccount } from './bank/index';
import { closeVatPeriod, computeVatPeriod } from './vat-service';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (t: DB) => Promise<R>) => db.transaction((t) => f(t as unknown as DB));
const office: DocActor = { userId: null, role: 'acc' };
let firm: schema.Firm, firmId = '', cust = '', bankId = '', dedId = '';

/** The scan action's mapping of a read draft to the invoice input (apps/web skan `saleDraftToInvoice`). */
const fromDraft = (d: ScanSaleDraft): InvoiceInput => ({
  kind: 'invoice', number: d.number, date: d.date, partnerId: cust, art32: d.art32, scanned: true,
  lines: d.items.map((l) => ({ name: l.name, qty: l.qty, price: l.price, rate: l.rate, account: l.konto })),
  ...(d.vatNote && !d.art32 ? { data: { vatNote: d.vatNote, ...(d.vatExempt ? { vatExempt: d.vatExempt } : {}) } } : {}),
});
const draft = (o: Record<string, unknown>) => saleDraftFromScan({ buyerName: 'Купувач ДОО', lines: [{ name: 'Дезинсекција', qty: 1, price: 10000, amount: 10000, rate: 0 }], groups: [{ rate: 0, base: 10000, vat: 0 }], total: 10000, ...o },
  { partners: [], items: [], revKonto: '7400', today: '2026-07-01', nextNumber: '1/2026' });
const journalOf = async (id: string) => {
  const [j] = await db.select().from(schema.journals).where(and(eq(schema.journals.sourceType, 'invoice'), eq(schema.journals.sourceId, id)));
  return db.select().from(schema.journalLines).where(eq(schema.journalLines.journalId, j!.id));
};
const recv = async (id: string) => (await journalOf(id)).filter((l) => /^12/.test(l.account)).map((l) => [l.account, Number(l.debit)]);
const plain = (number: string, date: string, price: number): InvoiceInput => ({
  kind: 'invoice', number, date, partnerId: cust, lines: [{ name: 'Дератизација', qty: 1, price, rate: 0, account: '7400' }],
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  [firm] = await db.insert(schema.firms).values({ name: 'ТРУЛИ НОЛЕН НМ ДООЕЛ', edb: 'MK4030000000001', vatRegistered: true, vatPeriod: 'quarter' }).returning() as [schema.Firm];
  firmId = firm.id;
  cust = (await db.insert(schema.partners).values({ firmId, name: 'Купувач ДОО', edb: 'MK4030000000999', code: '1', vatRegistered: true }).returning())[0]!.id;
  bankId = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Стопанска', account: '200000000222222', cur: 'MKD', konto: '1000' } }));
}, 120_000);

describe('reading the VAT note', () => {
  it('the 32-а note gives art32 lines at 18 % with no VAT; posted D 1200 / P revenue; ДДВ-04 field 11, not 08', async () => {
    const d = draft({ number: 'CLK-202609-1176', date: '2026-07-20', vatNote: 'Пренесување на даночната обврска согласно член 32-а од ЗДДВ' });
    expect(d.art32).toBe(true);
    expect(d.items.map((l) => [l.rate, l.price])).toEqual([[18, 10000]]);
    expect(d.vatCheck).toBeUndefined();
    const r = await T((tx) => saveInvoice(tx, firmId, fromDraft(d), office));
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id));
    expect([inv!.art32, Number(inv!.vat), Number(inv!.total)]).toEqual([true, 0, 10000]);
    const L = await journalOf(r.id);
    expect(L.filter((l) => !l.account.startsWith('99')).map((l) => [l.account, Number(l.debit), Number(l.credit)]).sort()).toEqual([['1200', 10000, 0], ['7400', 0, 10000]].sort());
    const C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([C.fields['08'], C.fields['11'], C.fields['02']]).toEqual([0, 10000, 0]);
  });

  it('an exemption note чл. 23 (без право на одбивка) gives rate 0 with the legal basis, in field 09', async () => {
    const d = draft({ number: 'CLK-202608-1123', date: '2026-08-02', vatNote: 'Ослободено од ДДВ согласно член 23 од ЗДДВ' });
    expect([d.art32, d.items[0]!.rate, d.vatNote, d.vatExempt, d.vatCheck]).toEqual([false, 0, 'Ослободено од ДДВ согласно член 23 од ЗДДВ', 'noded', undefined]);
    const r = await T((tx) => saveInvoice(tx, firmId, fromDraft(d), office));
    expect(((await db.select().from(schema.invoices).where(eq(schema.invoices.id, r.id)))[0]!.data as { vatNote?: string }).vatNote).toBe('Ослободено од ДДВ согласно член 23 од ЗДДВ');
    expect(await recv(r.id)).toEqual([['1200', 10000]]);
    const C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([C.fields['08'], C.fields['09'], C.fields['11']]).toEqual([0, 10000, 10000]);
    const s09 = C.annex.find((a) => a.field === '09')!;
    expect(s09.rows.map((x) => [x.number, x.base, x.basis])).toEqual([['CLK-202608-1123', 10000, 'Ослободено од ДДВ согласно член 23 од ЗДДВ']]);
    expect(C.annex.find((a) => a.field === '08')).toBeUndefined();
  });

  it('an exemption note „со право на одбивка“ / чл. 24 gives rate 0 in field 08, receivable on 1200009', async () => {
    const d = draft({ number: 'CLK-202608-1124', date: '2026-08-04', vatNote: 'Ослободено од ДДВ со право на одбивка согласно член 24 од ЗДДВ' });
    expect([d.vatExempt, d.vatCheck]).toEqual(['ded', undefined]);
    dedId = (await T((tx) => saveInvoice(tx, firmId, fromDraft(d), office))).id;
    expect(await recv(dedId)).toEqual([['1200009', 10000]]);
    const C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([C.fields['08'], C.fields['09']]).toEqual([10000, 10000]);
    expect(C.annex.map((a) => a.field)).toEqual(['08', '09', '11']);
  });

  it('an exemption note whose kind is unclear is not „спремна“', () => {
    const d = draft({ number: 'X-2', date: '2026-08-03', vatNote: 'Ослободено од ДДВ' });
    expect([d.items[0]!.rate, d.vatNote, d.vatExempt, d.vatCheck]).toEqual([0, 'Ослободено од ДДВ', undefined, true]);
  });

  it('a no-VAT document without a note is not „спремна“ (never guessed)', () => {
    const d = draft({ number: 'X-1', date: '2026-08-03' });
    expect([d.art32, d.items[0]!.rate, d.vatCheck, d.vatNote]).toEqual([false, 0, true, undefined]);
  });
});

describe('bulk „Означи како чл. 32-а“', () => {
  const ids: string[] = [];
  let closedId = '';
  it('moves the three invoices from field 08 to 11 and the receivable 1200009 → 1200, open periods only', async () => {
    // an invoice in Q2, whose VAT period is then closed: never changed
    closedId = (await T((tx) => saveInvoice(tx, firmId, plain('CLK-202606-0990', '2026-06-15', 1000), office))).id;
    await T((tx) => closeVatPeriod(tx, { firmId, period: '2026-Т2', userId: null }));
    for (const [no, d, p] of [['CLK-202607-1031', '2026-07-05', 5000.4], ['CLK-202607-1069', '2026-07-25', 7000.3], ['CLK-202608-1132', '2026-08-30', 3000.45]] as const) {
      ids.push((await T((tx) => saveInvoice(tx, firmId, plain(no, d, p), office))).id);
    }
    const before = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    // existing 0 % invoices without a kind stay in field 08 (as before): 10000 (ded) + 15001.15 → 25001
    expect([before.fields['08'], before.fields['09'], before.fields['11']]).toEqual([25001, 10000, 10000]);
    // a plain 0 % invoice is exempt (08) — never moved to art. 32-a by itself; its receivable is on 1200009
    expect(await recv(ids[0]!)).toEqual([['1200009', 5000.4]]);
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, ids[0]!)))[0]!.art32).toBe(false);

    const r = await T((tx) => markInvoicesVat(tx, firmId, [...ids, closedId], 'art32', office));
    expect(r.changed.map((x) => x.number).sort()).toEqual(['CLK-202607-1031', 'CLK-202607-1069', 'CLK-202608-1132']);
    expect(r.skipped.map((x) => x.number)).toEqual(['CLK-202606-0990']);
    const after = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([after.fields['08'], after.fields['11']]).toEqual([10000, 25001]);
    for (const id of ids) expect((await recv(id))[0]![0]).toBe('1200');
    const L = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, ids[0]!));
    expect(L.map((l) => l.rate)).toEqual([18]);
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, closedId)))[0]!.art32).toBe(false);
    const A = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'vatMark32')));
    expect(A).toHaveLength(3);

    // the annex: field 11 lists its four invoices, sums exactly, the whole-denar rounding shown
    const s11 = after.annex.find((a) => a.field === '11')!;
    expect(s11.rows.map((x) => x.number)).toEqual(['CLK-202607-1031', 'CLK-202609-1176', 'CLK-202607-1069', 'CLK-202608-1132']); // by date
    expect(s11.sum).toBe(25001.15);
    expect([s11.value, s11.rounding]).toEqual([after.fields['11'], -0.15]);
    expect(s11.rows.every((x) => x.name === 'Купувач ДОО' && x.edb === 'MK4030000000999' && /32-а/.test(x.basis))).toBe(true);
  });

  it('the reverse actions: exempt without the right to deduct (09) or with it (08), with the chosen basis', async () => {
    const r = await T((tx) => markInvoicesVat(tx, firmId, [ids[2]!], 'noded', office, { note: 'Ослободено од ДДВ согласно член 23 став 1 од ЗДДВ' }));
    expect(r.changed).toHaveLength(1);
    let C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([C.fields['08'], C.fields['09'], C.fields['11']]).toEqual([10000, 13000, 22001]); // 09: 10000 + 3000.45; 11: 10000 + 12000.70
    expect(C.annex.find((a) => a.field === '09')!.rows.find((x) => x.number === 'CLK-202608-1132')!.basis).toBe('Ослободено од ДДВ согласно член 23 став 1 од ЗДДВ');
    expect(await recv(ids[2]!)).toEqual([['1200', 3000.45]]);
    await T((tx) => markInvoicesVat(tx, firmId, [ids[2]!], 'ded', office));
    C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    expect([C.fields['08'], C.fields['09']]).toEqual([13000, 10000]);
    const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, ids[2]!));
    expect(inv!.data).toMatchObject({ vatExempt: 'ded', vatNote: 'Ослободено од ДДВ со право на одбивка согласно член 24 од ЗДДВ' });
    expect(await recv(ids[2]!)).toEqual([['1200009', 3000.45]]); // re-posted to customerExempt
    // and back again, for the payment test
    await T((tx) => markInvoicesVat(tx, firmId, [ids[2]!], 'art32', office));
  });

  it('a credit note reduces field 11 and is listed with a minus', async () => {
    await T((tx) => saveInvoice(tx, firmId, { kind: 'credit', date: '2026-08-31', partnerId: cust, refInvoiceId: ids[1]!, art32: true, creditKind: 'price', lines: [{ name: 'Попуст', qty: 1, price: 1000, rate: 18, account: '7400' }] }, office));
    const C = await T((tx) => computeVatPeriod(tx, firm, '2026-Т3'));
    const s11 = C.annex.find((a) => a.field === '11')!;
    expect(s11.rows.find((x) => x.kind === 'credit')!.base).toBe(-1000);
    expect(s11.value).toBe(C.fields['11']);
    expect(C.fields['11']).toBe(24001);
  });

  it('a bank payment closes an invoice booked on 1200009', async () => {
    const line = await T((tx) => addManualLine(tx, { firmId, userId: null, bankAccountId: bankId, date: '2026-09-10', amount: 10000, desc: 'Купувач ДОО уплата CLK-202608-1124' }));
    await T((tx) => linkLine(tx, { firmId, userId: null, year: 2026, lineId: line, docIds: [dedId] }));
    expect((await T((tx) => documentPayments(tx, firmId, { invoiceIds: [dedId] }))).get(dedId)).toMatchObject({ paid: 10000, remaining: 0 });
    const L = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, firmId), eq(schema.journalLines.account, '1200009'), eq(schema.journalLines.partnerId, cust)));
    const bankCredit = L.filter((l) => Number(l.credit) === 10000);
    expect(bankCredit).toHaveLength(1);
  });
});

describe('without 1200009 in the chart', () => {
  it('the receivable of an exempt (чл. 24) and an art. 32-a invoice falls back to the customer konto 1200', async () => {
    const [f2] = await db.insert(schema.firms).values({ name: 'Без 1200009 ДОО', vatRegistered: true }).returning();
    await db.insert(schema.accounts).values({ firmId: f2!.id, code: '1200009', name: 'Побарувања од купувачи по член 32 а', hidden: true });
    const p = (await db.insert(schema.partners).values({ firmId: f2!.id, name: 'Инвеститор ДОО', code: '1' }).returning())[0]!.id;
    const r = await T((tx) => saveInvoice(tx, f2!.id, { kind: 'invoice', date: '2026-07-01', partnerId: p, art32: true, lines: [{ name: 'Градежни работи', qty: 1, price: 2000, rate: 18, account: '7400' }] }, office));
    expect(await recv(r.id)).toEqual([['1200', 2000]]);
    const e = await T((tx) => saveInvoice(tx, f2!.id, { kind: 'invoice', date: '2026-07-02', partnerId: p, lines: [{ name: 'Услуга', qty: 1, price: 300, rate: 0, account: '7400' }] }, office));
    expect(await recv(e.id)).toEqual([['1200', 300]]);
  });
});

describe('customerExempt (ослободен промет со право на одбивка, чл. 24)', () => {
  it('a 0 % invoice stays exempt (field 08, never art. 32-a) and its receivable goes to the scheme konto 1200009; a bank payment closes it', async () => {
    const [f3] = await db.insert(schema.firms).values({ name: 'Ослободен ДООЕЛ', vatRegistered: true, vatPeriod: 'quarter', settings: { sch: { customerExempt: '1200009' } } }).returning();
    const fid = f3!.id;
    const p = (await db.insert(schema.partners).values({ firmId: fid, name: 'Клиент ДОО', code: '1' }).returning())[0]!.id;
    const bank = await T((tx) => saveBankAccount(tx, { firmId: fid, userId: null, input: { name: 'Банка', account: '200000000333333', cur: 'MKD', konto: '1000' } }));
    const L0 = (price: number, rate = 0) => [{ name: 'Дезинсекција', qty: 1, price, rate, account: '7400' }];
    const a = (await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', number: 'E-1', date: '2026-07-01', partnerId: p, lines: L0(4000) }, office))).id;
    const b = (await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', number: 'E-2', date: '2026-07-02', partnerId: p, lines: L0(1000), data: { vatExempt: 'noded', vatNote: 'чл. 23' } }, office))).id;
    const c = (await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', number: 'E-3', date: '2026-07-03', partnerId: p, lines: L0(500, 18) }, office))).id;
    const d = (await T((tx) => saveInvoice(tx, fid, { kind: 'invoice', number: 'E-4', date: '2026-07-04', partnerId: p, art32: true, lines: L0(700, 18) }, office))).id;
    expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, a)))[0]!.art32).toBe(false);
    expect([await recv(a), await recv(b), await recv(c), await recv(d)]).toEqual([[['1200009', 4000]], [['1200', 1000]], [['1200', 590]], [['1200', 700]]]);
    const f = (await db.select().from(schema.firms).where(eq(schema.firms.id, fid)))[0]!;
    const C = await T((tx) => computeVatPeriod(tx, f, '2026-Т3'));
    expect([C.fields['08'], C.fields['09'], C.fields['11']]).toEqual([4000, 1000, 700]);
    const line = await T((tx) => addManualLine(tx, { firmId: fid, userId: null, bankAccountId: bank, date: '2026-07-20', amount: 4000, desc: 'Клиент ДОО E-1' }));
    await T((tx) => linkLine(tx, { firmId: fid, userId: null, year: 2026, lineId: line, docIds: [a] }));
    expect((await T((tx) => documentPayments(tx, fid, { invoiceIds: [a] }))).get(a)).toMatchObject({ remaining: 0 });
    const J = await db.select().from(schema.journalLines).where(and(eq(schema.journalLines.firmId, fid), eq(schema.journalLines.account, '1200009'), eq(schema.journalLines.partnerId, p)));
    expect(J.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)).toBe(0); // E-1 closed on 1200009
  });
});
