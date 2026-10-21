import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { lawChanges } from './law';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

/**
 * 📣 One law news item posted (or tried) to the office's Facebook page / Instagram by the worker (`social.post`).
 * One row per news item: it is never posted twice.
 */
export const socialPosts = pgTable('social_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  lawId: uuid('law_id').notNull().references(() => lawChanges.id, { onDelete: 'cascade' }),
  status: text('status').$type<'pending' | 'posted' | 'partial' | 'failed' | 'deleted'>().notNull(),
  fbPostId: text('fb_post_id'),
  igMediaId: text('ig_media_id'),
  igLink: text('ig_link'),
  error: text('error'),
  postedAt: ts('posted_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('social_posts_law_uq').on(t.lawId), index('social_posts_created_idx').on(t.createdAt)]);

export type SocialPostRow = typeof socialPosts.$inferSelect;
