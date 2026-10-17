/**
 * The account printed on a statement is not among the firm's bank accounts. Firms set up from an opening balance
 * often have their accounts WITHOUT numbers („ЖИРО СМЕТКА ТУТУНСКА БАНКА · ·“, konto 100001): when exactly one
 * denar account of the statement's bank (by the 3-digit code: 210 → НЛБ / Тутунска) has no number, it is proposed
 * and the number is filled in on confirmation; otherwise a new account is proposed with the konto of its bank
 * (`pickBankKonto` through `autoBankKonto`).
 */
import { and, eq } from 'drizzle-orm';
import { mkAccountValid } from '@wise/core/bank/payment-order';
import { mkBankName, namesBankOf } from '@wise/core/bank/mk-banks';
import { audit, type Tx } from '../audit';
import { bankAccounts, type BankAccountRow } from '../schema/index';
import { autoBankKonto, BankError, bankKontoChart } from './context';
import { saveBankAccount } from './lines';

const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export interface AccountProposal {
  /** The account of the statement (15 digits). */
  account: string;
  /** Its bank by the code („НЛБ Банка АД Скопје“). */
  bank: string;
  /** The one numberless account of that bank: confirm to fill in the number. */
  link?: { accountId: string; name: string; konto: string };
  /** No such account (or several): open a new one on this konto. */
  create?: { name: string; konto: string };
}

/** The firm's denar accounts without a number that name the bank of `account` (in their name or their konto's name). */
export async function numberlessAccountsOf(tx: Tx, firmId: string, account: string, rows: readonly BankAccountRow[]): Promise<BankAccountRow[]> {
  const free = rows.filter((a) => !dig(a.account) && !dig(a.iban) && (a.cur || 'MKD') === 'MKD' && a.active !== false);
  if (!free.length) return [];
  const chart = new Map((await bankKontoChart(tx, firmId)).map((c) => [c.code, c.name]));
  return free.filter((a) => namesBankOf(account, `${a.name} ${chart.get(a.konto) ?? ''}`));
}

/** What to do with a statement account the firm does not have (null when it is not a valid MK account). */
export async function proposeStatementAccount(tx: Tx, firmId: string, account: string, rows: readonly BankAccountRow[]): Promise<AccountProposal | null> {
  const acc = dig(account);
  if (acc.length !== 15 || !mkAccountValid(acc)) return null;
  const bank = mkBankName(acc);
  const C = await numberlessAccountsOf(tx, firmId, acc, rows);
  if (C.length === 1) return { account: acc, bank, link: { accountId: C[0]!.id, name: C[0]!.name, konto: C[0]!.konto } };
  return { account: acc, bank, create: { name: bank || `Банка ${acc}`, konto: await autoBankKonto(tx, firmId, acc, 'MKD') } };
}

/** „Поврзи ја сметката 210… со ЖИРО СМЕТКА ТУТУНСКА БАНКА (100001)“: the number is filled in on that account. */
export async function linkBankAccountNumber(tx: Tx, a: { firmId: string; userId: string | null; accountId: string; account: string }): Promise<void> {
  const acc = dig(a.account);
  if (acc.length !== 15 || !mkAccountValid(acc)) throw new BankError('Неважечки број на сметка.');
  const [b] = await tx.select().from(bankAccounts).where(and(eq(bankAccounts.id, a.accountId), eq(bankAccounts.firmId, a.firmId))).limit(1);
  if (!b) throw new BankError('Сметката не постои.');
  if (dig(b.account) || dig(b.iban)) {
    if (dig(b.account) === acc) return;
    throw new BankError(`Сметката „${b.name}“ веќе има број ${b.account || b.iban}.`);
  }
  const all = await tx.select({ id: bankAccounts.id, name: bankAccounts.name, account: bankAccounts.account, iban: bankAccounts.iban }).from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId));
  const other = all.find((x) => x.id !== b.id && [dig(x.account), dig(x.iban)].some((d) => d.length >= 15 && d.endsWith(acc)));
  if (other) throw new BankError(`Сметката ${acc} е веќе внесена како „${other.name}“.`);
  await tx.update(bankAccounts).set({ account: acc }).where(eq(bankAccounts.id, b.id));
  await audit(tx, { userId: a.userId, firmId: a.firmId, action: 'saveBankAcct', entityType: 'bank_account', entityId: b.id, data: { account: acc, from: 'statement' } });
}

/** „Отвори ја сметката 210…“: a new denar account for the statement's account, on the konto of its bank. */
export async function createStatementAccount(tx: Tx, a: { firmId: string; userId: string | null; account: string }): Promise<string> {
  const acc = dig(a.account);
  if (acc.length !== 15 || !mkAccountValid(acc)) throw new BankError('Неважечки број на сметка.');
  const all = await tx.select({ name: bankAccounts.name, account: bankAccounts.account, iban: bankAccounts.iban }).from(bankAccounts).where(eq(bankAccounts.firmId, a.firmId));
  const other = all.find((x) => [dig(x.account), dig(x.iban)].some((d) => d.length >= 15 && d.endsWith(acc)));
  if (other) throw new BankError(`Сметката ${acc} е веќе внесена како „${other.name}“.`);
  return saveBankAccount(tx, { firmId: a.firmId, userId: a.userId, input: { name: mkBankName(acc) || `Банка ${acc}`, account: acc, cur: 'MKD', konto: '' } });
}
