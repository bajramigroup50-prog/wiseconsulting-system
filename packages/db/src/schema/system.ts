/**
 * Schema — system screens: the error register (legacy `apperrors` collection, `errLog` 17460 / `VIEWS.greski` 17472).
 * Rows are written by the browser error boundary (`/api/errors`) and by the server (`instrumentation.ts`
 * `onRequestError`). The firm is kept as plain text (`firm_ref` / `firm_name`), not as a firm foreign key: errors are
 * office data, not part of a firm's backup.
 */
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const appErrors = pgTable('app_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  at: ts('at').notNull().defaultNow(),
  /** Last time the same error (same message, source and screen) was seen; `count` how many times. */
  lastAt: ts('last_at').notNull().defaultNow(),
  count: integer('count').notNull().default(1),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name'),
  role: text('role'),
  firmRef: text('firm_ref'),
  firmName: text('firm_name'),
  /** Screen (legacy `view`), e.g. `/nalozi`. */
  view: text('view'),
  /** `render` (browser), `server` (request), `action`, … (legacy `src`). */
  src: text('src').notNull(),
  msg: text('msg').notNull(),
  stack: text('stack'),
  digest: text('digest'),
  ver: text('ver'),
  ua: text('ua'),
  fixed: boolean('fixed').notNull().default(false),
  fixedAt: ts('fixed_at'),
  fixedBy: uuid('fixed_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  index('app_errors_at_idx').on(t.at),
  index('app_errors_fixed_idx').on(t.fixed, t.lastAt),
]);

export type AppError = typeof appErrors.$inferSelect;
