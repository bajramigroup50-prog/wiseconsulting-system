/**
 * Stock & retail menu items legacy reached outside the static `NAV`: `rasNorm` (inserted after `prod` at runtime 13897,
 * later a tab of Работни налози) and `uslugiS` (Шифрарник hub 6984, Услуги).
 */
import type { NavGroup, NavItem } from './nav-data';

/** [group, anchor id inside the group or a submenu (insert after), item] */
const ADD: [string, string, NavItem][] = [
  ['Материјално', 'prod', ['rasNorm', '📦 Раздолжување без норматив']],
  ['Шифрарник', 'artikli', ['uslugiS', 'Услуги']],
];

function insert(items: readonly NavItem[], after: string, add: NavItem): { L: NavItem[]; done: boolean } {
  const L: NavItem[] = [];
  let done = false;
  for (const it of items) {
    if (it[0] === '>' && !done) {
      const r = insert(it[2] ?? [], after, add);
      done = r.done;
      L.push([it[0], it[1], r.L]);
      continue;
    }
    L.push(it);
    if (!done && it[0] === after) { L.push(add); done = true; }
  }
  return { L, done };
}

export function addRetailNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  const all = new Set<string>();
  const walk = (it: readonly NavItem[]): void => { for (const x of it) { all.add(x[0]); if (x[2]) walk(x[2]); } };
  for (const [, it] of nav) walk(it);
  return nav.map(([g, items]) => {
    let L = [...items];
    for (const [grp, after, add] of ADD) {
      if (grp !== g || all.has(add[0])) continue;
      const r = insert(L, after, add);
      L = r.done ? r.L : [...L, add];
    }
    return [g, L] as NavGroup;
  });
}
