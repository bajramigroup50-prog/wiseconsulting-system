/**
 * May this office user open `view`? The answer the menu, the route guard (`proxy.ts`) and the page itself give, in one
 * pure function — used by the tab strips of the tab-container screens (`lib/nav-hubs.ts`) and their `/ekran/<hub>`
 * address. It only ever NARROWS: every rule that refuses a view today refuses it here too.
 *  - the role's menu (`viewAllowed`, plus the codebook sub-screens of „Сите шифрарници“);
 *  - 🎭 demo users: the demo allow-list (`demoViews`);
 *  - 🔒 book-only colleagues / „Прилагодено“: their allowed views (`restrictedViews`, `null` = not restricted);
 *  - the owner-only screens (`OWNER_VIEWS`);
 *  - the permission the page checks (`officePage(view, { perm })`);
 *  - klient / teren: never (their menus are fixed; tab containers are office screens).
 */
import type { Role } from '@wise/core';
import { OWNER_VIEWS } from './nav';
import { sysViewAllowed } from './nav-system';
import { demoViews } from './route-guard';

export interface ScreenCtx {
  role: Role;
  demo: boolean;
  owner: boolean;
  /** `restrictedViews` / `myViews()`: `null` = not restricted by the book-only rule. */
  views: ReadonlySet<string> | null;
  /** `can(u.principal, perm, currentFirm)` (with the demo rule of `officePage`). */
  can: (perm: string) => boolean;
}

export function mayOpen(c: ScreenCtx, view: string, perm?: string): boolean {
  if (c.role === 'klient' || c.role === 'teren') return false;
  if (!sysViewAllowed(c.role, view)) return false;
  if (c.demo && !demoViews().has(view)) return false;
  if (c.views && !c.views.has(view)) return false;
  if (OWNER_VIEWS.includes(view) && !c.owner) return false;
  return !perm || c.can(perm);
}
