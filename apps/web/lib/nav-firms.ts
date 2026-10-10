/**
 * Firm / office menu items legacy added to `NAV` at runtime (not in the static `NAV` literal):
 * `opomeni` after `izlez` in Материјално (16988), `mailhist` after `opomeni` (13428), `payBatch` as the second item of
 * the Плата submenu (15280). `firmiResh` (10540) was a button on Фирми in legacy; here it is also a menu item after
 * `firmiImp` so the route guard (`viewAllowed`) knows it.
 */
import type { NavGroup, NavItem } from './nav-data';

/** [group, anchor id (insert after), items] — the anchor may be inside a submenu. */
const ADD: [string, string, NavItem[]][] = [
  ['Фирми', 'firmiImp', [['firmiResh', '📷 Нова фирма од решение']]],
  ['Материјално', 'izlez', [['opomeni', '⏰ Неплатени фактури и опомени'], ['mailhist', '📜 Историја на праќања']]],
  ['Финансово', 'plati', [['payBatch', '👥 Плати – сите фирми (автоматски)']]],
];

const has = (L: readonly NavItem[], id: string): boolean => L.some((x) => x[0] === id || (x[0] === '>' && has(x[2] ?? [], id)));

function insertAfter(L: readonly NavItem[], after: string, add: NavItem[]): NavItem[] | null {
  const i = L.findIndex((x) => x[0] === after);
  if (i >= 0) return [...L.slice(0, i + 1), ...add, ...L.slice(i + 1)];
  for (const [j, x] of L.entries()) {
    if (x[0] !== '>') continue;
    const sub = insertAfter(x[2] ?? [], after, add);
    if (sub) return [...L.slice(0, j), [x[0], x[1], sub], ...L.slice(j + 1)];
  }
  return null;
}

export function addFirmsNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    let L: readonly NavItem[] = items;
    for (const [grp, after, add] of ADD) {
      if (grp !== g) continue;
      const fresh = add.filter((x) => !has(L, x[0]));
      if (fresh.length) L = insertAfter(L, after, fresh) ?? [...L, ...fresh];
    }
    return [g, L] as NavGroup;
  });
}
