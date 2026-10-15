/**
 * Schema — 🎭 demo links (`@wise/core/demo`): the owner's „🔗 Нов демо линк“. Only the sha256 of the token is stored;
 * opening `/demo/<token>` signs in as the demo user (a normal session with `sessions.demo_link_id`), never anything else.
 */
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './foundation';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const demoLinks = pgTable('demo_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** sha256 (hex) of the token — the raw token is shown once to the owner and never stored. */
  tokenHash: text('token_hash').notNull(),
  /** The demo user the link signs in as. */
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  note: text('note'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  uses: integer('uses').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('demo_links_hash_uq').on(t.tokenHash), index('demo_links_user_idx').on(t.userId)]);

export type DemoLink = typeof demoLinks.$inferSelect;
