/**
 * UX Phase 1 (docs/ux-rindertim.md P5, P8, P9): screens that become ONE screen with tabs. Each tab IS the existing page
 * at its existing address (`/zakoni`, `/lawAi`, `/zsRok`, `/bankFmt` …), so every old URL / bookmark keeps working and
 * every tab keeps exactly its own access rules (route guard by the first path segment, the page's `officePage` /
 * `booksPage` check, the server actions by their source file). Nothing here grants access: the tab strip
 * (`components/hub-tabs.tsx`) shows a tab only when the user may open its view, and the container address
 * `/ekran/<hub>` (`app/(app)/ekran`) only forwards to the first tab the user may open.
 * Pure (no DB, no Next imports): the menu, the Ctrl+K search and the tests share it.
 */

export interface HubTab {
  /** The view (first path segment) whose access rules apply. */
  view: string;
  label: string;
  /** Address of the tab when it is not `/<view>` (e.g. the settings part of a page). */
  href?: string;
  /** The permission the page itself checks (`officePage(view, { perm })`): the tab is hidden without it. */
  perm?: string;
}

export interface Hub {
  key: string;
  /** Name of the screen (menu item in the „ново“ menu, title of the tab strip). */
  label: string;
  tabs: readonly HubTab[];
  /** Old names / synonyms for the Ctrl+K search. */
  alt?: readonly string[];
}

export const HUBS: readonly Hub[] = [
  {
    // P8: the five law screens → „⚖ Закони“ (lawAi is office-only; book-only colleagues have none of them)
    key: 'zakoni', label: '⚖ Закони',
    tabs: [
      { view: 'zakoni', label: '⚖️ Промени' },
      { view: 'lawAi', label: '🤖 Асистент (AI)' },
      { view: 'ujpZakoni', label: '📚 Закони на УЈП' },
      { view: 'lawrep', label: '🧮 Даночен преглед', perm: 'office' },
      { view: 'zakon', label: '✅ Усогласеност', perm: 'office' },
    ],
    alt: ['закони', 'законски промени', 'правен асистент', 'законска усогласеност', 'даночен преглед'],
  },
  {
    // P9: the deadline calendar + the year-end filing calendar → „📅 Рокови“
    key: 'rokovi', label: '📅 Рокови',
    tabs: [
      { view: 'rokovi', label: '📅 Календар на рокови', perm: 'office' },
      { view: 'zsRok', label: '📋 Годишни сметки – што, каде, кога' },
    ],
    alt: ['рокови', 'календар', 'што каде и кога се поднесува', 'потсетници'],
  },
  {
    // P5: bank accounts (+ rules, kontos), bank formats → „Изводи → ⚙ Поставки“
    key: 'izvodiCfg', label: '⚙ Поставки на изводи',
    tabs: [
      { view: 'banka', label: '🏦 Денарски сметки и правила', href: '/banka?banks=1' },
      { view: 'devizni', label: '💶 Девизни сметки и правила', href: '/devizni?banks=1' },
      { view: 'bankFmt', label: '🔎 Формати по банка' },
    ],
    alt: ['банки', 'банкарски сметки', 'формати на изводи', 'банки и формати'],
  },
];

export const hubByKey = (key: string): Hub | undefined => HUBS.find((h) => h.key === key);

export const tabHref = (t: HubTab): string => t.href ?? `/${t.view}`;

/** The tabs of `hub` the user may open (`may(view, perm)` = the same answer the route guard / page would give). */
export function visibleTabs(hub: Hub, may: (view: string, perm?: string) => boolean): HubTab[] {
  return hub.tabs.filter((t) => may(t.view, t.perm));
}

/**
 * Where the container address `/ekran/<hub>?t=<view>` sends the user: the asked tab when allowed, otherwise the first
 * allowed tab; `null` = no tab allowed (the container is refused like any forbidden view).
 */
export function hubTarget(hub: Hub, may: (view: string, perm?: string) => boolean, want?: string | null): string | null {
  const T = visibleTabs(hub, may);
  const t = T.find((x) => x.view === want) ?? T[0];
  return t ? tabHref(t) : null;
}

/** The tab-container screens that are ONE menu item in the „ново“ menu (P8, P9): every member folds into the hub item. */
export const MENU_HUBS: readonly { key: string; label: string; primary: string; members: readonly string[] }[] = [
  { key: 'zakoni', label: '⚖ Закони', primary: 'zakoni', members: ['zakoni', 'lawAi', 'ujpZakoni', 'lawrep', 'zakon'] },
  { key: 'rokovi', label: '📅 Рокови', primary: 'rokovi', members: ['rokovi', 'zsRok'] },
];

/** view → menu hub key (the menu highlights the hub item on every one of its tabs). */
export const MENU_HUB_OF: Readonly<Record<string, string>> = Object.fromEntries(MENU_HUBS.flatMap((h) => h.members.map((m) => [m, h.key])));

/** Are `a` and `b` the same screen of the „ново“ menu (equal, or tabs of one hub)? */
export const sameScreen = (a: string, b: string): boolean => a === b || (!!MENU_HUB_OF[a] && MENU_HUB_OF[a] === MENU_HUB_OF[b]);
