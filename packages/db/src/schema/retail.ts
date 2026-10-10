/**
 * Schema — stock, materials & retail screens (legacy `docs` of type `ord`, `po`, `lcard`, `coupon`, `akcija`,
 * `rasnorm`, and purchase/production lots): customer orders, supplier orders, loyalty cards, coupons, promotions,
 * lots with expiry, and material write-offs without a BOM.
 *
 * Stock effects are written through `stock_moves` (`replaceSourceMoves`) with `source_type` `manual_move`
 * (Приемници и издатници), `writeoff_doc` (раздолжување без норматив) or `stock_import` (Excel receipts).
 * Per-firm rules (loyalty points, replenishment, overhead accounts, lot warning days, item clean-up rules) live in
 * `firms.settings` (`loy`, `repl`, `pcost`, `lotDays`, `prodRawK`, `artAbbr`, `artUnits`, `artIgnore`).
 */
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { codes, items, partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const firmId = () => uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' });
const createdBy = () => uuid('created_by').references(() => users.id, { onDelete: 'set null' });

/* ---------------- customer orders (нарачки од купувачи) ---------------- */

export interface CustomerOrderLine { itemId: string | null; name: string; unit: string | null; qty: number; price: number; disc: number; rate: number; account: string | null }

/** Legacy `docs.type='ord'` (9870): reserves stock; delivered = invoices with `data.source = {type:'customer_order', id}`. */
export const customerOrders = pgTable('customer_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** `НР-NNN/YYYY`. */
  number: text('number').notNull(),
  date: date('date').notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  deliveryDate: date('delivery_date'),
  note: text('note'),
  /** `open` (state open / part / done is computed from deliveries) or `cancel`. */
  status: text('status').$type<'open' | 'cancel'>().notNull().default('open'),
  lines: jsonb('lines').$type<CustomerOrderLine[]>().notNull().default([]),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('customer_orders_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('customer_orders_firm_number_uq').on(t.firmId, t.number),
  check('customer_orders_status_chk', sql`${t.status} in ('open','cancel')`),
]);

/* ---------------- supplier orders (нарачки до добавувачи) ---------------- */

export interface SupplierOrderLine { itemId: string; name: string; unit: string | null; qty: number; price: number }

/** Legacy `docs.type='po'` (9900): not posted; created by hand, from replenishment (`repl`) or MRP (`mrp`). */
export const supplierOrders = pgTable('supplier_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** `НД-NNN/YYYY`. */
  number: text('number').notNull(),
  date: date('date').notNull(),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  note: text('note'),
  status: text('status').$type<'open' | 'recv' | 'cancel'>().notNull().default('open'),
  source: text('source').$type<'repl' | 'mrp' | null>(),
  receivedAt: date('received_at'),
  lines: jsonb('lines').$type<SupplierOrderLine[]>().notNull().default([]),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('supplier_orders_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('supplier_orders_firm_number_uq').on(t.firmId, t.number),
  check('supplier_orders_status_chk', sql`${t.status} in ('open','recv','cancel')`),
]);

/* ---------------- loyalty cards and coupons ---------------- */

export interface LoyaltyLogRow { d: string; pay: number; earn: number; red: number }

/** Legacy `docs.type='lcard'` (9943). */
export const loyaltyCards = pgTable('loyalty_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** Card number / barcode. */
  number: text('number').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  /** Permanent discount %. */
  discount: numeric('discount', { precision: 6, scale: 2 }).notNull().default('0'),
  points: numeric('points', { precision: 18, scale: 2 }).notNull().default('0'),
  spent: money('spent').notNull().default('0'),
  visits: integer('visits').notNull().default(0),
  lastVisit: date('last_visit'),
  log: jsonb('log').$type<LoyaltyLogRow[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('loyalty_cards_firm_number_uq').on(t.firmId, t.number)]);

/** Legacy `docs.type='coupon'` (9943): percent or amount, validity, max uses (0 = unlimited), minimum receipt total. */
export const coupons = pgTable('coupons', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  code: text('code').notNull(),
  kind: text('kind').$type<'pct' | 'amt'>().notNull().default('pct'),
  value: numeric('value', { precision: 18, scale: 2 }).notNull(),
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  maxUses: integer('max_uses').notNull().default(1),
  used: integer('used').notNull().default(0),
  minTotal: money('min_total').notNull().default('0'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('coupons_firm_code_uq').on(t.firmId, t.code),
  check('coupons_kind_chk', sql`${t.kind} in ('pct','amt')`),
]);

/* ---------------- promotions (акции и попусти) ---------------- */

export interface PromotionDocLine { itemId: string; old: number; new: number }

/**
 * Legacy `docs.type='akcija'` (5802): a decision with old and promotional retail prices; "start" creates a levelling
 * (`nivStart`), "end" a levelling back to the regular prices (`nivEnd`).
 */
export const promotions = pgTable('promotions', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** `NNN/YY`. */
  number: text('number').notNull(),
  name: text('name').notNull(),
  locationId: uuid('location_id').references(() => codes.id, { onDelete: 'restrict' }),
  date: date('date').notNull(),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  pct: numeric('pct', { precision: 6, scale: 2 }),
  /** Rounding of new prices: 0 = cents, 1 = denar, 10 = tens. */
  rounding: integer('rounding').notNull().default(0),
  status: text('status').$type<'plan' | 'active' | 'done'>().notNull().default('plan'),
  lines: jsonb('lines').$type<PromotionDocLine[]>().notNull().default([]),
  levellingStartId: uuid('levelling_start_id'),
  levellingEndId: uuid('levelling_end_id'),
  startedOn: date('started_on'),
  endedOn: date('ended_on'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('promotions_firm_from_idx').on(t.firmId, t.dateFrom),
  uniqueIndex('promotions_firm_number_uq').on(t.firmId, t.number),
  check('promotions_status_chk', sql`${t.status} in ('plan','active','done')`),
]);

/* ---------------- lots and expiry ---------------- */

/**
 * Lot / batch and expiry of a received quantity (legacy `purchase.lots[ix]` and `production.lot/exp`, 10024).
 * `source_type` `purchase` (line `line_no` of the purchase's stock lines) or `production` (line 0).
 */
export const stockLots = pgTable('stock_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  sourceType: text('source_type').$type<'purchase' | 'production'>().notNull(),
  sourceId: uuid('source_id').notNull(),
  lineNo: integer('line_no').notNull().default(0),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  qty: qty('qty').notNull(),
  lot: text('lot'),
  expiry: date('expiry'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('stock_lots_source_uq').on(t.firmId, t.sourceType, t.sourceId, t.lineNo),
  index('stock_lots_item_idx').on(t.firmId, t.itemId),
  check('stock_lots_source_chk', sql`${t.sourceType} in ('purchase','production')`),
]);

/* ---------------- write-off of materials without a BOM ---------------- */

export interface WriteoffDocLine { itemId: string; qty: number; value: number }

/**
 * Legacy `docs.type='rasnorm'` (13870): materials issued for a period by count or as % of sales; optional product
 * received into stock (6300 / 6000). Moves: `stock_moves.source_type = 'writeoff_doc'`.
 */
export const writeoffDocs = pgTable('writeoff_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  date: date('date').notNull(),
  dateFrom: date('date_from').notNull(),
  dateTo: date('date_to').notNull(),
  mode: text('mode').$type<'popis' | 'pct'>().notNull(),
  pct: numeric('pct', { precision: 6, scale: 2 }),
  total: money('total').notNull().default('0'),
  locationId: uuid('location_id').references(() => codes.id, { onDelete: 'restrict' }),
  productId: uuid('product_id').references(() => items.id, { onDelete: 'restrict' }),
  productQty: qty('product_qty'),
  lines: jsonb('lines').$type<WriteoffDocLine[]>().notNull().default([]),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('writeoff_docs_firm_date_idx').on(t.firmId, t.date),
  check('writeoff_docs_mode_chk', sql`${t.mode} in ('popis','pct')`),
]);

export type CustomerOrderRow = typeof customerOrders.$inferSelect;
export type SupplierOrderRow = typeof supplierOrders.$inferSelect;
export type LoyaltyCardRow = typeof loyaltyCards.$inferSelect;
export type CouponRow = typeof coupons.$inferSelect;
export type PromotionRow = typeof promotions.$inferSelect;
export type StockLotRow = typeof stockLots.$inferSelect;
export type WriteoffDocRow = typeof writeoffDocs.$inferSelect;
