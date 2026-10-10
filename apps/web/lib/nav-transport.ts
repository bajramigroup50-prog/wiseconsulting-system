/**
 * Menu items legacy added at runtime to the freight block (14651 `frGor` after the per diems, 14690 `frFak` after the
 * tours). The auto-service and `pnLive` items are already in the legacy `NAV` (`nav-data.ts`).
 */
import type { NavGroup, NavItem } from './nav-data';

const AFTER: readonly (readonly [string, NavItem])[] = [['frTuri', ['frFak', '🧾 Фактури за превоз']], ['frDnev', ['frGor', '⛽ Картички за гориво']]];

function insert(items: readonly NavItem[]): NavItem[] {
  const L: NavItem[] = items.map((x) => (x[0] === '>' ? ['>', x[1], insert(x[2] ?? [])] as NavItem : x));
  for (const [after, it] of AFTER) {
    if (L.some((x) => x[0] === it[0])) continue;
    const i = L.findIndex((x) => x[0] === after);
    if (i >= 0) L.splice(i + 1, 0, it);
  }
  return L;
}

/** Add `frFak` and `frGor` next to the freight views (run after `addIndustryNav`). */
export const addTransportNav = (nav: readonly NavGroup[]): readonly NavGroup[] => nav.map(([g, items]) => [g, insert(items)] as NavGroup);
