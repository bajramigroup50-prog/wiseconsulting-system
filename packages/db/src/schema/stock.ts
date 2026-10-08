/**
 * Schema — Phase 7 "stock & retail": stock moves, levelling, transfers, stock counts, daily sales (Z / fiscal
 * reports, POS), bills of materials and production orders.
 *
 * Locations are NOT a table here: warehouses and stores are Phase 2 `codes` rows with `cb = 'warehouse' | 'store'`
 * (account overrides `konto`, `kMarg`, `kVat` in `codes.data`), exactly like legacy. `location_id IS NULL` is the
 * virtual main warehouse (legacy `'main'`).
 *
 * `stock_moves` is the one generic movement table for every module that changes stock: purchase receipts (Phase 3),
 * invoice / dispatch issues, transfers, stock counts, write-offs, POS and fiscal-report issues, production, opening
 * stock. A source document owns its moves through (`source_type`, `source_id`) and replaces them as a set when it is
 * saved again. Journal lines of each move (`lines`) are snapshots; the stock posting service sums them into one
 * journal per source (`journals.source_type = 'stock:' || source_type`).
 */
import { sql } from 'drizzle-orm';
import {
  boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { codes, items, partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 18, scale: 4 });
const unitPrice = (name: string) => numeric(name, { precision: 18, scale: 4 });
const firmId = () => uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' });
const location = (name = 'location_id') => uuid(name).references(() => codes.id, { onDelete: 'restrict' });
const createdBy = () => uuid('created_by').references(() => users.id, { onDelete: 'set null' });

/** Move kinds (legacy `moves.type`) plus `opening` for opening stock. */
export const STOCK_MOVE_KINDS = [
  'in', 'sale', 'transfer', 'transfer-in', 'prod-out', 'prod-in', 'mat-out', 'return', 'writeoff', 'popis', 'popis-in',
  'supret', 'dispatch', 'use', 'opening',
] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

/** Journal line snapshot stored on a move (`@wise/core` `StockJournalLine`, partner as a uuid). */
export interface StockMoveLine { account: string; debit: number; credit: number; partnerId?: string | null; note?: string }

/* ---------------- Stock moves ---------------- */

export const stockMoves = pgTable('stock_moves', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  itemId: uuid('item_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  /** Warehouse / store (`codes` row); null = the main warehouse. */
  locationId: location(),
  date: date('date').notNull(),
  /** Signed: positive = in, negative = out (legacy convention; `avg = value / qty`). */
  qty: qty('qty').notNull(),
  /** Signed cost value of the movement. */
  value: money('value').notNull(),
  /** Unit cost |value / qty| at the time of the move (informational; legacy stored none). */
  price: unitPrice('price'),
  direction: text('direction').$type<'in' | 'out'>().notNull(),
  kind: text('kind').$type<StockMoveKind>().notNull(),
  /** Owner document: `purchase`, `invoice`, `dispatch`, `transfer`, `stock_count`, `sales_daily`, `production`, `opening`, … */
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  /** Line index within the source document. */
  sourceLine: integer('source_line').notNull().default(0),
  /** Client-submitted, not yet approved: ignored by every stock computation (legacy `pend`). */
  pending: boolean('pending').notNull().default(false),
  /** Lot / batch and expiry (FEFO, Phase 10 `lotovi`). */
  lot: text('lot'),
  expiry: date('expiry'),
  label: text('label'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Journal lines of this move (cost / retail-value posting); summed into the source's stock journal. */
  lines: jsonb('lines').$type<StockMoveLine[]>().notNull().default([]),
  /** Legacy move id (`src-item-type`), for the importer. */
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('stock_moves_firm_item_date_idx').on(t.firmId, t.itemId, t.date),
  index('stock_moves_firm_loc_item_idx').on(t.firmId, t.locationId, t.itemId),
  index('stock_moves_firm_date_idx').on(t.firmId, t.date),
  index('stock_moves_source_idx').on(t.firmId, t.sourceType, t.sourceId),
  uniqueIndex('stock_moves_firm_legacy_uq').on(t.firmId, t.legacyId).where(sql`${t.legacyId} is not null`),
  check('stock_moves_direction_chk', sql`(${t.direction} = 'in' and ${t.qty} >= 0) or (${t.direction} = 'out' and ${t.qty} <= 0)`),
  check('stock_moves_kind_chk', sql`${t.kind} in ('in','sale','transfer','transfer-in','prod-out','prod-in','mat-out','return','writeoff','popis','popis-in','supret','dispatch','use','opening')`),
]);

/* ---------------- Levelling (нивелација) ---------------- */

export interface LevellingDocLine { itemId: string; qty: number; old: number; new: number; qtyImp?: boolean }

export const levellingDocs = pgTable('levelling_docs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** `NNN/YYYY`, max + 1 per year (FIX: legacy count + 1). */
  number: text('number').notNull(),
  date: date('date').notNull(),
  locationId: location(),
  lines: jsonb('lines').$type<LevellingDocLine[]>().notNull().default([]),
  note: text('note'),
  /** Promotion end: an automatic price-back levelling is created for the day after (legacy `akTo`). */
  promoTo: date('promo_to'),
  /** This levelling restores prices after the promotion levelling with this number (legacy `akBack`). */
  promoBackOf: text('promo_back_of'),
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('levelling_docs_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('levelling_docs_firm_number_uq').on(t.firmId, t.number),
]);

/* ---------------- Transfers (преносници) ---------------- */

export interface TransferLine { itemId: string; qty: number; /** unit cost at the source */ nabU?: number; /** retail price incl. VAT at the destination */ sp?: number | null }

export const transfers = pgTable('transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  /** `NNNN/YYYY` (legacy `prNextNo`). */
  number: text('number').notNull(),
  date: date('date').notNull(),
  fromLocationId: location('from_location_id'),
  toLocationId: location('to_location_id'),
  lines: jsonb('lines').$type<TransferLine[]>().notNull().default([]),
  note: text('note'),
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('transfers_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('transfers_firm_number_uq').on(t.firmId, t.number),
  check('transfers_distinct_chk', sql`coalesce(${t.fromLocationId}::text, 'main') <> coalesce(${t.toLocationId}::text, 'main')`),
]);

/* ---------------- Stock counts (попис) and write-offs (отпис) ---------------- */

/** Count line: system and counted quantity (`diff = cnt − sys`, retail price `sp` on the date); write-off line: `qty`. */
export interface StockCountLine { itemId: string; sys?: number; cnt?: number; diff?: number; sp?: number; qty?: number }

/**
 * Legacy retail-output documents `docs.type='mout'` of kind `pop` (контролен попис: shortages and surpluses) and
 * `otp` (отпис: breakage, spoilage). `kind`: `count` | `writeoff`.
 */
export const stockCounts = pgTable('stock_counts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  kind: text('kind').$type<'count' | 'writeoff'>().notNull().default('count'),
  /** `ПП-001/26` (count) / `ОТ-001/26` (write-off), legacy `moNextNo`. */
  number: text('number').notNull(),
  date: date('date').notNull(),
  locationId: location(),
  /** Debit account of shortages / write-offs (default 4690). */
  shortageAccount: text('shortage_account').notNull(),
  /** Credit account of surpluses (default 7690). */
  surplusAccount: text('surplus_account'),
  lines: jsonb('lines').$type<StockCountLine[]>().notNull().default([]),
  note: text('note'),
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('stock_counts_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('stock_counts_firm_number_uq').on(t.firmId, t.kind, t.number),
  check('stock_counts_kind_chk', sql`${t.kind} in ('count','writeoff')`),
]);

/* ---------------- Daily sales: Z / fiscal reports, POS days ---------------- */

export interface SalesGroupRow { rate: number; konto?: string; base: number; vat: number }
export interface SalesDayRow { date: string; z?: string; total: number; est?: boolean; g?: Record<string, number>; v?: Record<string, number> }
export interface SalesFiskInfo {
  device?: string; z?: string; sc?: 'trg' | 'usl' | 'trgNoVat'; cashK?: string; rev?: string; nonVat?: boolean;
  from?: string; to?: string; storno?: number; cash?: number;
  /** Goods issued for the turnover with FIFO / LIFO / proportional selection. */
  meth?: 'fifo' | 'lifo' | 'prop';
}
/** POS cart line / goods issued for a fiscal turnover. */
export interface SalesItemLine { itemId: string; qty: number; price: number; rate: number }

/**
 * Legacy `sales` (5840, 11450, 13100): one row per daily cash/POS day (`kind = 'pos'`), per manually entered
 * Z report or periodic fiscal report (`kind = 'fisk'`). Posted with `saleEntries` (POS) or `fiskEntries` (fiscal);
 * goods sold are issued as `stock_moves` (`source_type = 'sales_daily'`).
 */
export const salesDaily = pgTable('sales_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  kind: text('kind').$type<'pos' | 'fisk'>().notNull().default('fisk'),
  date: date('date').notNull(),
  locationId: location(),
  /** Z number or document number. */
  number: text('number'),
  groups: jsonb('groups').$type<SalesGroupRow[]>().notNull().default([]),
  total: money('total').notNull().default('0'),
  /** Card payments within the total. */
  card: money('card').notNull().default('0'),
  cardAccount: text('card_account'),
  /** Number of receipts. */
  count: integer('count').notNull().default(0),
  /** Macedonian-product turnover per rate `{rate: {g, v}}` (КДФИ). */
  mk: jsonb('mk').$type<Record<string, { g: number; v: number }>>(),
  /** Per-day breakdown of a periodic report (КДФИ / DFI control). */
  days: jsonb('days').$type<SalesDayRow[]>(),
  fisk: jsonb('fisk').$type<SalesFiskInfo>(),
  /** POS cart lines / goods issued for the turnover. */
  lines: jsonb('lines').$type<SalesItemLine[]>().notNull().default([]),
  note: text('note'),
  pending: boolean('pending').notNull().default(false),
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('sales_daily_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('sales_daily_pos_day_uq').on(t.firmId, sql`coalesce(${t.locationId}::text, 'main')`, t.date).where(sql`${t.kind} = 'pos'`),
  check('sales_daily_kind_chk', sql`${t.kind} in ('pos','fisk')`),
]);

/* ---------------- Production: bills of materials and work orders ---------------- */

export interface BomLine { itemId: string; qty: number }

/** Normativ (legacy `item.bom[]` + `item.labor`): one per product. */
export const boms = pgTable('boms', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  productId: uuid('product_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
  /** Labour and overhead per unit of product. */
  labor: money('labor').notNull().default('0'),
  lines: jsonb('lines').$type<BomLine[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('boms_product_uq').on(t.firmId, t.productId)]);

/** Work orders (legacy `production`, 5677): material + labour cost, receipt move `<id>` in `stock_moves`. */
export const productionOrders = pgTable('production_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmId(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  productId: uuid('product_id').notNull().references(() => items.id, { onDelete: 'restrict' }),
  qty: qty('qty').notNull(),
  locationId: location(),
  /** Material cost. */
  mat: money('mat').notNull().default('0'),
  /** Labour cost. */
  lab: money('lab').notNull().default('0'),
  unitCost: unitPrice('unit_cost'),
  /** BOM used, frozen at the time of the order. */
  bom: jsonb('bom').$type<BomLine[]>().notNull().default([]),
  note: text('note'),
  legacyId: text('legacy_id'),
  createdBy: createdBy(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('production_orders_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('production_orders_firm_number_uq').on(t.firmId, t.number),
]);

export type StockMoveRow = typeof stockMoves.$inferSelect;
export type NewStockMoveRow = typeof stockMoves.$inferInsert;
export type LevellingDocRow = typeof levellingDocs.$inferSelect;
export type TransferRow = typeof transfers.$inferSelect;
export type StockCountRow = typeof stockCounts.$inferSelect;
export type SalesDailyRow = typeof salesDaily.$inferSelect;
export type BomRow = typeof boms.$inferSelect;
export type ProductionOrderRow = typeof productionOrders.$inferSelect;
