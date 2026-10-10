/** Систем › 📥 Увоз од старата програма (legacy import, admin only — the page checks the `users` permission). */
import type { NavGroup } from './nav-data';

export const LEGACY_IMPORT_VIEW = 'uvozStara';

/** Add the item right after „Податоци и резервна копија“ (`sistem`) in the Систем group. */
export function addLegacyImportNav(nav: readonly NavGroup[]): readonly NavGroup[] {
  return nav.map(([g, items]) => {
    if (g !== 'Систем' || items.some((x) => x[0] === LEGACY_IMPORT_VIEW)) return [g, items] as NavGroup;
    const L = [...items];
    const i = L.findIndex((x) => x[0] === 'sistem');
    L.splice(i < 0 ? L.length : i + 1, 0, [LEGACY_IMPORT_VIEW, '📥 Увоз од старата програма']);
    return [g, L] as NavGroup;
  });
}
