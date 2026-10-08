/**
 * Schema — outgoing e-mail log (Phase 6 owns the shared mail infrastructure; legacy Gmail MCP sends had no log
 * beyond `auditLog`). Every message enqueued through `mail.send` gets one row; the worker updates its status.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const MAIL_STATUS = ['queued', 'sent', 'failed'] as const;
export type MailStatus = (typeof MAIL_STATUS)[number];

export const mailLog = pgTable('mail_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  firmId: uuid('firm_id').references(() => firms.id, { onDelete: 'set null' }),
  to: jsonb('to').$type<string[]>().notNull(),
  subject: text('subject').notNull(),
  html: text('html').notNull(),
  /** `files.id` values attached to the message (loaded from MinIO by the worker). */
  attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
  status: text('status').$type<MailStatus>().notNull().default('queued'),
  error: text('error'),
  /** SMTP message id returned by the server. */
  messageId: text('message_id'),
  attempts: integer('attempts').notNull().default(0),
  /** What the message is about, e.g. (`payroll_emp`, <uuid>). */
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
}, (t) => [
  index('mail_log_firm_created_idx').on(t.firmId, t.createdAt),
  index('mail_log_entity_idx').on(t.entityType, t.entityId),
  check('mail_log_status_chk', sql`${t.status} in ('queued','sent','failed')`),
]);

export type MailLog = typeof mailLog.$inferSelect;
