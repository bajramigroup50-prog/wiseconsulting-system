/**
 * P25 „Пребарај екран…“ (Ctrl+K, `components/nav-search.tsx`): every screen the CURRENT user may open, found by its new
 * name, its old (classic menu) names and synonyms, also in Latin letters („zakoni“, „banka“).
 *
 * The index is built on the server (`app/(app)/layout.tsx`) from the user's ALREADY FILTERED classic menu — role
 * (`navFor` / `viewAllowed`), industry modules, owner-only views, 🔒 book-only / „Прилагодено“, 🎭 demo allow-list —
 * so it can never list a screen the menu / route guard would refuse. Nothing is added except the own profile
 * (`lozinka`, open to everybody). Pure.
 */
import type { NavGroup, NavItem } from './nav-data';
import { HUBS, MENU_HUB_OF } from './nav-hubs';

export interface ScreenEntry {
  id: string;
  /** Name shown (the name in the user's current menu). */
  t: string;
  /** Where it lives now (menu group, or the tab-container screen). */
  g: string;
  /** Old names, synonyms, the id itself (normalised for the search). */
  k: string;
}

/** Extra synonyms (old program wording, common short names). */
const SYN: Readonly<Record<string, readonly string[]>> = {
  banka: ['изводи', 'извод', 'банка', 'банкарски изводи'], devizni: ['девизи', 'девизен извод'], bankFmt: ['формати', 'банки'],
  nalozi: ['налог', 'темелница', 'дневник'], kartici: ['картица', 'ИОС', 'комитент картица'], kkart: ['картица конто'],
  plati: ['плата', 'плати', 'пресметка плата'], vraboteni: ['вработен', 'персонал'], ddv: ['ддв04', 'ддв-04', 'пдв'],
  izlez: ['фактура', 'излезна фактура', 'фактури'], vlez: ['влезна фактура', 'набавка', 'приемница'], blagajna: ['каса благајна'],
  korisnici: ['колеги', 'лозинки', 'улоги', 'пристап'], firmi: ['избор на фирма', 'нова фирма'], sistem: ['резервна копија', 'бекап', 'backup'],
  dosie: ['досие'], arhiva: ['архива', 'документи'], rokovi: ['рокови', 'потсетници', 'календар'], zsRok: ['годишна сметка рок'],
  autop: ['автопилот'], izvestuvanja: ['известувања', 'аларми'], pomos: ['помош', 'упатство'], sifrarnik: ['шифрарник', 'шифри'],
};

const LAT: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ѓ: 'gj', е: 'e', ж: 'zh', з: 'z', ѕ: 'dz', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm',
  н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ќ: 'kj', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', џ: 'dzh', ш: 'sh',
  // Serbian / Bulgarian letters that staff may type
  ђ: 'gj', ћ: 'kj', й: 'j', щ: 'sht', ъ: 'a', ь: '', ю: 'ju', я: 'ja',
};
/** Lower case, Cyrillic → Latin, Latin diacritics folded, everything else → one space. */
export const norm = (s: string): string =>
  [...s.toLowerCase()].map((c) => LAT[c] ?? c).join('')
    .replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'dj')
    .replace(/[^a-z0-9]+/g, ' ').trim();

const flat = (items: readonly NavItem[]): [string, string][] =>
  items.flatMap((x): [string, string][] => (x[0] === '-' ? [] : x[0] === '>' ? flat(x[2] ?? []) : [[x[0], x[1] ?? x[0]]]));
const clean = (t: string) => t.replace(/^[^\p{L}\p{N}(]+/u, '').trim() || t;

/**
 * `allowed`: the user's filtered classic menu (what they may open); `shown`: the menu they see (classic or „ново“).
 * `extra`: further screens of the user (`[id, label]`, e.g. the own profile).
 */
export function searchIndex(allowed: readonly NavGroup[], shown: readonly NavGroup[], extra: readonly (readonly [string, string])[] = []): ScreenEntry[] {
  const shownAt = new Map<string, [string, string]>();
  for (const [g, L] of shown) for (const [id, t] of flat(L)) if (!shownAt.has(id)) shownAt.set(id, [t, g]);
  const names = new Map<string, Set<string>>();
  const groupOf = new Map<string, string>();
  for (const [g, L] of allowed) for (const [id, t] of flat(L)) {
    (names.get(id) ?? names.set(id, new Set()).get(id)!).add(t);
    if (!groupOf.has(id)) groupOf.set(id, g);
  }
  for (const [id, t] of extra) if (!names.has(id)) { names.set(id, new Set([t])); groupOf.set(id, ''); }
  const out: ScreenEntry[] = [];
  for (const [id, N] of names) {
    if (id === 'home' && !shownAt.has(id)) continue;
    const hubs = HUBS.filter((h) => h.tabs.some((x) => x.view === id));
    const tabs = hubs.flatMap((h) => h.tabs.filter((x) => x.view === id).map((x) => x.label));
    const s = shownAt.get(id);
    // a view folded into a tab-container screen: its own (tab) name, under the screen's name
    const mh = MENU_HUB_OF[id] ? hubs.find((h) => h.key === MENU_HUB_OF[id]) : undefined;
    // shown in the menu: its menu name and group (the hub item carries the screen's name); a view folded into a
    // tab-container screen: its tab name, under the screen's name
    const t = s ? s[0] : tabs[0] ?? [...N][0]!;
    const g = s ? s[1] : mh?.label ?? hubs[0]?.label ?? groupOf.get(id) ?? '';
    const k = norm([id, ...N, t, ...tabs, ...hubs.flatMap((h) => [h.label, ...(h.alt ?? [])]), ...(SYN[id] ?? []), s?.[0] ?? ''].join(' '));
    out.push({ id, t: clean(t), g, k });
  }
  return out;
}

/** The screens matching `q` (every word must match), best first. */
export function searchScreens(index: readonly ScreenEntry[], q: string, limit = 12): ScreenEntry[] {
  const nq = norm(q);
  if (!nq) return [];
  const W = nq.split(' ');
  const R: [number, ScreenEntry][] = [];
  for (const e of index) {
    const nt = norm(e.t);
    if (!W.every((w) => e.k.includes(w) || nt.includes(w))) continue;
    const score = nt === nq ? -1 : nt.startsWith(nq) ? 0 : nt.includes(nq) ? 1 : W.every((w) => nt.includes(w)) ? 2 : e.k.includes(nq) ? 3 : 4;
    R.push([score, e]);
  }
  return R.sort((a, b) => a[0] - b[0] || a[1].t.localeCompare(b[1].t, 'mk')).slice(0, limit).map(([, e]) => e);
}
