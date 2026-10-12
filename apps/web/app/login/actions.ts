'use server';
import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { audit, users } from '@wise/db';
import { hashPassword, verifyPassword } from '@wise/db/password';
import { createSession, destroySession, getUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { LOGIN_FAIL_MSG, LOGIN_LOCKED_MSG, clientIp, lockedUntil, recordFailure, resetUser } from '@/lib/login-guard';

/**
 * A real argon2 hash of a random password: unknown / inactive usernames are checked against it, so the answer takes
 * about as long as for a real account and never tells whether the username exists.
 */
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(randomBytes(24).toString('base64url')));

/**
 * Login with brute-force protection (`lib/login-guard.ts`): 5 failures for a username or 20 from an IP lock it for
 * 15 minutes. The messages are the same for unknown and existing usernames; every failure / lock is audited.
 */
export async function login(_prev: string, form: FormData): Promise<string> {
  const username = String(form.get('username') ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(form.get('password') ?? '');
  if (!username || !password) return 'Внесете корисничко име и лозинка.';
  const h = await headers();
  const ip = clientIp((n) => h.get(n));

  const [u] = await db().select().from(users).where(eq(sql`lower(${users.username})`, username)).limit(1);
  if (await lockedUntil(username, ip)) return LOGIN_LOCKED_MSG;

  const real = !!u && u.active;
  const res = await verifyPassword(real ? u.passwordHash : await dummyHash(), password, real ? u.legacySalt : null);
  if (!real || !res.ok) {
    const f = await recordFailure(username, ip);
    const data = { username, ip };
    await db().transaction(async (tx) => {
      await audit(tx, { userId: u?.id ?? null, action: 'loginFail', entityType: 'user', entityId: u?.id, data: { ...data, fails: f.userFails } });
      if (f.lockedUser) await audit(tx, { userId: u?.id ?? null, action: 'loginLocked', entityType: 'user', entityId: u?.id, data: { ...data, scope: 'user', fails: f.userFails } });
      if (f.lockedIp) await audit(tx, { userId: u?.id ?? null, action: 'loginLocked', entityType: 'user', entityId: u?.id, data: { ...data, scope: 'ip', fails: f.ipFails } });
    });
    return f.lockedUser || f.lockedIp ? LOGIN_LOCKED_MSG : LOGIN_FAIL_MSG;
  }
  await resetUser(username);

  await db().transaction(async (tx) => {
    await tx.update(users).set({
      lastLoginAt: new Date(),
      ...(res.rehash ? { passwordHash: await hashPassword(password), legacySalt: null } : {}),
    }).where(eq(users.id, u.id));
    await audit(tx, { userId: u.id, action: 'login', data: res.rehash ? { rehashed: true } : undefined });
  });
  await createSession(u.id);
  redirect(u.mustChangePassword ? '/lozinka' : '/');
}

export async function logout(): Promise<void> {
  const u = await getUser();
  if (u) await audit(db(), { userId: u.id, action: 'logout' });
  await destroySession();
  redirect('/login');
}
