/**
 * Schema — Phase 2 "core books": chart of accounts, partners, items, codebooks and the persisted
 * double-entry ledger (journals + journal_lines).
 *
 * The ledger is written by the posting service (`src/posting.ts`) only. Debit = credit per journal is
 * enforced by the deferred constraint trigger `journal_lines_balanced` (migration 0002, custom SQL),
 * so a transaction can insert lines in any order but cannot commit an unbalanced journal.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

/* ---------------- Chart of accounts ---------------- */

/**
 * Chart of accounts. `firm_id IS NULL` = the built-in Macedonian chart (seeded from legacy `KONTO_SRC`);
 * a row with `firm_id` is a per-firm override (legacy `firm.accounts`): it renames or adds an account,
 * or with `hidden = true` removes a built-in account from that firm's chart (legacy `accounts[k] = null`).
 */
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** Albanian name (legacy `v.sq`), optional. */
  nameSq: text('name_sq'),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('accounts_global_code_uq').on(t.code).where(sql`${t.firmId} is null`),
  uniqueIndex('accounts_firm_code_uq').on(t.firmId, t.code).where(sql`${t.firmId} is not null`),
  check('accounts_code_digits', sql`${t.code} ~ '^[0-9]{2,10}$'`),
]);

/* ---------------- Partners (комитенти) ---------------- */

/**
 * Partners (legacy `partners`). FIX(#17): legacy `newS` seeded every draft with item defaults
 * (`rate:18, konto:'7400', type:'service'`) that ended up stored on partners — there are no such columns here.
 */
export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  /** Numeric code, auto-assigned (legacy `AUTO_CODE` / `nextCode`, zero padding kept). */
  code: text('code'),
  name: text('name').notNull(),
  edb: text('edb'),
  embs: text('embs'),
  address: text('address'),
  city: text('city'),
  country: text('country'),
  email: text('email'),
  phone: text('phone'),
  contact: text('contact'),
  /** Bank account (жиро сметка) and bank name. */
  bankAccount: text('bank_account'),
  bankName: text('bank_name'),
  vatRegistered: boolean('vat_registered').notNull().default(true),
  foreign: boolean('foreign').notNull().default(false),
  active: boolean('active').notNull().default(true),
  /** Remaining legacy fields: manager, nkd, activity, regDate, tekovna, docs[], pos, note, type… */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('partners_firm_name_idx').on(t.firmId, t.name),
  index('partners_firm_edb_idx').on(t.firmId, t.edb),
  uniqueIndex('partners_firm_code_uq').on(t.firmId, t.code).where(sql`${t.code} is not null and ${t.code} <> ''`),
  uniqueIndex('partners_firm_legacy_uq').on(t.firmId, t.legacyId).where(sql`${t.legacyId} is not null`),
]);

/* ---------------- Items (производи и артикли) ---------------- */

export const ITEM_TYPES = ['service', 'goods', 'material', 'product'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  code: text('code'),
  name: text('name').notNull(),
  type: text('type').$type<ItemType>().notNull().default('goods'),
  unit: text('unit'),
  /** Unit prices keep 4 decimals (they are rates, not booked amounts — those are numeric(18,2)). */
  price: numeric('price', { precision: 18, scale: 4 }),
  vatRate: integer('vat_rate').notNull().default(18),
  /** Revenue account (legacy `konto`); empty = from the posting scheme by type. */
  revenueAccount: text('revenue_account'),
  minStock: numeric('min_stock', { precision: 18, scale: 3 }),
  weight: numeric('weight', { precision: 18, scale: 3 }),
  madeInMk: boolean('made_in_mk').notNull().default(false),
  /** Own production: credit this account when issued (legacy `rawK`), cost price or % of the selling price. */
  rawAccount: text('raw_account'),
  costPrice: numeric('cost_price', { precision: 18, scale: 4 }),
  costPct: numeric('cost_pct', { precision: 8, scale: 2 }),
  /** Auto-parts fields (legacy `oe`, `cross`, `fits`). */
  oe: text('oe'),
  crossRefs: text('cross_refs'),
  fits: text('fits'),
  active: boolean('active').notNull().default(true),
  /** Remaining legacy fields: sp{wh: retail}, cost, bom[], labor, aliases[] (Phase 7). */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('items_firm_name_idx').on(t.firmId, t.name),
  uniqueIndex('items_firm_code_uq').on(t.firmId, t.code).where(sql`${t.code} is not null and ${t.code} <> ''`),
  uniqueIndex('items_firm_legacy_uq').on(t.firmId, t.legacyId).where(sql`${t.legacyId} is not null`),
  check('items_type_chk', sql`${t.type} in ('service','goods','material','product')`),
]);

/** Barcodes — one barcode = one item per firm (legacy `bcOwner` check in `saveS` 7402). */
export const itemBarcodes = pgTable('item_barcodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  /** The barcode shown on the item card / printed on labels. */
  primary: boolean('primary').notNull().default(false),
}, (t) => [
  uniqueIndex('item_barcodes_firm_code_uq').on(t.firmId, t.barcode),
  index('item_barcodes_item_idx').on(t.itemId),
]);

/** Supplier item codes learned from purchase invoices (legacy `learnItemCodes` 4430). */
export const itemSupplierCodes = pgTable('item_supplier_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name'),
}, (t) => [
  uniqueIndex('item_supplier_codes_uq').on(t.firmId, sql`coalesce(${t.partnerId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.code),
  index('item_supplier_codes_item_idx').on(t.itemId),
]);

/* ---------------- Codebooks (шифрарници) ---------------- */

/**
 * Codebooks (legacy `codes` with `cb`, definitions `CB` 6947): warehouse, store, cash, vehicle, currency,
 * city, position, paysif, … `firm_id IS NULL` = office-wide list (cities, currencies seeded from legacy).
 * Type-specific fields (warehouse `konto/kMarg/kVat`, currency `rate/date`, vehicle `driver`, …) live in `data`.
 */
export const codes = pgTable('codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  legacyId: text('legacy_id'),
  cb: text('cb').notNull(),
  code: text('code'),
  name: text('name').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('codes_firm_cb_idx').on(t.firmId, t.cb),
  uniqueIndex('codes_global_uq').on(t.cb, t.code).where(sql`${t.firmId} is null and ${t.code} is not null`),
]);

/* ---------------- Ledger ---------------- */

/**
 * Journals (налози). One row per posted document (invoice, statement day, payroll run…) or manual entry.
 * `number` is assigned once at posting (`@wise/core` `nalogNumber`): period types share a number such as
 * `2/1-3`; manual and other journals get a per-year counter from 1021. The UI groups journals by number.
 */
export const journals = pgTable('journals', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  date: date('date').notNull(),
  /** `manual`, `open`, `close`, `bbimp`, NAL_DEF keys (`izlez`, `vlez`, …), `bank`, `mpin`, … */
  kind: text('kind').notNull(),
  number: text('number').notNull(),
  description: text('description'),
  /** Origin document, e.g. (`invoice`, <uuid>). Null for manual journals. */
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  /** Covered period for manual accruals (legacy `pFrom` / `pTo`). */
  periodFrom: date('period_from'),
  periodTo: date('period_to'),
  /** Explicitly locked journal (cannot be changed even after the firm lock date moves back). */
  locked: boolean('locked').notNull().default(false),
  /** Extra header data (profit/tax/net of a close journal, bank account id, …). */
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('journals_firm_date_idx').on(t.firmId, t.date),
  index('journals_firm_number_idx').on(t.firmId, t.number),
  index('journals_firm_kind_idx').on(t.firmId, t.kind),
  uniqueIndex('journals_source_uq').on(t.firmId, t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`),
]);

export const journalLines = pgTable('journal_lines', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  journalId: uuid('journal_id').notNull().references(() => journals.id, { onDelete: 'cascade' }),
  /** Denormalized for per-firm indexes; always equal to the journal's firm. */
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  lineNo: integer('line_no').notNull(),
  account: text('account').notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Amounts may be negative: credit notes can be booked as red storno on the same side (legacy `crMode = 'minus'`). */
  debit: money('debit').notNull().default('0'),
  credit: money('credit').notNull().default('0'),
  /** Foreign currency and amount (legacy `cur` + `dd`/`dp`). */
  currency: text('currency'),
  amountCur: money('amount_cur'),
  /** Document reference shown on the nalog (invoice number…) and a per-line note. */
  doc: text('doc'),
  note: text('note'),
  /** Location (warehouse/store code id) for per-location results (legacy `wh`). */
  locationId: uuid('location_id').references(() => codes.id, { onDelete: 'set null' }),
}, (t) => [
  index('journal_lines_journal_idx').on(t.journalId),
  index('journal_lines_firm_account_idx').on(t.firmId, t.account),
  index('journal_lines_firm_partner_idx').on(t.firmId, t.partnerId),
  check('journal_lines_nonzero', sql`${t.debit} <> 0 or ${t.credit} <> 0`),
]);

export type Account = typeof accounts.$inferSelect;
export type Partner = typeof partners.$inferSelect;
export type NewPartner = typeof partners.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Code = typeof codes.$inferSelect;
export type Journal = typeof journals.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
