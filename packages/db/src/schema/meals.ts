/**
 * Schema — „🍲 Корисници и оброци“ (module `meals`, `@wise/core/meals`): the families / persons a humanitarian
 * association feeds and the daily log of who took which meal (појадок / ручек / вечера). Personal data (ЕМБГ, social
 * situation) — only the firm's own users and the office see it; every change is audited.
 */
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';
import { partners } from './books';
import { donations } from './finance';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const mealBeneficiaries = pgTable('meal_beneficiaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  /** Number in the association's own register (Nr.). */
  no: integer('no'),
  /** Head of the family / the person. */
  name: text('name').notNull(),
  /** Members of the family (portions per meal). */
  members: integer('members').notNull().default(1),
  nationality: text('nationality'),
  embg: text('embg'),
  place: text('place'),
  phone: text('phone'),
  /** Situation / description (Përshkrimi / Gjendja). */
  note: text('note'),
  active: boolean('active').notNull().default(true),
  /** Inactive since this day (stops coming); on the daily list up to the day before. */
  inactiveFrom: date('inactive_from'),
  /** Signed consent for processing personal data (ЗЗЛП – special category: health / social data); null = без согласност. */
  consentDate: date('consent_date'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('meal_benef_firm_idx').on(t.firmId, t.active, t.name)]);

export const mealLogs = pgTable('meal_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  beneficiaryId: uuid('beneficiary_id').notNull().references(() => mealBeneficiaries.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  /** `MEALS`: b = појадок, l = ручек, d = вечера */
  meal: text('meal').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('meal_logs_one_idx').on(t.beneficiaryId, t.date, t.meal),
  index('meal_logs_firm_date_idx').on(t.firmId, t.date),
]);

/** `file_links.entity_type` of a beneficiary's scanned consent. */
export const MEAL_CONSENT_FILE_ENTITY = 'meal_consent';

/**
 * Register of the association's members and of the members of its organs (Закон за здруженија и фондации — the
 * register is kept and updated at least every 2 years).
 */
export const npoMembers = pgTable('npo_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  embg: text('embg'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  joined: date('joined'),
  left: date('left'),
  /** Organ: `NPO_ORGANS` (собрание, управен одбор, надзорен одбор…). */
  organ: text('organ'),
  /** Function in the organ (претседател, член, секретар…). */
  role: text('role'),
  note: text('note'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('npo_members_firm_idx').on(t.firmId, t.name)]);

export interface DonReceiptLine { itemId: string; qty: number; price: number; lot?: string | null; expiry?: string | null }

/**
 * Приемница of goods received as a donation in kind (food for the kitchen), linked to the donation contract. Its stock
 * moves are `stock_moves.source_type = 'don_receipt'` (lot and expiry on the move, for food-safety traceability).
 */
export const donationReceipts = pgTable('donation_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  donationId: uuid('donation_id').references(() => donations.id, { onDelete: 'set null' }),
  partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
  number: text('number').notNull(),
  date: date('date').notNull(),
  /** Warehouse (`codes` row); null = main. */
  locationId: uuid('location_id'),
  /** Counter account of the posting (donation income); empty = no posting. */
  account: text('account'),
  note: text('note'),
  lines: jsonb('lines').$type<DonReceiptLine[]>().notNull().default([]),
  total: numeric('total', { precision: 16, scale: 2 }).notNull().default('0'),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('don_receipts_firm_idx').on(t.firmId, t.date), index('don_receipts_don_idx').on(t.donationId)]);

export type NpoMemberRow = typeof npoMembers.$inferSelect;
export type DonationReceiptRow = typeof donationReceipts.$inferSelect;
export type MealBeneficiaryRow = typeof mealBeneficiaries.$inferSelect;
export type MealLogRow = typeof mealLogs.$inferSelect;
