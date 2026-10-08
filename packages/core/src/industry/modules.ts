/**
 * Industry modules and the per-firm module toggle (legacy `MODS` 10201–10214 + pushes 11995 / 14649, `MOD_OF`,
 * `nkdOf`, `nkdProf` → 11845, `modOnF`, `viewOn` → 10410, `navFilter`, `DEJ_V`).
 *
 * In the rebuild `firms.mods` is the list of enabled module keys. The "Модули по дејност" screen can fill it from the
 * firm's NKD activity code ({@link suggestedModules}), which replaces legacy's implicit profile fallback.
 *
 * FIX (LEGACY-MAP 10.4 item 9): legacy `viewOn` only restricted client users (office users saw every module in
 * `DEJ_V`), `gradbaIzv` and `mojpn` had no module, and the dashboard used a different check (`modOnF`). Here one
 * function, {@link viewEnabled}, decides for every role, every view of a module is listed, and it is used both for
 * the menu and for blocking the routes. Only production planning (mrp, lot) stays visible to office users, as in
 * legacy (`MOD_OFFICE`).
 */

export interface IndustryModule {
  k: string;
  n: string;
  /** Views (legacy view ids = routes). */
  v: readonly string[];
  /** Activity profiles that suggest the module. */
  p: readonly string[];
}

export const INDUSTRY_MODULES: readonly IndustryModule[] = [
  { k: 'hotel', n: '🏨 Хотел (рецепција, соби, книга на гости, такса)', v: ['hotel', 'hotelSoby', 'hotelKniga'], p: ['hotel'] },
  { k: 'rest', n: '🍽 Ресторан / кафе (маси, кујна)', v: ['restoran', 'kujna'], p: ['hotel', 'rest'] },
  { k: 'auto', n: '🔧 Авто сервис и делови', v: ['servis', 'vozila', 'delovi', 'potsetnici'], p: ['auto'] },
  { k: 'rent', n: '🚗 Rent-a-car', v: ['rent', 'flota', 'rentIzv'], p: ['rent'] },
  { k: 'cons', n: '🏗 Градежништво (објекти, ситуации, дневник)', v: ['gradba', 'gradbaIzv'], p: ['construct'] },
  { k: 'appt', n: '📅 Термини и картони', v: ['termini', 'kartoni'], p: ['service', 'med', 'auto'] },
  { k: 'recur', n: '🔁 Периодични фактури', v: ['periodicni'], p: ['service', 'med', 'construct', 'rent'] },
  { k: 'ord', n: '🧾 Нарачки од купувачи', v: ['porachki'], p: ['wholesale', 'prod'] },
  { k: 'buy', n: '📦 Нарачки до добавувачи и дополнување залиха', v: ['nabavki', 'dopolnuvanje'], p: ['wholesale', 'retail', 'prod', 'auto', 'rest', 'hotel'] },
  { k: 'loy', n: '💳 Лојалност и купони', v: ['lojalnost'], p: ['retail', 'hotel', 'rest'] },
  { k: 'mrp', n: '🏭 Планирање производство и реална цена', v: ['mrp', 'prodCost'], p: ['prod'] },
  { k: 'lot', n: '🏷 Лотови и рок на траење', v: ['lotovi'], p: ['prod', 'wholesale', 'retail'] },
  { k: 'pn', n: '🚚 Патни налози, возила во живо, гориво', v: ['pnalozi', 'pnLive', 'pnGorivo', 'mojpn'], p: ['wholesale', 'prod', 'construct', 'transport'] },
  { k: 'tour', n: '✈ Туристичка агенција (аранжмани, патници, ДДВ на маржа)', v: ['tura', 'turaIzv'], p: ['travel'] },
  { k: 'frt', n: '🚛 Превоз за трети лица (тури, CMR, дневници, лиценци)', v: ['frTuri', 'frDnev', 'frDok'], p: ['transport'] },
];

export const MODULE_KEYS = INDUSTRY_MODULES.map((m) => m.k);
export const MODULE_OF_VIEW: Readonly<Record<string, IndustryModule>> = Object.fromEntries(INDUSTRY_MODULES.flatMap((m) => m.v.map((v) => [v, m])));
/** Legacy `MOD_OFFICE`: production planning is part of the books — office users always see it. */
export const OFFICE_ALWAYS = new Set(['mrp', 'lot']);

/** Legacy `KL_PROF` — activity profiles. */
export const PROFILES: readonly (readonly [string, string])[] = [
  ['wholesale', 'Трговија на големо'], ['retail', 'Трговија на мало'], ['prod', 'Производство'], ['service', 'Услуги'],
  ['construct', 'Градежништво'], ['hotel', 'Хотел / сместување'], ['rest', 'Ресторан / кафе-бар'], ['auto', 'Авто сервис и делови'],
  ['rent', 'Rent-a-car (изнајмување возила)'], ['med', 'Здравство (ординација, клиника, стоматолог)'], ['transport', 'Транспорт и шпедиција'],
  ['travel', 'Туристичка агенција / тур-оператор'],
];
export const profileName = (k: string) => PROFILES.find((x) => x[0] === k)?.[1] ?? k;

/** Legacy `nkdOf`: NKD activity code from the firm's activity text (`55.10 Хотели…`). */
export function nkdOf(activity: string | null | undefined): { d: number; c: string } | null {
  const m = String(activity ?? '').match(/\b(\d{2})(?:\.(\d{1,2}))?/);
  return m ? { d: Number(m[1]), c: m[1]! + (m[2] ? '.' + m[2] : '') } : null;
}

/** Legacy `nkdProf` (10217 → 11845): activity profiles of an NKD code. */
export function nkdProfiles(activity: string | null | undefined): string[] {
  const n = nkdOf(activity);
  if (!n) return [];
  const { d, c } = n;
  if (d === 79) return ['travel'];
  if (d <= 3 || (d >= 5 && d <= 33)) return ['prod'];
  if (d >= 35 && d <= 39) return ['service'];
  if (d >= 41 && d <= 43) return ['construct'];
  if (d === 45) return /^45\.(2|4)/.test(c) ? ['auto'] : /^45\.3/.test(c) ? ['auto', 'retail'] : ['retail', 'auto'];
  if (d === 46) return ['wholesale'];
  if (d === 47) return ['retail'];
  if (d >= 49 && d <= 52) return ['transport'];
  if (d === 55) return ['hotel'];
  if (d === 56) return ['rest'];
  if (d === 77) return /^77\.1/.test(c) ? ['rent'] : ['service'];
  if (d === 75 || d === 86) return ['med'];
  if (d >= 53) return ['service'];
  return [];
}

/** Modules suggested for a set of profiles (legacy `modOnF` without overrides). */
export const suggestedModules = (profiles: readonly string[]): string[] =>
  INDUSTRY_MODULES.filter((m) => m.p.some((p) => profiles.includes(p))).map((m) => m.k);

/** Is module `k` enabled for a firm with `mods`? Unknown keys (core modules) are always on. */
export const moduleOn = (mods: readonly string[] | null | undefined, k: string): boolean =>
  !MODULE_KEYS.includes(k) || (mods ?? []).includes(k);

/**
 * May this view be shown / opened for the firm? Views outside every module are always allowed.
 * Without a firm nothing is gated (the firm-scoped pages ask for a firm themselves).
 */
export function viewEnabled(view: string, mods: readonly string[] | null | undefined, opts: { hasFirm: boolean; client?: boolean }): boolean {
  const m = MODULE_OF_VIEW[view];
  if (!m || !opts.hasFirm) return true;
  if (!opts.client && OFFICE_ALWAYS.has(m.k)) return true;
  return moduleOn(mods, m.k);
}

/** Keep only valid, de-duplicated module keys (input from the toggle screen). */
export const normalizeMods = (L: readonly string[]): string[] => MODULE_KEYS.filter((k) => L.includes(k));
