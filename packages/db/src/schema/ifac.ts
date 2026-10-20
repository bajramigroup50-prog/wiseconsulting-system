/**
 * Schema — IFAC standards of the office per client firm (`@wise/core/office/ifac`): the ISRS 4410 engagement letter
 * and the ISQM 1 quality checklist per firm and year, the IESBA ethics declaration per employee and year. One row per
 * kind × year × subject (the firm, or the user for a declaration); the kind's own fields in `data`.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const ifacRecords = pgTable('ifac_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `IfacKind`: letter | qc | ethics */
  kind: text('kind').notNull(),
  year: integer('year').notNull(),
  /** The firm (letter, qc) or the user (ethics) – the key of the row with kind and year. */
  subject: uuid('subject').notNull(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Letter serial per year („ПА-001/2026“). */
  no: integer('no'),
  /** letter: draft | signed · qc: open | accepted | reviewed · ethics: signed */
  status: text('status').notNull().default('draft'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex('ifac_records_key_uq').on(t.kind, t.year, t.subject), index('ifac_records_firm_idx').on(t.firmId)]);

export type IfacRecord = typeof ifacRecords.$inferSelect;
