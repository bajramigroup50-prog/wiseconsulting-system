/**
 * Schema — Phase 4 "bank & cash": bank accounts, statements (изводи) and their lines, matching rules,
 * office exchange-rate list, cash registers (благајни) and cash vouchers, payment orders (ПП30/50/10).
 *
 * Posting: every statement is one journal (`source_type = 'bank_statement'`, kind `bank`), every cash
 * voucher one journal (`source_type = 'cash_voucher'`, kind `kasa`) — written by the posting service only.
 * Money is numeric(18,2) in denars; foreign-currency amounts are numeric(18,2) in the account currency;
 * rates numeric(18,6).
 */
import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { files, firms, users } from './foundation';
import { partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 18, scale: 6 });

/* ---------------- Bank accounts ---------------- */

/**
 * Firm bank accounts (legacy `firm.banks[]`). The codes table has no bank-account codebook, so this is its
 * own table. `konto` is the ledger account (1000, 100005, 1030…); `cur` MKD or a foreign currency.
 * `nal` overrides the nalog code (default 6/66/… for MKD, 7/77/… for FX by position — `bankNalCode`).
 * The posting service numbers bank journals from `firms.settings.banks`, which is kept in sync on save.
 */
export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  name: text('name').notNull(),
  /** Account number as printed (15 digits for MK) or foreign account number. */
  account: text('account'),
  iban: text('iban'),
  cur: text('cur').notNull().default('MKD'),
  konto: text('konto').notNull(),
  nal: text('nal'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('bank_accounts_firm_idx').on(t.firmId, t.sort),
  uniqueIndex('bank_accounts_firm_legacy_uq').on(t.firmId, t.legacyId).where(sql`${t.legacyId} is not null`),
  check('bank_accounts_konto_digits', sql`${t.konto} ~ '^[0-9]{2,10}$'`),
]);

/* ---------------- Statements & lines ---------------- */

/**
 * One bank statement = one account × one booking date (legacy statement key `izvKey` = `[acct:]date`).
 * `number` is the statement number (legacy `firm.izv`), `opening`/`closing` the balances printed by the bank
 * (legacy `izvSal`), `statedDebit`/`statedCredit` the totals for the control (legacy `izvTot`), `rate` the
 * MKD rate of an FX statement (legacy `izvRate`).
 */
export const bankStatements = pgTable('bank_statements', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** FIX(4.4 #9): restrict — an account with statements cannot be removed (legacy orphaned the rows). */
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id, { onDelete: 'restrict' }),
  date: date('date').notNull(),
  number: text('number'),
  opening: money('opening'),
  closing: money('closing'),
  statedDebit: money('stated_debit'),
  statedCredit: money('stated_credit'),
  rate: rate('rate'),
  /** `mt940`, `halk-xml`, `camt.053`, `kb`, `table`, `excel`, `manual`. */
  format: text('format'),
  fileName: text('file_name'),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  /** Import batch (legacy `imp`) — one upload may create several statements. */
  importBatch: uuid('import_batch'),
  /** `draft` (has unbooked lines, no journal) or `posted` (journal written by the posting service). */
  status: text('status').$type<'draft' | 'posted'>().notNull().default('draft'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('bank_statements_acct_date_uq').on(t.bankAccountId, t.date),
  index('bank_statements_firm_date_idx').on(t.firmId, t.date),
]);

export interface BankRefAlloc { type: 'invoice' | 'purchase'; id: string; label: string; /** denars */ amt: number }
export interface BankSplit { k: string; /** denars */ a: number; n?: string }

/** Statement lines (legacy `bank` rows). `amount` is the signed MKD amount (+ inflow). */
export const bankLines = pgTable('bank_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  statementId: uuid('statement_id').notNull().references(() => bankStatements.id, { onDelete: 'cascade' }),
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id, { onDelete: 'restrict' }),
  lineNo: integer('line_no').notNull(),
  date: date('date').notNull(),
  valDate: date('val_date'),
  amount: money('amount').notNull(),
  /** FX accounts: signed amount in the account currency; MKD amount = bank counter-value or amountCur × rate. */
  amountCur: money('amount_cur'),
  cur: text('cur'),
  /** The bank printed the MKD counter-value (Halk / KB) — the statement rate does not recompute it. */
  mkdFromBank: boolean('mkd_from_bank').notNull().default(false),
  description: text('description').notNull().default(''),
  name: text('name'),
  purpose: text('purpose'),
  /** Payment basis code (шифра на основ). */
  osnov: text('osnov'),
  /** Bank reference. */
  bref: text('bref'),
  /** Counterparty account / IBAN. */
  counterAccount: text('counter_account'),
  /** Counter konto; null = unbooked. */
  konto: text('konto'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Linked document (invoice / purchase id, or a ledger open-item id `L|konto|partner|doc` until Phase 3). */
  refType: text('ref_type').$type<'invoice' | 'purchase'>(),
  refId: text('ref_id'),
  refLabel: text('ref_label'),
  /** Multi-document allocation (legacy `refs[]`), denars. */
  refs: jsonb('refs').$type<BankRefAlloc[]>(),
  /** MKD amount that settles the linked document; the rest is an FX difference (7810/4810). */
  settle: money('settle'),
  split: jsonb('split').$type<BankSplit[]>(),
  payRef: text('pay_ref'),
  pos: boolean('pos').notNull().default(false),
  own: boolean('own').notNull().default(false),
  conv: boolean('conv').notNull().default(false),
  manual: boolean('manual').notNull().default(false),
  /** How the line was booked automatically (`num`, `amt`, `sum`, `rule`, `fee`, `pos`, `vat`, `own`, `conv`…); null = by the user. */
  auto: text('auto'),
  /** Partner name suggested for creation (legacy created partners silently — FIX 4.4 #5). */
  newPartner: text('new_partner'),
  /** Legacy `bKey` for duplicate detection. */
  dupKey: text('dup_key').notNull(),
  importBatch: uuid('import_batch'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('bank_lines_statement_idx').on(t.statementId, t.lineNo),
  index('bank_lines_firm_date_idx').on(t.firmId, t.date),
  index('bank_lines_firm_ref_idx').on(t.firmId, t.refType, t.refId),
  index('bank_lines_firm_dup_idx').on(t.firmId, t.dupKey),
  check('bank_lines_konto_digits', sql`${t.konto} is null or ${t.konto} ~ '^[0-9]{2,10}$'`),
]);

/**
 * Matching rules (legacy `firm.rules[]` and `firm.osnovK`). `kind = 'desc'`: description contains `match`;
 * `kind = 'osnov'`: payment code `match` = `<code>|in` / `<code>|out`.
 */
export const bankRules = pgTable('bank_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'desc' | 'osnov'>().notNull().default('desc'),
  match: text('match').notNull(),
  konto: text('konto').notNull(),
  learned: boolean('learned').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('bank_rules_firm_match_uq').on(t.firmId, t.kind, sql`lower(${t.match})`),
  check('bank_rules_konto_digits', sql`${t.konto} ~ '^[0-9]{2,10}$'`),
]);

/* ---------------- Exchange rates ---------------- */

/**
 * Office-wide middle rates (legacy `appsettings/fx` rows `{cur, rate, date}` — Шифрарник › Курсна листа).
 * Lookup order (`fxRate`): firm currency codebook (`codes` cb='currency' with firm_id) → this table →
 * built-in `FX_DEF`.
 */
export const fxRates = pgTable('fx_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  cur: text('cur').notNull(),
  rate: rate('rate').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('fx_rates_date_cur_uq').on(t.date, t.cur),
  index('fx_rates_cur_date_idx').on(t.cur, t.date),
  check('fx_rates_rate_pos', sql`${t.rate} > 0`),
]);

/* ---------------- Cash registers & vouchers ---------------- */

/** Cash registers (legacy `firm.blg[]`; default 1020 MKD, 1051/1052 EUR). */
export const cashRegisters = pgTable('cash_registers', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  name: text('name').notNull(),
  konto: text('konto').notNull(),
  cur: text('cur').notNull().default('MKD'),
  sort: integer('sort').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('cash_registers_firm_idx').on(t.firmId, t.sort),
  check('cash_registers_konto_digits', sql`${t.konto} ~ '^[0-9]{2,10}$'`),
]);

/**
 * Cash vouchers (legacy `docs` type `blg`): `in` = уплатница (receipt into the register), `out` = исплатница /
 * fiscal receipt paid from it. `amt` in `cur`, `fx` = MKD per unit, `vat` = VAT printed on the receipt (in `cur`).
 */
export const cashVouchers = pgTable('cash_vouchers', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  registerId: uuid('register_id').notNull().references(() => cashRegisters.id, { onDelete: 'restrict' }),
  legacyId: text('legacy_id'),
  kind: text('kind').$type<'in' | 'out'>().notNull(),
  date: date('date').notNull(),
  /** У-nnn / И-nnn per register and year. */
  number: text('number').notNull(),
  docNo: text('doc_no'),
  merchant: text('merchant'),
  vatId: text('vat_id'),
  country: text('country').notNull().default('MK'),
  cur: text('cur').notNull().default('MKD'),
  amt: money('amt').notNull(),
  fx: rate('fx').notNull().default('1'),
  vatRate: integer('vat_rate').notNull().default(0),
  vat: money('vat'),
  cat: text('cat'),
  konto: text('konto'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  note: text('note'),
  payK: text('pay_k'),
  liters: numeric('liters', { precision: 12, scale: 3 }),
  /** Receipt photo / PDF in MinIO (also linked through `file_links`). */
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  /** Remaining legacy fields: pay, ref, pnRef, rcRef, tbRef, proj, ocr text… */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('cash_vouchers_firm_date_idx').on(t.firmId, t.date),
  index('cash_vouchers_register_idx').on(t.registerId, t.date),
  uniqueIndex('cash_vouchers_number_uq').on(t.registerId, t.kind, sql`extract(year from ${t.date})`, t.number),
  check('cash_vouchers_kind_chk', sql`${t.kind} in ('in','out')`),
]);

/* ---------------- Payment orders ---------------- */

/** Payment orders ПП30 / ПП50 / ПП10 (legacy `docs` type `pp`). The printable fields live in `data`. */
export const paymentOrders = pgTable('payment_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'pp30' | 'pp50' | 'pp10'>().notNull(),
  date: date('date').notNull(),
  amount: money('amount'),
  recipient: text('recipient'),
  /** All form fields (`PaymentOrder` in `@wise/core`). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  /** Optional link to the document being paid (open-item id). */
  refId: text('ref_id'),
  printedAt: ts('printed_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('payment_orders_firm_date_idx').on(t.firmId, t.date),
  check('payment_orders_kind_chk', sql`${t.kind} in ('pp30','pp50','pp10')`),
]);

/* ---------------- Compensations ---------------- */

export interface CompensationRowData {
  side: 'rec' | 'pay';
  /** Open-item id (invoice / purchase id, or ledger item 'L|konto|partner|doc' until Phase 3). */
  refId?: string | null;
  docNo?: string;
  date?: string;
  partnerId: string;
  konto: string;
  /** denars */
  amt: number;
}

/** Compensations (legacy docs type 'komp'): bilateral / multilateral; receivables must equal payables. Posted as kind 'komp'. */
export const compensations = pgTable('compensations', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'bi' | 'multi'>().notNull().default('bi'),
  date: date('date').notNull(),
  /** К-nnn/yyyy */
  number: text('number').notNull(),
  note: text('note'),
  rows: jsonb('rows').$type<CompensationRowData[]>().notNull().default([]),
  total: money('total').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('compensations_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('compensations_firm_number_uq').on(t.firmId, t.number),
]);

export type CompensationRecord = typeof compensations.$inferSelect;
export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type BankStatement = typeof bankStatements.$inferSelect;
export type BankLine = typeof bankLines.$inferSelect;
export type NewBankLine = typeof bankLines.$inferInsert;
export type BankRuleRow = typeof bankRules.$inferSelect;
export type FxRateRecord = typeof fxRates.$inferSelect;
export type CashRegister = typeof cashRegisters.$inferSelect;
export type CashVoucherRow = typeof cashVouchers.$inferSelect;
export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
