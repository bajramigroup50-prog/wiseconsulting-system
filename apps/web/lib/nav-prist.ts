/**
 * „📥 Пристигнати документи“ (UX P7, docs/ux-rindertim.md) — the one inbox for everything that arrives, right after
 * „🤖 WISE Робот“ in Фирми (office roles; per firm the user may access, office-wide rows owner / admins only).
 */
import type { NavGroup } from './nav-data';

export const PRIST_VIEW = 'prist';

export function addPristNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    if (g !== 'Фирми' || items.some((x) => x[0] === PRIST_VIEW)) return [g, items] as NavGroup;
    const L = [...items];
    const i = L.findIndex((x) => x[0] === 'robot');
    const j = i >= 0 ? i : L.findIndex((x) => x[0] === 'home');
    L.splice(j < 0 ? 0 : j + 1, 0, [PRIST_VIEW, '📥 Пристигнати документи']);
    return [g, L] as NavGroup;
  });
}
