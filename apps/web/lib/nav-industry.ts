/**
 * Phase 10 menu: the freight views legacy inserted at runtime after `pnGorivo` (14651, 14690) and the per-firm module
 * filter (legacy `navFilter` / `navFor` 15975, FIX LEGACY-MAP 10.4 item 9: applies to every role).
 */
import { viewEnabled } from '@wise/core/industry';
import type { NavGroup, NavItem } from './nav-data';

const FREIGHT: NavItem[] = [['frTuri', '🚛 Превоз за трети лица – тури и фактури'], ['frDnev', '🧾 Дневници во странство (возачи)'], ['frDok', '📄 Лиценци и документи (возила, возачи)']];

/** Add the freight items to Дејности (after the travel agency block). */
export function addIndustryNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    if (g !== 'Дејности' || items.some((x) => x[0] === 'frTuri')) return [g, items] as NavGroup;
    const i = items.findIndex((x) => x[0] === 'turaIzv');
    const L = [...items];
    L.splice(i < 0 ? L.length : i + 1, 0, ['-'], ...FREIGHT);
    return [g, L] as NavGroup;
  });
}

function filterItems(items: readonly NavItem[], ok: (v: string) => boolean): NavItem[] {
  const out: NavItem[] = [];
  for (const it of items) {
    if (it[0] === '>') {
      const sub = filterItems(it[2] ?? [], ok);
      if (sub.some((x) => x[0] !== '-')) out.push([it[0], it[1], sub]);
      continue;
    }
    if (it[0] === '-') { if (out.length && out[out.length - 1]![0] !== '-') out.push(it); continue; }
    if (ok(it[0])) out.push(it);
  }
  while (out.length && out[out.length - 1]![0] === '-') out.pop();
  return out;
}

/** Hide the views of modules that are off for the firm; empty groups disappear. */
export function filterNavByModules(nav: readonly NavGroup[], firm: { mods: readonly string[] } | null, client = false): readonly NavGroup[] {
  if (!firm) return nav;
  const ok = (v: string) => viewEnabled(v, firm.mods, { hasFirm: true, client });
  return nav.map(([g, it]) => [g, filterItems(it, ok)] as NavGroup).filter(([, it]) => it.some((x) => x[0] !== '-'));
}
