/**
 * „🏦 Изводи од банка (автоматски)“: the office's connections to the banks (one row per bank / channel). The worker
 * `bank.feeds` fetches the new statement files every evening (SFTP host-to-host, an e-mail mailbox, or a server folder)
 * into „Пристигнати документи“ (`incoming_docs`, source `bankfeed`), matched to the firm by the account; with `hold`
 * (the default) they wait there until the office prints / checks them and approves the booking with one click.
 */
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export type BankFeedMethod = 'sftp' | 'imap' | 'folder';

export const bankFeeds = pgTable('bank_feeds', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Shown name, e.g. „Халк Банка – SFTP“. */
  name: text('name').notNull(),
  /** 3-digit bank code (270 Халк, 300 Комерцијална, 210 НЛБ …) or ''. */
  bank: text('bank').notNull().default(''),
  method: text('method').$type<BankFeedMethod>().notNull().default('sftp'),
  host: text('host').notNull().default(''),
  port: integer('port'),
  username: text('username').notNull().default(''),
  /** Remote folder (SFTP), mailbox folder (e-mail, default INBOX) or the server folder. */
  path: text('path').notNull().default(''),
  /** File names to take (`*.xml`, `*.sta;*.txt` …); '' = every statement file. */
  pattern: text('pattern').notNull().default(''),
  /** Password sealed with `sealSecret` (never shown again); null = the office SSH key (SFTP). */
  secret: text('secret'),
  /** Wait for the office's approval before booking (default) – otherwise booked right away when the firm is certain. */
  hold: boolean('hold').notNull().default(true),
  /** Time of the nightly fetch, HH:MM (Europe/Skopje). */
  at: text('at').notNull().default('20:00'),
  active: boolean('active').notNull().default(true),
  /** Remote names already taken (SFTP / folder) – the last few thousand. */
  seen: jsonb('seen').$type<string[]>().notNull().default([]),
  lastRunAt: ts('last_run_at'),
  lastOk: boolean('last_ok'),
  lastResult: text('last_result'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});
export type BankFeed = typeof bankFeeds.$inferSelect;
