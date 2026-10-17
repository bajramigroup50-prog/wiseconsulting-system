/**
 * UX Phase 1 (docs/ux-rindertim.md, approved without P1): the „ново“ menu, per user (P40 „Мени: класично / ново“,
 * `lib/menu-style.ts`). „класично“ = the legacy `NAV` exactly as before.
 *
 * `newMenu` runs LAST, on the menu that is already filtered for the user (role, modules `filterNavByModules`, owner
 * views, 🔒 book-only / „Прилагодено“, 🎭 demo allow-list): it only removes, moves, renames and groups items that are
 * already there, so it can never show a view the classic menu would not show. `viewAllowed`, the route guard and the
 * server-action gates keep reading the classic `NAV` (`lib/nav.ts`), i.e. access is exactly what it was.
 * Never applied to the klient / teren menus nor to the „👁 Преглед како клиент“ menu (`app/(app)/layout.tsx`).
 *
 *  - P13 Архива once: `dosie`, `paket` only in Архива.
 *  - P14 Фирми: one item + „⋯“ submenu (`firmiImp`, `firmiResh`, `moduli`), separators between the blocks of the group;
 *    `firmi` no more in Систем; „Промени фирма“ / the „Излез“ group go (the top bar's ⏏ / ⇄ stays).
 *  - P15 Корисници only in Систем.
 *  - P16 „🏭 Производство“ only in Материјално.
 *  - P17 (menu only; the screens are merged in a later phase): `efaktura`, `prenosi`, `uprosek`, `kalkCalc` only in
 *    Материјално; `fiskPer`, `poobjekti` only in Финансово.
 *  - P8 / P9: the law screens and the deadline screens are ONE item each (`MENU_HUBS`), opening the first allowed tab.
 *  - P5: `bankFmt` folds into „Изводи → ⚙“ (`/banka?banks=1` tab strip) when Изводи is in the menu.
 */
import type { NavGroup, NavItem } from './nav-data';
import { MENU_HUBS } from './nav-hubs';

type L = NavItem[];

const SEP: NavItem = ['-'];
/** id → the group that keeps it (the copies in other groups are removed, only when the keeper still has it). */
const KEEP_IN: Readonly<Record<string, string>> = {
  dosie: 'Архива', paket: 'Архива', korisnici: 'Систем', firmi: 'Фирми',
  efaktura: 'Материјално', prenosi: 'Материјално', uprosek: 'Материјално', kalkCalc: 'Материјално',
  fiskPer: 'Финансово', poobjekti: 'Финансово',
};
/** Removed from the menu everywhere: „Промени фирма“ / „Излез“ (the top bar's ⏏ ИЗЛЕЗ ОД ФИРМАТА / ⇄ Промени фирма). */
const DROP = new Set(['izlezF']);
const PROD = '🏭 Производство';
/** P14: the rarely used firm actions, behind „⋯“ next to Фирми. */
export const FIRM_MORE_LABEL = '⋯ Фирми – повеќе';
const FIRM_MORE = ['firmiImp', 'firmiResh', 'moduli'];
/** P14: the blocks of the Фирми group (an id not listed stays, at the end). */
const FIRM_BLOCKS: readonly (readonly string[])[] = [
  ['home', 'robot', 'prist'],
  ['firmi', '>' + FIRM_MORE_LABEL],
  ['izvestuvanja', 'zatvoranje', 'insp', 'kontroli', 'zakoni', 'lawAi', 'ujpZakoni', 'lawrep', 'zakon', 'rokovi', 'zsRok', 'mpinIn', 'efPrep'],
  ['klPortal', 'klInbox', 'klProfili', 'mesIzv'],
  ['kdogovori', 'kdfakturi', 'firmIzv'],
];
/** P5: folded into the „⚙“ of Изводи when one of the hosts is in the menu. */
const FOLD: readonly [string, readonly string[]][] = [['bankFmt', ['banka', 'devizni']], ['bankSite', ['banka', 'devizni']]];

const idsOf = (items: readonly NavItem[]): string[] => items.flatMap((x) => (x[0] === '>' ? idsOf(x[2] ?? []) : x[0] === '-' ? [] : [x[0]]));
const strip = (items: readonly NavItem[], drop: (id: string) => boolean): L =>
  items.flatMap((x): L => (x[0] === '>' ? [[x[0], x[1], strip(x[2] ?? [], drop)]] : x[0] !== '-' && drop(x[0]) ? [] : [x]));

/** No empty submenus, no leading / trailing / double separators. */
function tidy(items: readonly NavItem[]): L {
  const out: L = [];
  for (const it of items) {
    if (it[0] === '>') { const s = tidy(it[2] ?? []); if (s.some((x) => x[0] !== '-')) out.push([it[0], it[1], s]); continue; }
    if (it[0] === '-' && (!out.length || out[out.length - 1]![0] === '-')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1]![0] === '-') out.pop();
  return out;
}

function firmGroup(items: L): L {
  const more = items.filter((x) => FIRM_MORE.includes(x[0]));
  const rest = items.filter((x) => !FIRM_MORE.includes(x[0]) && x[0] !== '-');
  const pool: L = [...rest, ...(more.length ? [['>', FIRM_MORE_LABEL, more] as NavItem] : [])];
  const key = (x: NavItem) => (x[0] === '>' ? '>' + x[1] : x[0]);
  const out: L = [];
  const used = new Set<NavItem>();
  for (const block of FIRM_BLOCKS) {
    const B = block.flatMap((k) => pool.filter((x) => key(x) === k && !used.has(x)));
    if (!B.length) continue;
    for (const x of B) used.add(x);
    if (out.length) out.push(SEP);
    out.push(...B);
  }
  const left = pool.filter((x) => !used.has(x));
  if (left.length) out.push(SEP, ...left);
  return out;
}

export function newMenu(groups: readonly NavGroup[]): readonly NavGroup[] {
  let N = groups.map(([g, L]) => [g, [...L]] as [string, L]);
  const has = (g: string, id: string) => N.some(([n, L]) => n === g && idsOf(L).includes(id));
  const all = new Set(N.flatMap(([, L]) => idsOf(L)));

  // P13 / P14 / P15 / P17: one copy of each duplicated item (only when the keeping group still has it)
  N = N.map(([g, L]) => [g, strip(L, (id) => DROP.has(id) || (!!KEEP_IN[id] && KEEP_IN[id] !== g && has(KEEP_IN[id]!, id)))]);
  // P16: „🏭 Производство“ only in Материјално
  if (N.some(([g, L]) => g === 'Материјално' && L.some((x) => x[0] === '>' && x[1] === PROD))) {
    N = N.map(([g, L]) => [g, g === 'Материјално' ? L : L.filter((x) => !(x[0] === '>' && x[1] === PROD))]);
  }
  // P5: bankFmt → Изводи ⚙ (`/banka?banks=1` tab strip)
  for (const [id, hosts] of FOLD) if (hosts.some((h) => all.has(h))) N = N.map(([g, L]) => [g, strip(L, (x) => x === id)]);
  // P8 / P9: one item per tab-container screen, at its primary's place (else at the first member's), opening that tab
  for (const h of MENU_HUBS) {
    const present = h.members.filter((m) => all.has(m));
    if (!present.length) continue;
    const at = present.includes(h.primary) ? h.primary : N.flatMap(([, L]) => idsOf(L)).find((id) => present.includes(id))!;
    let placed = false;
    const put = (items: readonly NavItem[]): L => items.flatMap((x): L => {
      if (x[0] === '>') return [[x[0], x[1], put(x[2] ?? [])]];
      if (x[0] === '-' || !h.members.includes(x[0])) return [x];
      if (x[0] === at && !placed) { placed = true; return [[at, h.label]]; }
      return [];
    });
    N = N.map(([g, L]) => [g, put(L)]);
  }
  // P14: Фирми = one item + „⋯“, separated blocks
  N = N.map(([g, L]) => [g, g === 'Фирми' ? firmGroup(L) : L]);
  return N.map(([g, L]) => [g, tidy(L)] as [string, L]).filter(([, L]) => L.some((x) => x[0] !== '-')) as unknown as readonly NavGroup[];
}

/** Menu size, for the tests and the report: groups, visible entries (submenu items included, separators not). */
export const menuSize = (groups: readonly NavGroup[]): { groups: number; items: number } =>
  ({ groups: groups.length, items: groups.reduce((s, [, L]) => s + idsOf(L).length, 0) });
