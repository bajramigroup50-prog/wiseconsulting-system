/**
 * Phase 9 menu items that legacy added to `NAV` at runtime (not in the static `NAV` literal):
 * `zzlp` (15362), `aml` (15974), `tpl` (16198), `autop` (16352, unshift into Канцеларија),
 * `insp` (16569, into Фирми). FIX(#12): inserted by group and anchor id, not by a fixed index.
 */
import type { NavGroup, NavItem } from './nav-data';

/** [group, anchor id (insert after; null = first), items] */
const ADD: [string, string | null, NavItem[]][] = [
  ['Канцеларија', null, [['autop', '🤖 Автопилот']]],
  ['Канцеларија', 'osnovanje', [['tpl', '📄 Шаблони'], ['aml', '🛡 Спречување перење пари (УФР)'], ['zzlp', '🔐 Заштита на лични податоци (ЗЗЛП)']]],
  ['Фирми', 'zatvoranje', [['insp', '🕵 Подготвеност за инспекција']]],
];

export function addOfficeNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    let L = [...items];
    for (const [grp, after, add] of ADD) {
      if (grp !== g) continue;
      const fresh = add.filter((x) => !L.some((y) => y[0] === x[0]));
      const i = after == null ? 0 : L.findIndex((x) => x[0] === after) + 1;
      L = [...L.slice(0, i > 0 || after == null ? i : L.length), ...fresh, ...L.slice(i > 0 || after == null ? i : L.length)];
    }
    return [g, L] as NavGroup;
  });
}
