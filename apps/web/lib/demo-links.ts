import 'server-only';
/**
 * 🔗 Demo links (`demo_links`): the owner creates a link `https://…/demo/<token>` (≥ 32 random bytes, only its sha256
 * is stored) with an expiry (1 / 3 / 7 / 30 days) and a note; opening it creates a normal session of the demo user
 * (`sessions.demo_link_id`, every demo restriction applies) and goes to the demo dashboard. Revoking ends the link
 * and every session it started. The token is accepted ONLY by `app/demo/[token]/route.ts` (rate-limited per IP).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DEMO_LINK_DAYS, demoLinkState, isDemoFirm, isDemoToken } from '@wise/core/demo';
import { appSettings, audit, demoFirmSql, demoLinks, firms, sessions, users, type DemoLink } from '@wise/db';
import { db } from './db';

export const demoTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/* ---------- rate limit of /demo (per IP, `app_settings` like the login locks) ---------- */

export const DEMO_RATE_MAX = 10;
export const DEMO_RATE_WINDOW_MS = 15 * 6e4;
export interface RateState { n: number; first: number }
/** Pure: the next state for one more request at `now`, and whether it is allowed. */
export function demoRateNext(old: RateState | null | undefined, now: number, max = DEMO_RATE_MAX, win = DEMO_RATE_WINDOW_MS): { s: RateState; ok: boolean } {
  const fresh = !old || !(old.n > 0) || now - old.first > win;
  const s = fresh ? { n: 1, first: now } : { n: old.n + 1, first: old.first };
  return { s, ok: s.n <= max };
}
const rateKey = (ip: string) => `demoRate:${ip.slice(0, 80)}`;

/** Counts one /demo request of this IP; false when over the limit (10 per 15 minutes). */
export async function demoRateHit(ip: string, now = Date.now()): Promise<boolean> {
  const key = rateKey(ip || '?');
  return db().transaction(async (tx) => {
    await tx.insert(appSettings).values({ key, value: { n: 0, first: now } }).onConflictDoNothing();
    const [r] = await tx.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).for('update');
    const { s, ok } = demoRateNext(r?.v as RateState | undefined, now);
    await tx.update(appSettings).set({ value: s }).where(eq(appSettings.key, key));
    return ok;
  });
}

/* ---------- links ---------- */

/** The demo ADMIN a link signs in as: the active demo user `demo` (else the first active demo admin). */
export async function demoAdminUser(): Promise<{ id: string; username: string } | null> {
  const R = await db().select({ id: users.id, username: users.username }).from(users)
    .where(and(eq(users.demo, true), eq(users.active, true), eq(users.role, 'admin'))).orderBy(asc(users.createdAt));
  return R.find((u) => u.username === 'demo') ?? R[0] ?? null;
}

/** Creates a link; returns the raw token ONCE (never stored, never logged). */
export async function createDemoLink(o: { days: number; note: string | null; createdBy: string }): Promise<{ token: string; id: string; expiresAt: Date }> {
  if (!(DEMO_LINK_DAYS as readonly number[]).includes(o.days)) throw new Error('Неважечко траење.');
  const u = await demoAdminUser();
  if (!u) throw new Error('Нема демо корисник – прво „🎭 Креирај демо фирми“.');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + o.days * 864e5);
  const id = await db().transaction(async (tx) => {
    const [l] = await tx.insert(demoLinks).values({ tokenHash: demoTokenHash(token), userId: u.id, note: o.note, expiresAt, createdBy: o.createdBy }).returning({ id: demoLinks.id });
    await audit(tx, { userId: o.createdBy, action: 'demoLinkNew', entityType: 'demo_link', entityId: l!.id, data: { days: o.days, note: o.note } });
    return l!.id;
  });
  return { token, id, expiresAt };
}

/** Revokes a link at once and ends every session it started. */
export async function revokeDemoLink(id: string, by: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [l] = await tx.update(demoLinks).set({ revokedAt: new Date() }).where(and(eq(demoLinks.id, id), sql`${demoLinks.revokedAt} is null`)).returning({ id: demoLinks.id });
    if (!l) return false;
    await tx.delete(sessions).where(eq(sessions.demoLinkId, id));
    await audit(tx, { userId: by, action: 'demoLinkRevoke', entityType: 'demo_link', entityId: id });
    return true;
  });
}

export async function listDemoLinks(): Promise<DemoLink[]> {
  return db().select().from(demoLinks).orderBy(desc(demoLinks.createdAt)).limit(100);
}

/**
 * The link of a token, if it is usable: known (by hash), not revoked, not expired, and its user is an active DEMO user.
 * Anything else → null (the caller shows the same neutral page for every case).
 */
export async function usableDemoLink(token: unknown, now = Date.now()): Promise<{ id: string; userId: string } | null> {
  if (!isDemoToken(token)) return null;
  const [r] = await db().select({ l: demoLinks, demo: users.demo, active: users.active }).from(demoLinks)
    .innerJoin(users, eq(users.id, demoLinks.userId)).where(eq(demoLinks.tokenHash, demoTokenHash(token))).limit(1);
  if (!r || !r.demo || !r.active || demoLinkState(r.l, now) !== 'ok') return null;
  return { id: r.l.id, userId: r.l.userId };
}

/** After a successful open: counters + audit. */
export async function noteDemoLinkUse(id: string, userId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.update(demoLinks).set({ lastUsedAt: new Date(), uses: sql`${demoLinks.uses} + 1` }).where(eq(demoLinks.id, id));
    await audit(tx, { userId, action: 'demoLinkOpen', entityType: 'demo_link', entityId: id });
  });
}

/** The first demo firm (the dashboard a link opens on). */
export async function firstDemoFirm(): Promise<string | null> {
  const R = await db().select({ id: firms.id, name: firms.name, settings: firms.settings }).from(firms).where(and(eq(firms.active, true), demoFirmSql)).orderBy(asc(firms.name));
  return R.find((f) => isDemoFirm(f) && !(f.settings as { demoOffice?: boolean }).demoOffice)?.id ?? null;
}
