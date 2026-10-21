/**
 * 📣 Објави на мрежи – the office's settings (`app_settings` key `social`), the sealed Meta tokens and the posted log.
 * The worker job reads ONLY `law_changes` (public news) through `nextSocialNews`: nothing of the firms ever goes out.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { socialNormalize, type SocialNews, type SocialSettings } from '@wise/core/social/post';
import { appSettings, lawChanges, socialPosts } from './schema/index';
import type { Tx } from './audit';

type Q = Pick<Tx, 'select' | 'insert' | 'update'>;
export const SOCIAL_KEY = 'social';

/**
 * AES-256-GCM key for the tokens: `SOCIAL_SECRET` when set, else derived from the storage secret both the web and
 * the worker have (rotating it only means connecting Facebook again).
 */
function key(): Buffer {
  const base = process.env.SOCIAL_SECRET || process.env.S3_SECRET_KEY || '';
  if (!base) throw new Error('No key for sealing the social tokens (SOCIAL_SECRET / S3_SECRET_KEY).');
  return createHash('sha256').update('wise-social|' + base).digest();
}

/** `v1.iv.tag.body` (base64). */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

export async function getSocialSettings(tx: Q): Promise<SocialSettings> {
  const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, SOCIAL_KEY)).limit(1);
  return socialNormalize(r?.v as Partial<SocialSettings> | undefined);
}

export async function patchSocialSettings(tx: Q, p: Partial<SocialSettings>, userId: string | null): Promise<void> {
  const j = JSON.stringify(p);
  await tx.insert(appSettings).values({ key: SOCIAL_KEY, value: p, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: sql`${appSettings.value} || ${j}::jsonb`, updatedBy: userId } });
}

export type SocialNewsRow = SocialNews & { id: string };

const NEWS = {
  id: lawChanges.id, inst: lawChanges.inst, title: lawChanges.title, what: lawChanges.what, who: lawChanges.who,
  impact: lawChanges.impact, date: lawChanges.date, from: lawChanges.from, urls: lawChanges.urls,
};

/**
 * The next public news item to post: found after `since`, confirmed (`verified`) AND with its official source link
 * (`urls[0]`, the institution's page) — never one „⚠ да се потврди“ or without a source — never posted (or tried)
 * before, the oldest first. Only the public fields of `law_changes` are read.
 */
export async function nextSocialNews(tx: Q, since: string | null): Promise<SocialNewsRow | null> {
  const [r] = await tx.select(NEWS).from(lawChanges)
    .leftJoin(socialPosts, eq(socialPosts.lawId, lawChanges.id))
    .where(and(isNull(socialPosts.id), eq(lawChanges.verified, true), sql`jsonb_array_length(${lawChanges.urls}) > 0`, since ? gte(lawChanges.createdAt, new Date(since)) : undefined))
    .orderBy(asc(lawChanges.createdAt)).limit(1);
  return r ?? null;
}

/** One news item by id (a „📣 Објави сега“ from the screen) – public fields only. */
export async function socialNewsById(tx: Q, id: string): Promise<SocialNewsRow | null> {
  const [r] = await tx.select(NEWS).from(lawChanges).where(eq(lawChanges.id, id)).limit(1);
  return r ?? null;
}

export async function recordSocialPost(tx: Q, p: { lawId: string; status: 'posted' | 'partial' | 'failed'; fbPostId?: string | null; igMediaId?: string | null; igLink?: string | null; error?: string | null }): Promise<void> {
  const v = { status: p.status, fbPostId: p.fbPostId ?? null, igMediaId: p.igMediaId ?? null, igLink: p.igLink ?? null, error: p.error ? p.error.slice(0, 1000) : null, postedAt: p.status === 'failed' ? null : new Date() };
  await tx.insert(socialPosts).values({ lawId: p.lawId, ...v }).onConflictDoUpdate({ target: socialPosts.lawId, set: v });
}

/**
 * Claim one news item for posting (`pending`) – exactly once: a second click / job while it is pending or after it was
 * posted gets false. A failed (or deleted) one may be posted again.
 */
export async function claimSocialPost(tx: Q, lawId: string): Promise<boolean> {
  const r = await tx.insert(socialPosts).values({ lawId, status: 'pending' })
    .onConflictDoUpdate({ target: socialPosts.lawId, set: { status: 'pending', error: null }, setWhere: sql`${socialPosts.status} in ('failed', 'deleted')` })
    .returning({ id: socialPosts.id });
  return r.length > 0;
}

/** Posts sent today (Skopje), for the per-day limit. */
export async function socialPostsToday(tx: Q): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(socialPosts)
    .where(sql`${socialPosts.postedAt} is not null and (${socialPosts.postedAt} at time zone 'Europe/Skopje')::date = (now() at time zone 'Europe/Skopje')::date`);
  return r?.n ?? 0;
}

export async function socialPostList(tx: Q, limit = 50) {
  return tx.select({ id: socialPosts.id, lawId: socialPosts.lawId, status: socialPosts.status, fbPostId: socialPosts.fbPostId, igLink: socialPosts.igLink, error: socialPosts.error, postedAt: socialPosts.postedAt, createdAt: socialPosts.createdAt, title: lawChanges.title, inst: lawChanges.inst })
    .from(socialPosts).innerJoin(lawChanges, eq(lawChanges.id, socialPosts.lawId)).orderBy(desc(socialPosts.createdAt)).limit(limit);
}

export async function markSocialDeleted(tx: Q, id: string): Promise<void> {
  await tx.update(socialPosts).set({ status: 'deleted' }).where(eq(socialPosts.id, id));
}
