import 'server-only';
/**
 * The office OWNER (сопственик на канцеларијата): the one user who sees the colleagues' productivity
 * (📊 Продуктивност на вработените, its PDF / Excel, and the per-user filter of the activity log). Not every admin.
 *
 * `app_settings['officeOwner'] = { id, name, at }`, set only by the current owner („Пренеси сопственост“, audited).
 * Until it is set (or when that user is no longer an active admin) the owner is the admin who claimed
 * „🔒 Мој извештај“, else the earliest-created active admin.
 */
import { and, asc, eq } from 'drizzle-orm';
import { appSettings, users } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';

export const OFFICE_OWNER_KEY = 'officeOwner';
/** The private report's claim (`/mojIzv`), also an owner claim. */
const MOJIZV_OWNER_KEY = 'mojIzvOwner';

export interface OfficeOwner { id: string; name: string; source: 'set' | 'mojIzv' | 'first' }

async function activeAdmin(id: unknown): Promise<{ id: string; name: string } | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await db().select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, id), eq(users.active, true), eq(users.role, 'admin'), eq(users.demo, false))).limit(1);
  return u ?? null;
}

export async function officeOwner(): Promise<OfficeOwner | null> {
  const S = await db().select({ k: appSettings.key, v: appSettings.value }).from(appSettings);
  const val = (k: string) => (S.find((r) => r.k === k)?.v as { id?: unknown } | undefined)?.id;
  const set = await activeAdmin(val(OFFICE_OWNER_KEY));
  if (set) return { ...set, source: 'set' };
  const mi = await activeAdmin(val(MOJIZV_OWNER_KEY));
  if (mi) return { ...mi, source: 'mojIzv' };
  const [first] = await db().select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.active, true), eq(users.role, 'admin'), eq(users.demo, false))).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
  return first ? { ...first, source: 'first' } : null;
}

/** Never true for a 🎭 demo user (a demo admin has its own demo-owner context, `lib/demo.ts` `isDemoOwner`). */
export const isOfficeOwner = async (u: Pick<SessionUser, 'id' | 'role'> & { demo?: boolean } | null | undefined): Promise<boolean> =>
  !!u && !u.demo && u.role === 'admin' && (await officeOwner())?.id === u.id;

export const OWNER_ONLY_MSG = 'Само за сопственикот на канцеларијата.';
