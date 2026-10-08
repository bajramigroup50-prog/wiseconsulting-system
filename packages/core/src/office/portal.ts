/** Client portal — legacy `KL_PROF` / `KL_SEC` / `KL_BASEC` / `klSections` (9027–9050). */

export const KL_PROF = [
  ['auto', 'Сервис за возила и автоделови'], ['hotel', 'Угостителство (хотел, ресторан, кафе)'],
  ['wholesale', 'Трговија на големо'], ['retail', 'Трговија на мало (продавница)'], ['construct', 'Градежништво'],
  ['prod', 'Производство'], ['service', 'Други услуги'],
] as const;

/** [id, name, icon, view, profiles (null = always), description] */
export type KlSection = readonly [string, string, string, string, readonly string[] | null, string];
export const KL_SEC: readonly KlSection[] = [
  ['docs', 'Документи на фирмата', '📁', 'dosie', null, 'Решенија, тековна состојба, лиценци, договори – секогаш достапни'],
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
];

export const KL_BASEC: readonly string[] = ['docs', 'send', 'kdfi', 'metg'];

/** Firm portal config (legacy `firm.kl`). */
export interface KlConfig { on?: Record<string, boolean>; prof?: string[] }

/** Legacy `klSections`: explicit on/off per section, otherwise the base set. */
export const klSections = (c: KlConfig | null | undefined): KlSection[] =>
  KL_SEC.filter((s) => (c?.on?.[s[0]] != null ? !!c.on[s[0]] : KL_BASEC.includes(s[0])));

/** Recommended for the firm's business profile (legacy `klRec`). */
export const klRecommended = (s: KlSection, prof: readonly string[] = []) => !!s[4] && s[4].some((p) => prof.includes(p));

/** Views a client may open (legacy `klAllowed`) — enforced server-side by the page guard, not only in the menu. */
export function klAllowedViews(c: KlConfig | null | undefined): string[] {
  return [...new Set(['klHome', 'klSend', 'lozinka', ...klSections(c).map((s) => s[3])])];
}

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
