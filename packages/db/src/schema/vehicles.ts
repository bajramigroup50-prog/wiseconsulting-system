/**
 * Schema — auto service (legacy `docs` types `cveh` and `wo`, 9633–9746) and live vehicle positions of travel orders
 * (legacy `pnal.pos` / `pnal.track`, 9440).
 *
 * Work orders are invoiced through the Phase 3 invoice service (`invoice_id`, set null when the invoice is deleted);
 * the invoice issues the parts from stock. Parts and labour lines are JSON (`@wise/core` `WoPart`, `WoLabour`).
 * Module configuration (labour-hour price, service intervals) lives in `firms.settings.industry.auto`.
 */
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { partners } from './books';
import { invoices } from './sales';
import { employees } from './payroll';
import { travelOrders } from './industry';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date());
const firmFk = () => uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' });

export interface WorkOrderPart { itemId?: string | null; name: string; qty: number; price: number; disc?: number | null; rate: number }
export interface WorkOrderLabour { itemId?: string | null; name: string; hrs: number; price: number; rate: number }

/** Customers' vehicles (legacy `cveh`): plate and/or VIN, owner, last known km, last reminder contact. */
export const customerVehicles = pgTable('customer_vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  plate: text('plate'),
  vin: text('vin'),
  make: text('make'),
  model: text('model'),
  year: integer('year'),
  engine: text('engine'),
  fuel: text('fuel'),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'restrict' }),
  km: integer('km'),
  note: text('note'),
  /** Legacy `remindAt`: owner contacted about the next service (hidden from the reminders for 30 days). */
  remindAt: date('remind_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('customer_vehicles_firm_idx').on(t.firmId, t.plate),
  uniqueIndex('customer_vehicles_plate_uq').on(t.firmId, sql`upper(${t.plate})`).where(sql`${t.plate} is not null and ${t.plate} <> ''`),
]);

/** Service work orders (legacy `wo`, numbered `РН-001/2026`). */
export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  number: text('number').notNull(),
  date: date('date').notNull(),
  vehicleId: uuid('vehicle_id').notNull().references(() => customerVehicles.id, { onDelete: 'restrict' }),
  plate: text('plate'),
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
  km: integer('km'),
  complaint: text('complaint'),
  work: text('work'),
  parts: jsonb('parts').$type<WorkOrderPart[]>().notNull().default([]),
  labour: jsonb('labour').$type<WorkOrderLabour[]>().notNull().default([]),
  status: text('status').$type<'open' | 'work' | 'done'>().notNull().default('open'),
  mechanicId: uuid('mechanic_id').references(() => employees.id, { onDelete: 'set null' }),
  /** Next service (reminder): at km and/or by date, what. */
  nextKm: integer('next_km'),
  nextDate: date('next_date'),
  nextNote: text('next_note'),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('work_orders_firm_date_idx').on(t.firmId, t.date),
  index('work_orders_vehicle_idx').on(t.vehicleId),
  uniqueIndex('work_orders_number_uq').on(t.firmId, t.number),
  check('work_orders_status_chk', sql`${t.status} in ('open','work','done')`),
]);

/**
 * Positions sent by the driver's phone while a travel order is on the road (legacy `x.pos` + `x.track`, last 400
 * points per order). The latest row is the vehicle's current position on `pnLive`.
 */
export const travelPositions = pgTable('travel_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: firmFk(),
  orderId: uuid('order_id').notNull().references(() => travelOrders.id, { onDelete: 'cascade' }),
  lat: numeric('lat', { precision: 9, scale: 6 }).notNull(),
  lon: numeric('lon', { precision: 9, scale: 6 }).notNull(),
  /** Accuracy in metres, speed in km/h. */
  acc: integer('acc'),
  spd: integer('spd'),
  at: ts('at').notNull(),
  createdAt: createdAt(),
}, (t) => [index('travel_positions_order_at_idx').on(t.orderId, t.at), index('travel_positions_firm_idx').on(t.firmId, t.at)]);

export type CustomerVehicle = typeof customerVehicles.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type TravelPosition = typeof travelPositions.$inferSelect;
