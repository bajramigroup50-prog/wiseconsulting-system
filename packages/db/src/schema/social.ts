import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { lawChanges } from './law';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

/**
 * 📣 One news item posted (or tried) to the office's Facebook page / Instagram by the worker: a law news item
 * (`law_id`, `social.post`) or a website news item (`news_url` + its title / institution, `social.web`).
 * One row per news item: it is never posted twice. `skipped` = already on the site when the website news were switched on.
 */
export const socialPosts = pgTable('social_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  lawId: uuid('law_id').references(() => lawChanges.id, { onDelete: 'cascade' }),
  newsUrl: text('news_url'),
  newsTitle: text('news_title'),
  newsInst: text('news_inst'),
  status: text('status').$type<'pending' | 'posted' | 'partial' | 'failed' | 'deleted' | 'skipped'>().notNull(),
  fbPostId: text('fb_post_id'),
  igMediaId: text('ig_media_id'),
  igLink: text('ig_link'),
  error: text('error'),
  postedAt: ts('posted_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('social_posts_law_uq').on(t.lawId), uniqueIndex('social_posts_news_uq').on(t.newsUrl), index('social_posts_created_idx').on(t.createdAt)]);

export type SocialPostRow = typeof socialPosts.$inferSelect;
