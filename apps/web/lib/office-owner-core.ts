/**
 * The office owner's resolution (`lib/office-owner.ts`), on a given database handle — no `server-only`: the proxy
 * bundle (`lib/view-access.ts`) uses it too.
 *
 * `app_settings['officeOwner'] = { id, name, at }`, set only by the current owner („Пренеси сопственост“, audited).
 * Until it is set (or when that user is no longer an active admin) the owner is the admin who claimed
 * „🔒 Мој извештај“, else the earliest-created active admin.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { appSettings, users, type getDb } from '@wise/db';

export const OFFICE_OWNER_KEY = 'officeOwner';
/** The private report's claim (`/mojIzv`), also an owner claim. */
export const MOJIZV_OWNER_KEY = 'mojIzvOwner';

export interface OfficeOwner { id: string; name: string; source: 'set' | 'mojIzv' | 'first' }
type Db = Pick<ReturnType<typeof getDb>, 'select'>;

async function activeAdmin(d: Db, id: unknown): Promise<{ id: string; name: string } | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await d.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.id, id), eq(users.active, true), eq(users.role, 'admin'), eq(users.demo, false))).limit(1);
  return u ?? null;
}

export async function officeOwnerIn(d: Db): Promise<OfficeOwner | null> {
  const S = await d.select({ k: appSettings.key, v: appSettings.value }).from(appSettings).where(inArray(appSettings.key, [OFFICE_OWNER_KEY, MOJIZV_OWNER_KEY]));
  const val = (k: string) => (S.find((r) => r.k === k)?.v as { id?: unknown } | undefined)?.id;
  const set = await activeAdmin(d, val(OFFICE_OWNER_KEY));
  if (set) return { ...set, source: 'set' };
  const mi = await activeAdmin(d, val(MOJIZV_OWNER_KEY));
  if (mi) return { ...mi, source: 'mojIzv' };
  const [first] = await d.select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.active, true), eq(users.role, 'admin'), eq(users.demo, false))).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
  return first ? { ...first, source: 'first' } : null;
}
