/**
 * AI reads of a document that fills a record (`kind`): `travel` = a travel order (патен налог) a transport client made
 * itself → driver, vehicle, countries with border times → a tour with per diems (`frDnev`); `tripcost` = road-expense receipts (any country) of a trip (`refId` = the tour). The worker job
 * `ai.read-doc` writes `result`; `refId` = the record made from it.
 */
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const docReads = pgTable('doc_reads', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'travel' | 'tripcost' | 'tripbundle'>().notNull(),
  fileIds: uuid('file_ids').array().notNull(),
  status: text('status').$type<'queued' | 'reading' | 'done' | 'error' | 'used'>().notNull().default('queued'),
  result: jsonb('result').$type<Record<string, unknown>>(),
  model: text('model'),
  error: text('error'),
  refId: uuid('ref_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});
export type DocRead = typeof docReads.$inferSelect;
