/**
 * 🔒 „Колегите гледаат само сметководство“ — the office setting and each user's views (`lib/route-guard.ts`
 * `restrictedViews`). On a given database handle and without `server-only`: `proxy.ts` (getDb) and the pages
 * (`lib/can-see.ts`) share it.
 */
import { eq } from 'drizzle-orm';
import { appSettings, users, type getDb } from '@wise/db';
import { BOOK_ONLY_KEY, bookOnlyOn, restrictedViews, type OwnerState } from './route-guard';
import { officeOwnerIn } from './office-owner-core';

type Db = Pick<ReturnType<typeof getDb>, 'select'>;
type Wr = Pick<ReturnType<typeof getDb>, 'insert'>;

/** The office setting (ON when never set). */
export async function bookOnlySetting(d: Db): Promise<boolean> {
  const [r] = await d.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, BOOK_ONLY_KEY)).limit(1);
  return bookOnlyOn(r?.v);
}

export async function putBookOnlySetting(d: Wr, on: boolean, userId: string | null): Promise<void> {
  const value = { on, at: new Date().toISOString() };
  await d.insert(appSettings).values({ key: BOOK_ONLY_KEY, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId } });
}

/**
 * Owner state of `userId` for the rule: `'unknown'` when the owner cannot be read or was never configured
 * (`officeOwner` only falls back to the earliest admin) — then the setting does not apply to admins at all.
 */
export async function ownerState(d: Db, userId: string): Promise<OwnerState> {
  try {
    const o = await officeOwnerIn(d);
    if (o?.id === userId) return 'yes';
    return !o || o.source === 'first' ? 'unknown' : 'no';
  } catch {
    return 'unknown';
  }
}

/**
 * The views `u` may open, or `null` = not restricted by this rule (owner, setting off, „Целосен пристап“, demo /
 * klient / teren with their own gates). `access`: the user's `view_access` when already loaded.
 */
export async function viewsOf(d: Db, u: { id: string; role: string; demo?: boolean | null }, access?: unknown): Promise<ReadonlySet<string> | null> {
  if (u.demo || u.role === 'klient' || u.role === 'teren') return null;
  const on = await bookOnlySetting(d).catch(() => true);
  if (!on) return null;
  const owner = await ownerState(d, u.id);
  const acc = access !== undefined ? access
    : (await d.select({ a: users.viewAccess }).from(users).where(eq(users.id, u.id)).limit(1))[0]?.a;
  return restrictedViews(u, { on, owner, access: acc });
}
