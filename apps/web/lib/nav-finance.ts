/**
 * Finance & books menu items that legacy added to `NAV` at runtime (not in the static `NAV` literal):
 * `recFree` after `kartici` (13780), `pozajmici` at the end of Финансово (16846), `efPrep` (15200, Канцеларија in legacy;
 * here in Фирми after the other all-firms checks (`mpinIn`)). The codebook screens `tarifi` / `terkovi` were opened
 * from the „Сите шифрарници“ page (legacy `data-go`), which has no route yet, so they are listed under Шифрарник.
 */
import type { NavGroup, NavItem } from './nav-data';

/** [group, anchor id (insert after; null = append), items] */
const ADD: [string, string | null, NavItem[]][] = [
  ['Финансово', 'kartici', [['recFree', '🔍 Споредба на две картици']]],
  ['Финансово', null, [['pozajmici', '🤝 Позајмици и заеми (договори)']]],
  ['Фирми', 'mpinIn', [['efPrep', '🧾 е-Фактура – подготовка']]],
  ['Шифрарник', 'konto', [['tarifi', 'Даночни тарифи'], ['terkovi', 'Теркови за книжење']]],
];

export function addFinanceNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    let L = [...items];
    for (const [grp, after, add] of ADD) {
      if (grp !== g) continue;
      const fresh = add.filter((x) => !L.some((y) => y[0] === x[0] || (y[0] === '>' && (y[2] ?? []).some((z) => z[0] === x[0]))));
      const i = after == null ? -1 : L.findIndex((x) => x[0] === after);
      // the anchor inside a submenu (Аналитика ▸ kartici): inserted there
      const j = i < 0 && after != null ? L.findIndex((x) => x[0] === '>' && (x[2] ?? []).some((z) => z[0] === after)) : -1;
      if (j >= 0) {
        const sub = [...(L[j]![2] ?? [])];
        const k = sub.findIndex((z) => z[0] === after);
        L = L.map((x, n) => (n === j ? [x[0], x[1], [...sub.slice(0, k + 1), ...fresh, ...sub.slice(k + 1)]] as NavItem : x));
      } else L = i < 0 ? [...L, ...fresh] : [...L.slice(0, i + 1), ...fresh, ...L.slice(i + 1)];
    }
    return [g, L] as NavGroup;
  });
}
