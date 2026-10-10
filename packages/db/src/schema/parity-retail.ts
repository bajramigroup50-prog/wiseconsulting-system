/**
 * Schema — retail parity (legacy `docs.type='mout'` 5699–5788, kinds `sale` and `ret`): store sales by receipt book /
 * daily turnover per item („Продажба / парагон“) and returns to suppliers („Повратница до добавувач“). Counts and
 * write-offs of the same screen stay in `stock_counts`. A sale also books its turnover as a `sales_daily` row
 * (`sales_day_id`, kind `fisk`, scheme `trg`) so it is in КДФИ / ЕТМ; stock moves use `source_type = 'store_out'`.
 */
import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { partners } from './books';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export interface StoreOutLine { itemId: string; qty: number; price: number; rate: number; /** Line value (sale: qty × price; return: at retail price). */ val: number }

export const storeOuts = pgTable('store_outs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'sale' | 'ret'>().notNull(),
  /** `ПР-001/26` (sale) / `ПВ-001/26` (return), legacy `moNextNo`. */
  number: text('number').notNull(),
  date: date('date').notNull(),
  /** Store (`codes.id`) or null = main warehouse. */
  locationId: uuid('location_id'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  /** Supplier's document / invoice number of a return. */
  ref: text('ref'),
  /** Sale: the cash account („Наплата“). */
  account: text('account'),
  lines: jsonb('lines').$type<StoreOutLine[]>().notNull().default([]),
  note: text('note'),
  salesDayId: uuid('sales_day_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('store_outs_firm_date_idx').on(t.firmId, t.date),
  uniqueIndex('store_outs_firm_number_uq').on(t.firmId, t.kind, t.number),
  check('store_outs_kind_chk', sql`${t.kind} in ('sale','ret')`),
]);
