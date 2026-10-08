import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, gt, lt } from 'drizzle-orm';
import { can, type Principal } from '@wise/core';
import { sessions, userFirms, users, type User } from '@wise/db';
import { db } from './db';

export const SESSION_COOKIE = 'wc_sess';
/** Legacy: 30 days with "remember me", otherwise half a day. */
const LONG_MS = 30 * 864e5;
const SHORT_MS = 0.5 * 864e5;

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export type SessionUser = Pick<User, 'id' | 'username' | 'name' | 'email' | 'role' | 'allFirms' | 'mustChangePassword'> & {
  principal: Principal;
};

export async function createSession(userId: string, remember: boolean): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (remember ? LONG_MS : SHORT_MS));
  const h = await headers();
  await db().insert(sessions).values({
    id: tokenId(token),
    userId,
    expiresAt,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(remember ? { expires: expiresAt } : {}),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, tokenId(token)));
  jar.delete(SESSION_COOKIE);
}

export async function deleteExpiredSessions(): Promise<void> {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Current user for this request (memoised per request), or null. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenId(token)), gt(sessions.expiresAt, new Date()), eq(users.active, true)))
    .limit(1);
  if (!row) return null;
  const u = row.u;
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

/** The guard used by every server action and route handler. */
export async function requireCan(action: string, firmId?: string | null): Promise<SessionUser> {
  const u = await requireUser();
  if (!can(u.principal, action, firmId)) throw new Forbidden(action);
  return u;
}
