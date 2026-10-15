import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, gt, lt } from 'drizzle-orm';
import { can, type Principal } from '@wise/core';
import { demoFirmIds, demoLinks, sessions, userFirms, users, type User } from '@wise/db';
import { FIRM_CHANGED_MSG, YEAR_CHANGED_MSG } from './firm-guard';
import { db } from './db';
import { clientIp } from './login-guard';

export const SESSION_COOKIE = 'wc_sess';
/** Must match `FIRM_COOKIE` / `YEAR_COOKIE` in `lib/context.ts` (not imported: context imports this module). */
const FIRM_COOKIE = 'wc_fid';
const YEAR_COOKIE = 'wc_year';
/**
 * Session lifetime (safety: the app always starts at the login screen):
 * - the cookie is a browser-session cookie (no Expires / Max-Age) — closing the browser / desktop app ends it;
 * - idle timeout: the server-side expiry slides 60 minutes ahead of the last request;
 * - absolute limit: 8 hours after the login, whatever the activity (a restored browser session cannot live on).
 */
export const IDLE_MS = 60 * 6e4;
export const ABSOLUTE_MS = 8 * 36e5;
/** The sliding expiry is written at most once per this interval (not on every request). */
const TOUCH_MS = 5 * 6e4;

/** New expiry after activity at `now` for a session created at `createdAt`. */
export const slideExpiry = (createdAt: Date, now: number): Date => new Date(Math.min(createdAt.getTime() + ABSOLUTE_MS, now + IDLE_MS));

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export type SessionUser = Pick<User, 'id' | 'username' | 'name' | 'email' | 'role' | 'allFirms' | 'mustChangePassword'> & {
  principal: Principal;
  /** 🎭 Demo user (`users.demo`): `principal.firms` = the demo firms only, `principal.demo` set (see `lib/demo.ts`). */
  demo?: boolean;
};

/** `demoLinkId`: the session is opened by a 🔗 demo link (`app/demo/[token]`); revoking the link ends it. */
export async function createSession(userId: string, o: { demoLinkId?: string } = {}): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + IDLE_MS);
  const h = await headers();
  await db().insert(sessions).values({
    id: tokenId(token),
    userId,
    expiresAt,
    ip: clientIp((n) => h.get(n)),
    userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    demoLinkId: o.demoLinkId ?? null,
  });
  const jar = await cookies();
  // session cookie: no `expires` / `maxAge` — it ends with the browser
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  // after the login the year and the firm are chosen again (year screen → firm list), never the last ones silently
  jar.delete(FIRM_COOKIE);
  jar.delete(YEAR_COOKIE);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, tokenId(token)));
  jar.delete(SESSION_COOKIE);
  jar.delete(FIRM_COOKIE);
  jar.delete(YEAR_COOKIE);
}

export async function deleteExpiredSessions(): Promise<void> {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Current user for this request (memoised per request), or null. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = tokenId(token);
  const [row] = await db()
    .select({ u: users, exp: sessions.expiresAt, created: sessions.createdAt, link: sessions.demoLinkId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date()), gt(sessions.createdAt, new Date(Date.now() - ABSOLUTE_MS)), eq(users.active, true)))
    .limit(1);
  if (!row) return null;
  // a 🔗 demo-link session lives only while the link is valid (revoked / expired → signed out) and only for a demo user
  if (row.link) {
    const [l] = await db().select({ exp: demoLinks.expiresAt, rev: demoLinks.revokedAt, user: demoLinks.userId }).from(demoLinks).where(eq(demoLinks.id, row.link)).limit(1);
    if (!l || l.rev || l.exp.getTime() <= Date.now() || l.user !== row.u.id || !row.u.demo) return null;
  }
  // idle timeout: activity pushes the expiry (throttled), never past the absolute limit
  const now = Date.now();
  const next = slideExpiry(row.created, now);
  if (next.getTime() - row.exp.getTime() > TOUCH_MS) {
    await db().update(sessions).set({ expiresAt: next }).where(eq(sessions.id, id)).catch(() => {});
  }
  const u = row.u;
  // 🎭 a demo user: exactly the demo firms (flag + „ДЕМО“ prefix), whatever its role, user_firms or all-firms flag
  if (u.demo) {
    return {
      id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
      allFirms: false, mustChangePassword: u.mustChangePassword, demo: true,
      principal: { id: u.id, role: u.role, firms: await demoFirmIds(db()), demo: true },
    };
  }
  const firmIds = u.allFirms || u.role === 'admin'
    ? ['*']
    : (await db().select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))).map((r) => r.f);
  return {
    id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
    allFirms: u.allFirms, mustChangePassword: u.mustChangePassword,
    principal: { id: u.id, role: u.role, firms: firmIds },
  };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect('/login');
  return u;
}

export class Forbidden extends Error {
  constructor(action: string) { super(`Немате дозвола за оваа активност (${action}).`); }
}

/**
 * The page that sent the request was rendered for another firm than the current one (another tab / window switched
 * firm) — the mutation is refused (`lib/firm-guard.ts`). A `Forbidden`, so every action's error handler shows it.
 */
export class FirmChanged extends Forbidden {
  constructor() { super('firm'); this.name = 'FirmChanged'; this.message = FIRM_CHANGED_MSG; }
}

/** Same for the working year (another tab chose another year). */
export class YearChanged extends Forbidden {
  constructor() { super('year'); this.name = 'YearChanged'; this.message = YEAR_CHANGED_MSG; }
}

/** The guard used by every server action and route handler. */
export async function requireCan(action: string, firmId?: string | null): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u.principal, action, firmId)) throw new Forbidden(action);
  return u;
}
