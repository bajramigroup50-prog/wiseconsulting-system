'use server';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { audit, users } from '@wise/db';
import { hashPassword, verifyPassword } from '@wise/db/password';
import { createSession, destroySession, getUser } from '@/lib/auth';
import { db } from '@/lib/db';

/** Per-username failure counter → growing delay, as in legacy (400 ms × fails, max 4 s). */
const fails = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function login(_prev: string, form: FormData): Promise<string> {
  const username = String(form.get('username') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  if (!username || !password) return 'Внесете корисничко име и лозинка.';

  const [u] = await db().select().from(users).where(eq(sql`lower(${users.username})`, username)).limit(1);
  const res = u && u.active ? await verifyPassword(u.passwordHash, password, u.legacySalt) : { ok: false, rehash: false };
  if (!u || !res.ok) {
    const n = (fails.get(username) ?? 0) + 1;
    fails.set(username, n);
    await sleep(Math.min(4000, 400 * n));
    return 'Погрешно корисничко име или лозинка.';
  }
  fails.delete(username);

  await db().transaction(async (tx) => {
    await tx.update(users).set({
      lastLoginAt: new Date(),
      ...(res.rehash ? { passwordHash: await hashPassword(password), legacySalt: null } : {}),
    }).where(eq(users.id, u.id));
    await audit(tx, { userId: u.id, action: 'login', data: res.rehash ? { rehashed: true } : undefined });
  });
  await createSession(u.id, form.get('remember') === 'on');
  redirect(u.mustChangePassword ? '/lozinka' : '/');
}

export async function logout(): Promise<void> {
  const u = await getUser();
  if (u) await audit(db(), { userId: u.id, action: 'logout' });
  await destroySession();
  redirect('/login');
}
