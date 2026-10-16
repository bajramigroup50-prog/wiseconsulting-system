/**
 * P40 „Мени: класично / ново“ — per user (UX Phase 1, `lib/nav-new.ts`). Stored in `app_settings` under
 * `menuStyle:<userId>` (`{ style }`), so no migration is needed and `users.view_access` (the access rules) is never
 * touched. Default for everybody: „ново“. Set by the office owner for anyone (Корисници) and by each user for
 * themselves (/lozinka). Only the menu changes: the access rules are the same in both menus.
 */
import { eq, like } from 'drizzle-orm';
import { appSettings, type getDb } from '@wise/db';

export type MenuStyle = 'classic' | 'new';
export const MENU_STYLE_LBL: Record<MenuStyle, string> = { classic: 'класично', new: 'ново' };

export const menuStyleKey = (userId: string) => `menuStyle:${userId}`;
/** Anything but an explicit „класично“ is „ново“ (the default). */
export const menuStyleClean = (v: unknown): MenuStyle =>
  (v && typeof v === 'object' && (v as { style?: unknown }).style === 'classic' ? 'classic' : 'new');
export const menuStyleIn = (v: unknown): MenuStyle | null => (v === 'classic' || v === 'new' ? v : null);

type Db = Pick<ReturnType<typeof getDb>, 'select'>;
type Wr = Pick<ReturnType<typeof getDb>, 'insert'>;

export async function menuStyleOf(d: Db, userId: string): Promise<MenuStyle> {
  const [r] = await d.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, menuStyleKey(userId))).limit(1);
  return menuStyleClean(r?.v);
}

/** Every user's style at once (Корисници): userId → style (missing = „ново“). */
export async function menuStyles(d: Db): Promise<Map<string, MenuStyle>> {
  const R = await d.select({ k: appSettings.key, v: appSettings.value }).from(appSettings).where(like(appSettings.key, 'menuStyle:%'));
  return new Map(R.filter((r) => r.k.startsWith('menuStyle:')).map((r) => [r.k.slice('menuStyle:'.length), menuStyleClean(r.v)]));
}

export async function putMenuStyle(d: Wr, userId: string, style: MenuStyle, by: string | null): Promise<void> {
  const value = { style, at: new Date().toISOString() };
  await d.insert(appSettings).values({ key: menuStyleKey(userId), value, updatedBy: by })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: by } });
}
