/**
 * Фирми menu items that legacy added to `NAV` at runtime, in legacy load order:
 *  - `mpinIn` (14101–14102): after `zatvoranje` in Фирми, and after `plati` in Финансово › Плата;
 *  - `insp` (16569, nav-office.ts) then lands between `zatvoranje` and `mpinIn`;
 *  - `zakoni` (14346): after `izvestuvanja`;
 *  - `lawrep` (16665): after `insp`; `ujpZakoni` (16799): after `lawrep`.
 * Result in Фирми: … izvestuvanja, zakoni, zatvoranje, insp, lawrep, ujpZakoni, mpinIn.
 * Inserted by group and anchor id (the first anchor found wins), never by a fixed index.
 */
import type { NavGroup, NavItem } from './nav-data';

/** [group, anchors (insert after the first one present; none = end), item] */
const ADD: [string, string[], NavItem][] = [
  ['Фирми', ['izvestuvanja'], ['zakoni', '⚖️ Законски промени']],
  ['Фирми', ['insp', 'zatvoranje'], ['lawrep', '⚖️ Даночен преглед (според законите)']],
  ['Фирми', ['lawrep', 'insp', 'zatvoranje'], ['ujpZakoni', '📚 Закони на УЈП (синхронизирано)']],
  ['Фирми', ['ujpZakoni', 'lawrep', 'insp', 'zatvoranje'], ['mpinIn', '📥 МПИН од УЈП (сите фирми)']],
];
/** [group, submenu label, anchor, item] */
const SUB: [string, string, string, NavItem][] = [
  ['Финансово', 'Плата', 'plati', ['mpinIn', '📥 МПИН од УЈП – прифатени (сите фирми)']],
];

const ins = (L: NavItem[], anchors: string[], it: NavItem) => {
  if (L.some((x) => x[0] === it[0])) return;
  const a = anchors.map((id) => L.findIndex((x) => x[0] === id)).find((i) => i >= 0);
  L.splice(a == null ? L.length : a + 1, 0, it);
};

export function addLawNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    const L = items.map((x) => (x[0] === '>' ? ([x[0], x[1], [...(x[2] ?? [])]] as NavItem) : x));
    for (const [grp, anchors, it] of ADD) if (grp === g) ins(L, anchors, it);
    for (const [grp, sub, anchor, it] of SUB) {
      if (grp !== g) continue;
      const s = L.find((x) => x[0] === '>' && x[1] === sub);
      if (s) ins(s[2] as NavItem[], [anchor], it);
    }
    return [g, L] as NavGroup;
  });
}
