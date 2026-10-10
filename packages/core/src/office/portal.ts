/**
 * Client portal — legacy `KL_PROF` / `KL_SEC` / `KL_BASEC` / `klSections` (9027–9050) with every runtime push
 * (`KL_PROF` 9855 / 10195 / 10200 / 11844, `KL_SEC` 9856 / 10196 / 11561 splice / 11841 / 11996), `firmProf` /
 * `profAuto` (10223), `klRec`, the module filter of `klSections` (`MOD_OF` / `modOnF`) and the „Само основно“ /
 * „Вклучи ги препорачаните ★“ actions (`klOnlyBase` / `klAddRec` 9085).
 */
import { MODULE_OF_VIEW, moduleOn, nkdProfiles } from '../industry/modules';

/** Final legacy `KL_PROF` (base 7 + rent, med, rest, transport, travel pushes). */
export const KL_PROF = [
  ['auto', 'Сервис за возила и автоделови'], ['hotel', 'Угостителство (хотел, ресторан, кафе)'],
  ['wholesale', 'Трговија на големо'], ['retail', 'Трговија на мало (продавница)'], ['construct', 'Градежништво'],
  ['prod', 'Производство'], ['service', 'Други услуги'],
  ['rent', 'Rent-a-car (изнајмување возила)'], ['med', 'Здравство (ординација, клиника, стоматолог)'],
  ['rest', 'Ресторан / кафе-бар'], ['transport', 'Транспорт и шпедиција'], ['travel', 'Туристичка агенција / тур-оператор'],
] as const;

/** [id, name, icon, view, profiles (null = always), description] */
export type KlSection = readonly [string, string, string, string, readonly string[] | null, string];
/** Final legacy `KL_SEC` in its runtime order (the `dash` section is spliced in at index 1, 11561). */
export const KL_SEC: readonly KlSection[] = [
  ['docs', 'Документи на фирмата', '📁', 'dosie', null, 'Решенија, тековна состојба, лиценци, договори – секогаш достапни'],
  ['dash', 'Анализа на работењето', '📈', 'klDash', null, 'Приходи, расходи, промет по денови и месеци, најпродавани артикли, купувачи и трошоци'],
  ['send', 'Испрати документ', '📤', 'klSend', null, 'Фотографирај или прикачи фактура, извод, договор – оди во канцеларијата'],
  ['izlez', 'Излезни фактури', '🧾', 'izlez', null, 'Нова фактура за купувач, преглед и PDF'],
  ['vlez', 'Влезни фактури', '📥', 'vlez', null, 'Преглед на примените фактури од добавувачи'],
  ['kdfi', 'КДФИ – дневни извештаи', '🗓', 'kdfi', null, 'Дневни финансиски извештаи од фискалниот апарат'],
  ['metg', 'МЕТГ – евиденција во трговија на мало', '🧾', 'm_trg', ['retail'], 'Евиденција на продажбата и залихата во продавницата'],
  ['stanje', 'Мојата состојба', '📊', 'klHome', null, 'Побарувања, обврски, залиха, ДДВ и рокови'],
  ['kasa', 'Каса / дневен промет', '💶', 'kasa', ['retail', 'hotel', 'auto'], 'Внес на дневниот промет (Z-извештај)'],
  ['mprod', 'Продажба во продавница', '🛒', 'm_izlez', ['retail'], 'Продажба, повратница, отпис во продавницата'],
  ['mlager', 'Лагер – продавница', '📦', 'm_lager', ['retail', 'hotel'], 'Залиха и цени во продавницата'],
  ['glager', 'Лагер – магацин', '🏬', 'g_lager', ['wholesale', 'prod', 'auto', 'construct'], 'Залиха во магацинот'],
  ['usl', 'Фактури за услуги', '🔧', 'uslugi', ['auto', 'service', 'construct'], 'Фактури за работа / услуга (сервис, монтажа)'],
  ['isp', 'Испратници', '🚚', 'ispratnici', ['wholesale', 'prod'], 'Испратници за купувачите'],
  ['prof', 'Профактури / понуди', '📄', 'profakturi', ['wholesale', 'service', 'construct', 'auto'], 'Понуди и профактури'],
  ['norm', 'Нормативи', '🍽', 'normativ', ['hotel', 'prod'], 'Нормативи за производи / јадења и пијалаци'],
  ['rnal', 'Работни налози', '🏭', 'prod', ['prod'], 'Производство по работни налози'],
  ['plati', 'Плати (листа)', '👥', 'plati', [], 'Пресметаните плати – само ако канцеларијата го овозможи'],
  ['ios', 'Купувачи и добавувачи (ИОС)', '🤝', 'analitika', ['wholesale', 'construct', 'prod', 'service', 'auto'], 'Кој колку должи и колку должиме'],
  ['hot', 'Хотел – рецепција', '🏨', 'hotel', ['hotel'], 'Резервации, пријава и одјава на гости, сметка'],
  ['hotk', 'Книга на гости и такса', '📒', 'hotelKniga', ['hotel'], 'Книга на гости, странци, такса за престој, зафатеност'],
  ['hots', 'Соби и цени', '🛏', 'hotelSoby', ['hotel'], 'Соби, цени, такса'],
  ['wo', 'Работни налози (сервис)', '🔧', 'servis', ['auto'], 'Прием на возило, делови, работа, фактура'],
  ['cveh', 'Возила на клиенти', '🚘', 'vozila', ['auto'], 'Таблица, VIN, историја на сервиси'],
  ['del', 'Пребарување делови', '🔩', 'delovi', ['auto'], 'OE броеви, замени, по возило'],
  ['pots', 'Потсетници за сервис', '⏰', 'potsetnici', ['auto'], 'Кому му доаѓа сервис'],
  ['rent', 'Rent-a-car резервации', '🚗', 'rent', ['rent'], 'Календар, договор, примопредавање, кауција'],
  ['flota', 'Флота и цени', '🚙', 'flota', ['rent'], 'Возила за изнајмување и цени'],
  ['rentI', 'Rent-a-car извештаи', '📈', 'rentIzv', ['rent'], 'Искористеност и приход по возило'],
  ['ord', 'Нарачки од купувачи', '🧾', 'porachki', ['wholesale', 'prod'], 'Нарачки, резервација на залиха, фактура'],
  ['repl', 'Дополнување залиха', '🔄', 'dopolnuvanje', ['wholesale', 'retail'], 'Што да се нарача од добавувачите'],
  ['loy', 'Лојалност и купони', '💳', 'lojalnost', ['retail', 'hotel'], 'Картички, поени, купони'],
  ['rest', 'Ресторан – маси', '🍽', 'restoran', ['hotel'], 'Маси, нарачки, наплата'],
  ['kuj', 'Кујна / шанк', '👨‍🍳', 'kujna', ['hotel'], 'Нарачки за подготовка'],
  ['mrp', 'Планирање производство', '🏭', 'mrp', ['prod'], 'Потребни материјали и нарачки'],
  ['pcost', 'Реална цена на чинење', '📊', 'prodCost', ['prod'], 'Цена по производ и маржа'],
  ['lot', 'Лотови и рок', '🏷', 'lotovi', ['prod', 'wholesale', 'retail'], 'Серии и рок на траење (FEFO)'],
  ['grd', 'Градежни објекти', '🏗', 'gradba', ['construct'], 'Предмер, ситуации, трошоци, дневник'],
  ['term', 'Термини', '📅', 'termini', ['service', 'med', 'auto'], 'Закажување и потсетници'],
  ['kart', 'Картони', '🗂', 'kartoni', ['service', 'med'], 'Историја на клиент / пациент'],
  ['rec', 'Периодични фактури', '🔁', 'periodicni', ['service', 'med', 'construct'], 'Месечни фактури со еден клик'],
  ['grdI', 'Градежништво – анализи', '📈', 'gradbaIzv', ['construct'], 'По објект и град, трошоци, наплата'],
  ['tura', 'Аранжмани и патници', '✈', 'tura', ['travel'], 'Патувања, пријави, уплати, договор за патување'],
  ['turI', 'Туристичка агенција – извештаи', '📈', 'turaIzv', ['travel'], 'Резултат по аранжман, ДДВ на маржа, аванси, поаѓања'],
];

export const KL_BASEC: readonly string[] = ['docs', 'send', 'kdfi', 'metg'];

/** Store-door notice settings (legacy `firm.kl.note`, saved by `klNotePdf`). */
export interface KlNote { obj?: string; hrs?: string; ujp?: string; ujp2?: string; insp?: string[]; sq?: boolean }

/** Firm portal config (legacy `firm.kl`). */
export interface KlConfig { on?: Record<string, boolean>; prof?: string[]; profSet?: boolean; note?: KlNote }

/** Section's industry module is switched off for the firm (legacy `MOD_OF[view] && !modOnF`). */
export const klModuleOff = (s: KlSection, mods: readonly string[] | null | undefined): boolean => {
  const m = MODULE_OF_VIEW[s[3]];
  return !!m && mods != null && !moduleOn(mods, m.k);
};

/**
 * Legacy `klSections`: sections of a module that is off are hidden; otherwise explicit on/off per section, else the
 * base set. `mods` = the firm's enabled modules (`firms.mods`); omitted → no module filter.
 */
export const klSections = (c: KlConfig | null | undefined, mods?: readonly string[] | null): KlSection[] =>
  KL_SEC.filter((s) => !klModuleOff(s, mods) && (c?.on?.[s[0]] != null ? !!c.on[s[0]] : KL_BASEC.includes(s[0])));

/** Legacy `firmProf`: the profiles set on the portal screen, else derived from the NKD activity code (`nkdProf`). */
export function firmProfiles(c: KlConfig | null | undefined, activity: string | null | undefined): string[] {
  if (Array.isArray(c?.prof) && (c.profSet || c.prof.length)) return [...c.prof];
  return nkdProfiles(activity);
}

/** Legacy `profAuto`: the profiles come from the activity code (nothing set by hand). */
export const profilesAuto = (c: KlConfig | null | undefined): boolean => !(Array.isArray(c?.prof) && (c.profSet || c.prof.length));

/** Recommended for the firm's business profile (legacy `klRec`). */
export const klRecommended = (s: KlSection, prof: readonly string[] = []) => !!s[4] && s[4].some((p) => prof.includes(p));

/** Legacy `klAddRec`: switch on every recommended, non-base section whose module is on (others are kept). */
export function klAddRecommended(c: KlConfig | null | undefined, prof: readonly string[], mods: readonly string[] | null | undefined): Record<string, boolean> {
  const on = { ...(c?.on ?? {}) };
  for (const s of KL_SEC) if (klRecommended(s, prof) && !KL_BASEC.includes(s[0]) && s[4] !== null && !klModuleOff(s, mods)) on[s[0]] = true;
  return on;
}

/** Views a client may open (legacy `klAllowed`) — enforced server-side by the page guard, not only in the menu. */
export function klAllowedViews(c: KlConfig | null | undefined, mods?: readonly string[] | null): string[] {
  return [...new Set(['klHome', 'klSend', 'lozinka', ...klSections(c, mods).map((s) => s[3])])];
}

/**
 * What a client user may enter (legacy `u.kp` on the user, checked in `save` 3299): `out` = issued invoices, cash,
 * shop sales; `in` = received invoices. Nothing = view only + „Испрати документ“. Every entry waits for approval.
 */
export interface KlPerm { out?: boolean; in?: boolean }
export const klEntryAllowed = (kind: string, p: KlPerm | null | undefined): boolean =>
  kind === 'dossier' || ((kind === 'invoice' || kind === 'sale') ? !!p?.out : kind === 'purchase' ? !!p?.in : false);

/** Kinds a client may enter; they're stored as `pending` until the office approves them. */
export const CLIENT_ENTRY_KINDS = {
  purchase: 'Влезна фактура',
  invoice: 'Излезна фактура',
  sale: 'Дневен промет (каса)',
  dossier: 'Документ (досие)',
} as const;
export type ClientEntryKind = keyof typeof CLIENT_ENTRY_KINDS;
export const isClientEntryKind = (k: unknown): k is ClientEntryKind => typeof k === 'string' && k in CLIENT_ENTRY_KINDS;

/** Inbox routing targets (legacy `IR_K` / `irRoute`). */
export const INBOX_ROUTES = {
  purchase: 'Влезна фактура', sale: 'Излезна фактура', bank: 'Извод', fisk: 'Фискален / Z извештај', payroll: 'Плата',
  employee: 'Вработен', cash: 'Благајна', stock: 'Залиха', travel: 'Патен налог', dossier: 'Досие',
} as const;
export type InboxRoute = keyof typeof INBOX_ROUTES;

/**
 * Where a routed client file goes (legacy `irRoute` 14024 + wrapper 14041): purchases / issued invoices are read
 * by AI into the scan review (`ai` kind, then the user saves them as documents); everything else is archived in
 * the dossier (`dossier` category, legacy `irArch`) and the office continues in the module screen (`go`).
 */
export const INBOX_ROUTE_TARGET: Readonly<Record<InboxRoute, { ai?: 'purchase' | 'sale'; dossier?: string; go: string | null }>> = {
  purchase: { ai: 'purchase', go: '/skan' },
  sale: { ai: 'sale', go: '/skan?k=sale' },
  bank: { dossier: 'Банкарски документи', go: '/banka' },
  fisk: { dossier: 'Благајна', go: '/fiskPer' },
  payroll: { dossier: 'Плати и персонал', go: '/plati' },
  employee: { dossier: 'Плати и персонал', go: '/vraboteni?nov' },
  cash: { dossier: 'Благајна', go: '/blagajna' },
  stock: { dossier: 'Магацински документи', go: '/g_lager' },
  travel: { dossier: 'Патни налози и гориво', go: null },
  dossier: { dossier: 'Друго', go: '/dosie' },
};
