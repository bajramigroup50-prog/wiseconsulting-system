/** „🤖 WISE Робот“ (the AI assistant, full page; the side panel is on every page) — right after Контролна табла. */
import type { NavGroup } from './nav-data';

export function addRobotNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    if (g !== 'Фирми' || items.some((x) => x[0] === 'robot')) return [g, items] as NavGroup;
    const L = [...items];
    const i = L.findIndex((x) => x[0] === 'home');
    L.splice(i < 0 ? 0 : i + 1, 0, ['robot', '🤖 WISE Робот']);
    return [g, L] as NavGroup;
  });
}
