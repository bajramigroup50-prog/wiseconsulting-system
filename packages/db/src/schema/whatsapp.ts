import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { files, firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * 💬 One WhatsApp message (official Cloud API) of the office number, in (`dir = 'in'`, from the webhook) or out (sent
 * from WISE). `firm_id` null = not assigned yet („Неразпоредени“): the office picks the firm and the phone is
 * remembered. `wa_id` = Meta's message id (`wamid…`, unique: a webhook delivered twice is stored once).
 * `kind` text | image | document | template | audio | video | …; `status` received | sent | delivered | read | failed.
 * An incoming file is stored like any upload (`file_id`) and put into „📥 Пристигнати документи“ (`incoming_doc_id`).
 */
export const waMessages = pgTable('wa_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  /** the WhatsApp profile name of the client (incoming) */
  name: text('name'),
  dir: text('dir').notNull(),
  waId: text('wa_id'),
  kind: text('kind').notNull().default('text'),
  body: text('body'),
  fileId: uuid('file_id').references(() => files.id, { onDelete: 'set null' }),
  fileName: text('file_name'),
  incomingDocId: uuid('incoming_doc_id'),
  /** outgoing: the template name and what the message was for (`WA_PURPOSES`) */
  template: text('template'),
  purpose: text('purpose'),
  status: text('status').notNull(),
  error: text('error'),
  /** incoming media id still to download (`wa.media`), how the firm was found, candidates… */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  statusAt: ts('status_at'),
  /** seen in WISE (incoming) */
  readAt: ts('read_at'),
}, (t) => [
  uniqueIndex('wa_messages_wa_id_uq').on(t.waId),
  index('wa_messages_firm_idx').on(t.firmId, t.createdAt),
  index('wa_messages_phone_idx').on(t.phone, t.createdAt),
]);
export type WaMessage = typeof waMessages.$inferSelect;
