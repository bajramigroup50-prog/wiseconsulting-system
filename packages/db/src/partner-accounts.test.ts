/**
 * Partner bank accounts on PGlite: learned from a statement (line booked to the partner) and from a read purchase
 * invoice, edited on the card, used by the ПП30 recipients and the per-supplier batch.
 */
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PaymentOrder } from '@wise/core';
import { createSupplierPaymentOrders, payerOf, ppRecipients, saveBankAccount, setLinePartner } from './bank/index';
import { learnAccountsFromStatements, PartnerAccountError, savePartnerAccounts } from './partner-accounts';
import { savePurchase } from './sales/purchases';
import * as schema from './schema/index';
import { seedReference } from './seed/reference';

const db = drizzle(new PGlite(), { schema });
type DB = typeof db;
const T = <R>(f: (tx: DB) => Promise<R>) => db.transaction((tx) => f(tx as unknown as DB));
const HALK = '270077299520174';
const KB = '300000001234555';
const NLB = '210000006789007';
let firmId = '', sup = '', other = '', acct = '';

const partner = async (id: string) => (await db.select().from(schema.partners).where(eq(schema.partners.id, id)))[0]!;
const accs = async (id: string) => ((await partner(id)).data as { accounts?: { acc: string; def?: boolean; src?: string }[] }).accounts ?? [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await seedReference(db);
  const [f] = await db.insert(schema.firms).values({ name: 'БАЈРАМИ ГРОУП ДООЕЛ', edb: '4030000000001', address: 'ГОЦЕ ДЕЛ^ЕВ 5', city: '^аир' }).returning();
  firmId = f!.id;
  sup = (await db.insert(schema.partners).values({ firmId, name: 'Добавувач ДООЕЛ', code: '1', edb: '4030999000111' }).returning())[0]!.id;
  other = (await db.insert(schema.partners).values({ firmId, name: 'Друг ДОО', code: '2' }).returning())[0]!.id;
  // the import names the account „Сметка 270…“ — that label must not end up as the payer's bank
  acct = await T((tx) => saveBankAccount(tx, { firmId, userId: null, input: { name: 'Сметка ' + HALK, account: HALK, cur: 'MKD', konto: '1000' } }));
}, 60_000);

describe('payer', () => {
  it('bank name from the account code, YUSCII repaired', async () => {
    const p = await T((tx) => payerOf(tx, firmId));
    expect(p).toMatchObject({ account: HALK, bankName: 'Халк Банка АД Скопје', address: 'ГОЦЕ ДЕЛЧЕВ 5', city: 'Чаир' });
  });
});

describe('learning partner accounts', () => {
  it('from a statement line booked to the partner (own account and invalid ones skipped)', async () => {
    const [st] = await db.insert(schema.bankStatements).values({ firmId, bankAccountId: acct, date: '2026-10-01' }).returning();
    const L = await db.insert(schema.bankLines).values([
      { firmId, statementId: st!.id, bankAccountId: acct, lineNo: 1, date: '2026-10-01', amount: '-100.00', description: 'плаќање', counterAccount: '300-0000012345-55', dupKey: 'a' },
      { firmId, statementId: st!.id, bankAccountId: acct, lineNo: 2, date: '2026-10-01', amount: '-50.00', description: 'грешна', counterAccount: '300000001234556', partnerId: other, dupKey: 'b' },
      { firmId, statementId: st!.id, bankAccountId: acct, lineNo: 3, date: '2026-10-01', amount: '-50.00', description: 'своја', counterAccount: HALK, partnerId: other, dupKey: 'c' },
    ]).returning();
    await T((tx) => setLinePartner(tx, { firmId, userId: null, lineId: L[0]!.id, partnerId: sup }));
    expect((await accs(sup)).map((a) => [a.acc, !!a.def, a.src])).toEqual([[KB, true, 'statement']]);
    expect((await partner(sup)).bankAccount).toBe(KB);
    expect(await T((tx) => learnAccountsFromStatements(tx, { firmId, userId: null }))).toBe(0);
    expect(await accs(other)).toEqual([]);
    const log = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.firmId, firmId), eq(schema.auditLog.action, 'partnerAccLearn')));
    expect(log).toHaveLength(1);
  });
  it('from a read purchase invoice (data.bankAcc)', async () => {
    const r = await T((tx) => savePurchase(tx, firmId, {
      number: '15/2026', date: '2026-09-15', partnerId: sup, ptype: 'cost', groups: [{ account: '4000', rate: 18, base: 1000, vat: 180 }],
      data: { bankAcc: NLB },
    }, { userId: null, role: 'acc' }));
    expect(r.warnings.join(' ')).toMatch(/Жиро сметката на добавувачот/);
    expect((await accs(sup)).map((a) => [a.acc, !!a.def, a.src])).toEqual([[KB, true, 'statement'], [NLB, false, 'invoice']]);
  });
  it('edited on the card: validated, default moved', async () => {
    await expect(T((tx) => savePartnerAccounts(tx, { firmId, userId: null, partnerId: sup, accounts: [{ acc: '300000001234556' }] }))).rejects.toBeInstanceOf(PartnerAccountError);
    await T((tx) => savePartnerAccounts(tx, { firmId, userId: null, partnerId: sup, accounts: [{ acc: KB }, { acc: NLB, def: true }] }));
    expect((await accs(sup)).map((a) => [a.acc, !!a.def, a.src])).toEqual([[KB, false, 'statement'], [NLB, true, 'invoice']]);
    expect((await partner(sup)).bankAccount).toBe(NLB);
  });
});

describe('ПП30 recipients and batch', () => {
  it('offers the partner with its accounts and the unpaid invoice', async () => {
    const R = await T((tx) => ppRecipients(tx, firmId, 2026));
    const s = R.find((x) => x.key === 'p:' + sup)!;
    expect(s.accounts.map((a) => [a.acc, a.def])).toEqual([[KB, false], [NLB, true]]);
    expect(s.invoices.map((i) => [i.number, i.open])).toEqual([['15/2026', 1180]]);
  });
  it('one order per supplier, amount = open, purpose / reference = invoice number', async () => {
    const R = await T((tx) => ppRecipients(tx, firmId, 2026));
    const refIds = R.find((x) => x.key === 'p:' + sup)!.invoices.map((i) => i.refId);
    const r = await T((tx) => createSupplierPaymentOrders(tx, { firmId, userId: null, year: 2026, refIds, date: '2026-10-14' }));
    expect(r.ids).toHaveLength(1);
    expect(r.missing).toEqual([]);
    const [o] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, r.ids[0]!));
    const d = o!.data as unknown as PaymentOrder;
    expect([o!.amount, d.recipAcc, d.recipBank, d.purpose, d.refCredit, d.payerBank, d.payerAcc]).toEqual(['1180.00', NLB, 'НЛБ Банка АД Скопје', 'Плаќање по фактура бр. 15/2026', '15/2026', 'Халк Банка АД Скопје', HALK]);
    expect(d.refIds).toEqual(refIds);
  });
});
