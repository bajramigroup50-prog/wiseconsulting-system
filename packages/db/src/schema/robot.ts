/**
 * Schema — 🤖 WISE Робот: chat history per user and firm, and the drafts (proposals) the robot prepared.
 *
 * A `robot_messages` row is one turn: the user's question (`role = user`) or the robot's answer (`role = assistant`,
 * `status` queued → running → done / error, answered by the worker job `robot.ask` or at once by the free router).
 * `robot_proposals` holds a draft (journal, opomena, task, reminder) with its payload; nothing is executed until the
 * human confirms it in the web app, which then calls the module's existing server action (normal validation + audit).
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { firms, users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export interface RobotSource { label: string; href: string; tool?: string }
export interface RobotToolCall { name: string; ok: boolean; ms?: number; summary?: string }

export const robotMessages = pgTable('robot_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  text: text('text').notNull().default(''),
  /** `queued` | `running` | `done` | `error` (assistant rows; user rows are `done`). */
  status: text('status').$type<'queued' | 'running' | 'done' | 'error'>().notNull().default('done'),
  /** „Длабока анализа“ — the only way the deep (Opus-class) tier is used. */
  deep: boolean('deep').notNull().default(false),
  /** Answered by the free keyword router (no model call). */
  free: boolean('free').notNull().default(false),
  /** The question this answer belongs to. */
  replyTo: uuid('reply_to'),
  tools: jsonb('tools').$type<RobotToolCall[]>().notNull().default([]),
  sources: jsonb('sources').$type<RobotSource[]>().notNull().default([]),
  /** Amounts in the answer that no tool returned (shown as a warning). */
  unverified: jsonb('unverified').$type<string[]>().notNull().default([]),
  model: text('model'),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  error: text('error'),
  /** „🗑 Нов разговор“ hides older turns (kept for the record). */
  archived: boolean('archived').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [index('robot_messages_user_firm_idx').on(t.userId, t.firmId, t.createdAt)]);

export type RobotProposalKind = 'journal' | 'dunning' | 'task' | 'reminder';

export const robotProposals = pgTable('robot_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  firmId: uuid('firm_id').notNull().references(() => firms.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  /** The assistant message that produced it (set when the answer is stored). */
  messageId: uuid('message_id'),
  kind: text('kind').$type<RobotProposalKind>().notNull(),
  title: text('title').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  /** `open` | `confirmed` | `cancelled` | `failed` */
  status: text('status').$type<'open' | 'confirmed' | 'cancelled' | 'failed'>().notNull().default('open'),
  result: text('result'),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('robot_proposals_msg_idx').on(t.messageId),
  index('robot_proposals_firm_idx').on(t.firmId, t.status),
  index('robot_proposals_open_idx').on(t.userId).where(sql`${t.status} = 'open'`),
]);

export type RobotMessage = typeof robotMessages.$inferSelect;
export type RobotProposal = typeof robotProposals.$inferSelect;
