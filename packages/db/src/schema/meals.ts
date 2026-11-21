/**
 * Schema — „🍲 Корисници и оброци“ (module `meals`, `@wise/core/meals`): the families / persons a humanitarian
 * association feeds and the daily log of who took which meal (појадок / ручек / вечера). Personal data (ЕМБГ, social
 * situation) — only the firm's own users and the office see it; every change is audited.
 */
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

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

export type MealBeneficiaryRow = typeof mealBeneficiaries.$inferSelect;
export type MealLogRow = typeof mealLogs.$inferSelect;
