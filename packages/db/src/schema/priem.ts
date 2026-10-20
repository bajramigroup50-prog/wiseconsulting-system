import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { PriemItem } from '@wise/core/office/priem';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * 📥 Прием на документи: one batch of documents a client brought to the office – the office's деловодник book 01,
 * numbered from 1 each year for the whole office (`no` unique per `year`).
 */
export const docReceipts = pgTable('doc_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  year: integer('year').notNull(),
  no: integer('no').notNull(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'restrict' }),
  /** Period of the documents (YYYY-MM). */
  period: text('period').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  /** Who brought them (client side). */
  broughtBy: text('brought_by'),
  receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
  items: jsonb('items').$type<PriemItem[]>().notNull().default([]),
  note: text('note'),
  keepUntil: date('keep_until'),
  /** Originals to be returned by. */
  returnDue: date('return_due'),
  returnedAt: ts('returned_at'),
  returnedBy: uuid('returned_by').references(() => users.id, { onDelete: 'set null' }),
  returnedTo: text('returned_to'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('doc_receipts_year_no_uq').on(t.year, t.no), index('doc_receipts_firm_idx').on(t.firmId, t.receivedAt)]);

export type DocReceiptRow = typeof docReceipts.$inferSelect;
