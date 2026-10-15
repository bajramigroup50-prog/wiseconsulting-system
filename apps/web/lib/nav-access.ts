/**
 * 🔒 „Пристап до менија“ → „Прилагодено“ (Корисници, owner only): the views the owner can tick per colleague, by menu
 * group, built from the menu (`lib/nav.ts`), plus the screens that are opened only from other screens („Без мени“).
 * The owner-only screens (`OWNER_VIEWS`) are never grantable (their pages check the owner themselves) and
 * `BOOK_ALWAYS_VIEWS` are always on.
 */
import { NAV, OWNER_VIEWS, navFlat } from './nav';
import { sysLabel } from './nav-system';
import { BOOK_ALWAYS_VIEWS, BOOK_ONLY_VIEWS } from './route-guard';

/** Screens without their own menu item that the owner may still grant (year-end phases, client HR contracts…). */
const EXTRA_GRANTABLE: readonly string[] = [
  'klDogovori', 'mailhist', 'prenos', 'mbyllja', 'vjetore', 'zsBel', 'zsKontrola', 'zsXml',
  'zs_aop', 'zs_bs', 'zs_bu', 'zs_db', 'zs_de', 'zs_pr', 'zs_skr', 'zs_sp', 'zs_vp',
];

export interface AccessGroup { g: string; items: (readonly [string, string])[] }

export function accessGroups(): AccessGroup[] {
  const skip = new Set(['home', ...OWNER_VIEWS, ...BOOK_ALWAYS_VIEWS]);
  const seen = new Set<string>();
  const out: AccessGroup[] = [];
  for (const [g, L] of NAV) {
    const items = navFlat(L).filter(([id]) => !skip.has(id) && !seen.has(id));
    for (const [id] of items) seen.add(id);
    if (items.length) out.push({ g, items });
  }
  const rest = [...new Set([...BOOK_ONLY_VIEWS, ...EXTRA_GRANTABLE])].filter((id) => !skip.has(id) && !seen.has(id));
  if (rest.length) out.push({ g: 'Без мени (екрани што се отвораат од други екрани)', items: rest.map((id) => [id, sysLabel(id)] as const) });
  return out;
}

export const grantableViews = (): ReadonlySet<string> => new Set(accessGroups().flatMap((x) => x.items.map(([id]) => id)));
