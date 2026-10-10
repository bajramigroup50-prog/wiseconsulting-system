/**
 * Last menu pass, legacy runtime NAV patches (index.html, after „Сите модули по дејност … на едно место“):
 * 1. Производство: `normativ prod mrp prodCost lotovi` become a „🏭 Производство“ submenu in Материјално (before its
 *    first submenu) and a copy at the end of Малопродажба; `rasNorm` (write-off without a BOM) stays next to `prod`.
 * 2. `opomeni` right after `izlez` in Материјално.
 * 3. Every view that belongs to an industry module (`MOD_OF`) moves from the other menus to the end of „Дејности“,
 *    except `mrp`, `prodCost`, `lotovi`, which stay with production.
 */
import { MODULE_OF_VIEW } from '@wise/core/industry';
import type { NavGroup, NavItem } from './nav-data';

const PROD = ['normativ', 'prod', 'rasNorm', 'mrp', 'prodCost', 'lotovi'];
const KEEP = new Set(['mrp', 'prodCost', 'lotovi']);

const clone = (it: NavItem): NavItem => (it[0] === '>' ? [it[0], it[1], (it[2] ?? []).map(clone)] : ([...it] as unknown as NavItem));
const ids = (items: readonly NavItem[]): string[] => items.flatMap((x) => (x[0] === '>' ? ids(x[2] ?? []) : [x[0]]));

function strip(items: readonly NavItem[], drop: (it: NavItem) => boolean): NavItem[] {
  return items.flatMap((it): NavItem[] => (it[0] === '>' ? [[it[0], it[1], strip(it[2] ?? [], drop)]] : drop(it) ? [] : [it]));
}

export function addDejnostiNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  let N = nav.map(([g, it]) => [g, it.map(clone)] as [string, NavItem[]]);
  const grp = (g: string) => N.find((x) => x[0] === g);

  const mat = grp('Материјално');
  if (mat) {
    const found = new Map<string, NavItem>();
    mat[1] = strip(mat[1], (it) => (PROD.includes(it[0]) ? (found.set(it[0], it), true) : false));
    const sub = PROD.filter((v) => found.has(v)).map((v) => found.get(v)!);
    if (sub.length && !mat[1].some((x) => x[0] === '>' && x[1] === '🏭 Производство')) {
      const i = mat[1].findIndex((x) => x[0] === '>');
      mat[1].splice(i < 0 ? mat[1].length : i, 0, ['>', '🏭 Производство', sub]);
      const mg = grp('Малопродажба');
      if (mg) mg[1].push(['-'], ['>', '🏭 Производство', sub.map(clone)]);
    }
    if (!ids(mat[1]).includes('opomeni')) {
      const i = mat[1].findIndex((x) => x[0] === 'izlez');
      mat[1].splice(i < 0 ? 0 : i + 1, 0, ['opomeni', '⏰ Неплатени фактури и опомени']);
    }
  }

  const dej = grp('Дејности');
  if (dej) {
    const own = new Set(ids(dej[1]));
    const moved: NavItem[] = [];
    for (const g of N) {
      if (g === dej) continue;
      g[1] = strip(g[1], (it) => {
        if (it[0] === '-' || !MODULE_OF_VIEW[it[0]] || KEEP.has(it[0]) || own.has(it[0])) return false;
        if (!moved.some((m) => m[0] === it[0])) moved.push(it);
        return true;
      });
    }
    if (moved.length) dej[1].push(['-'], ...moved);
  }

  // Tidy: no empty submenus, no leading/trailing/double separators, no empty groups.
  const tidy = (items: readonly NavItem[]): NavItem[] => {
    const out: NavItem[] = [];
    for (const it of items) {
      if (it[0] === '>') { const s = tidy(it[2] ?? []); if (s.some((x) => x[0] !== '-')) out.push([it[0], it[1], s]); continue; }
      if (it[0] === '-' && (!out.length || out[out.length - 1]![0] === '-')) continue;
      out.push(it);
    }
    while (out.length && out[out.length - 1]![0] === '-') out.pop();
    return out;
  };
  N = N.map(([g, it]) => [g, tidy(it)] as [string, NavItem[]]).filter(([, it]) => it.length);
  return N as unknown as readonly NavGroup[];
}
