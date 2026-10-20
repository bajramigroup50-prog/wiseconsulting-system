/**
 * Schema — ISO квалитет of the office itself (ISO 9001 / 27001 / 10001 / 10002 / 27701 / 22301): one table for the registers
 * (поплаки, неусогласености, ризици, внатрешни проверки, обуки, инциденти, цели, политики, обработки на лични
 * податоци, барања од субјекти, DPIA, план за континуитет, тестови на враќање), the kind in `kind`,
 * the register's own fields in `data` (`@wise/core/office/iso` ISO_KINDS). Office-level; a record may name a client
 * firm (a complaint of that client).
 */
import { date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const isoRecords = pgTable('iso_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `IsoKind`: complaint | nc | risk | audit | training | incident | objective | policy | processing | dsr | dpia | bcp | bctest */
  kind: text('kind').notNull(),
  /** Serial per kind and year („ПП-3/26“). */
  no: integer('no').notNull(),
  year: integer('year').notNull(),
  title: text('title').notNull(),
  /** open | progress | done */
  status: text('status').notNull().default('open'),
  due: date('due'),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  closedAt: ts('closed_at'),
}, (t) => [index('iso_records_kind_idx').on(t.kind, t.year)]);

export type IsoRecord = typeof isoRecords.$inferSelect;
