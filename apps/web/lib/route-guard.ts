/**
 * Route allow-list for the restricted roles (used by `proxy.ts` for every request, page or API).
 *
 * - `klient` may open only the client portal: 🏠 Почетна, Испрати, профил / лозинка and the sections the office
 *   switched on for the firm (`klAllowedViews`) — plus the print of an outgoing document when invoices are on, and the shared file / PDF / error endpoints (those check firm access themselves).
 * - `teren` may open only its tasks and travel orders.
 * Everything else redirects to the role's home (`/klHome`, `/mojzad`); API calls get 403.
 * Pure (no DB, no Next imports) so it is unit-tested.
 */

export type GuardRole = 'klient' | 'teren';
export const isGuardRole = (r: unknown): r is GuardRole => r === 'klient' || r === 'teren';

export const ROLE_HOME: Record<GuardRole, string> = { klient: '/klHome', teren: '/mojzad' };

/** Always reachable: auth pages, Next internals, static assets, PWA files, health. */
export function publicPath(p: string): boolean {
  return p.startsWith('/_next/') || p.startsWith('/login') || p.startsWith('/icons/') || p === '/favicon.ico'
    || p === '/manifest.webmanifest' || p.startsWith('/icon') || p.startsWith('/apple-icon') || p === '/api/health'
    // desktop app auto-update (the route itself answers only the app's update header)
    || p.startsWith('/api/desktop-update/')
    // the running build only (new-version banner, components/version-check.tsx)
    || p === '/api/version'
    // 🎭 the demo link (`app/demo/[token]`): signs in as the demo user only (token checked and rate-limited there)
    || p.startsWith('/demo/')
    // public/forms assets and root-level static files only (a dotted segment deeper down is not a free pass)
    || p.startsWith('/forms/') || /^\/[^/]+\.[a-z0-9]{2,5}$/i.test(p);
}

/** API endpoints every signed-in role may call (each checks the file's / current firm's access itself). */
const SHARED_API = ['/api/files', '/api/pdf', '/api/errors', '/api/firm-now'];

const TEREN_VIEWS = ['mojzad', 'mojpn', 'lozinka', 'izlezF'];

/**
 * Which client sections a file link belongs to (`file_links.entity_type` → view ids). A client may open a file only
 * through one of these; types not listed (payroll runs of other screens, office records, AI scans…) are never
 * served to a client unless they uploaded the file themselves.
 */
export const FILE_ENTITY_VIEWS: Readonly<Record<string, readonly string[]>> = {
  dossier_doc: ['dosie'], inbox_item: ['klSend', 'klFoto'], client_entry: ['klSend'],
  purchase: ['vlez'], invoice: ['izlez', 'profakturi', 'ispratnici'], sales_daily: ['kdfi', 'kasa'],
  payroll_run: ['plati'], employee: ['plati', 'klDogovori'], hr_doc: ['plati', 'klDogovori'],
  hotel_reservation: ['hotel'], rent_rental: ['rent'], work_order: ['servis'], customer_vehicle: ['vozila'],
  construction_project: ['gradba'], construction_situation: ['gradba'], construction_diary: ['gradba'],
  travel_arrangement: ['tura'], travel_booking: ['tura'], appointment: ['termini'], customer_order: ['porachki'],
};
/** The firm's logo / signature / stamp appear on every printed document the client may open. */
const FIRM_IMAGE_ROLES = new Set(['logo', 'signature', 'stamp']);

/** Client access to one file (`/api/files/:id`): uploaded by them, or linked to a section they may see. */
export function klFileAllowed(links: readonly { entityType: string; role: string }[], views: readonly string[], uploadedByMe: boolean, firmImage = false): boolean {
  if (uploadedByMe || firmImage) return true;
  const V = new Set(views);
  return links.some((l) => (l.entityType === 'firm' && FIRM_IMAGE_ROLES.has(l.role)) || (FILE_ENTITY_VIEWS[l.entityType] ?? []).some((v) => V.has(v)));
}

/**
 * `null` = allowed; otherwise where to send the user (`'403'` for an API call).
 * `views` = the view ids the user may open (klient: `klAllowedViews`; never `kdogovori`, the owner's contracts).
 */
export function routeVerdict(role: GuardRole, pathname: string, views: readonly string[]): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (publicPath(p)) return null;
  const allowed = new Set(role === 'teren' ? TEREN_VIEWS : [...views, 'lozinka']);
  if (p.startsWith('/api/')) return SHARED_API.some((a) => p === a || p.startsWith(a + '/')) ? null : '403';
  if (p === '/') return ROLE_HOME[role];
  const seg = p.split('/')[1]!;
  if (seg === 'print') {
    const sub = p.split('/')[2] ?? '';
    // outgoing-document print (invoice, credit note…) when the client sees issued invoices
    if (role === 'klient' && sub === 'doc' && (allowed.has('izlez') || allowed.has('vlez'))) return null;
    return allowed.has(sub) ? null : ROLE_HOME[role];
  }
  return allowed.has(seg) ? null : ROLE_HOME[role];
}

/** Cookie of legacy `S.asClient` (👁 Преглед како клиент): the firm id the office user previews as its client. */
export const PREVIEW_COOKIE = 'wc_ascl';

/**
 * Legacy `klAllowed` while an office user previews the client portal (`S.asClient`): pages outside the client's
 * sections go back to 🏠 Почетна, `klExit` leaves the preview. API calls are not touched (the office user keeps
 * their own rights; the preview narrows only what is shown) and the klient / teren guard above is unchanged.
 */
export function previewVerdict(pathname: string, views: readonly string[]): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/api/')) return null;
  return routeVerdict('klient', p, [...views, 'klExit']);
}

/* ---------------- 🎭 demo users ---------------- */

/**
 * The views a demo user may open (`users.demo`, `lib/demo.ts`): an ALLOW-list — every view not listed here (office-wide,
 * cross-firm, system, mail history, devices, backups, the AML office register, mass mail, the all-firms checks…) is
 * refused. Bookkeeping screens of the selected demo firm (the firm itself is limited to the demo firms by
 * `principal.firms`), plus `DEMO_OFFICE_VIEWS`.
 */
export const DEMO_BOOK_VIEWS: readonly string[] = [
  // firms / start
  'firmi', 'izlezF', 'lozinka', 'pomos', 'kontroli', 'zakon', 'insp', 'lawrep', 'dosie', 'paket', 'moduli',
  // finance
  'banka', 'banke', 'devizni', 'blagajna', 'ppNal', 'fiskPer', 'kompenzacii', 'pocetna', 'nalozi', 'kartici', 'recFree', 'recon', 'bkAdv', 'bkPick', 'bkUnl',
  'kkart', 'analitika', 'poobjekti', 'bilanc', 'bbPart', 'ddv', 'ddvKnigi', 'ddvTab', 'plati', 'vraboteni', 'payPredlog', 'payGod', 'payM4', 'pdd',
  'cb_city', 'cb_paysif', 'cb_position', 'dogovori', 'pozajmici', 'prenos',
  // year end
  'zsProc', 'zsDos', 'zsNPO', 'zsTP', 'zsRok', 'zsBel', 'zsKontrola', 'zsXml', 'zs_aop', 'zs_bs', 'zs_bu', 'zs_db', 'zs_de', 'zs_pr', 'zs_skr', 'zs_sp', 'zs_vp',
  'mbyllja', 'vjetore', 'pecati',
  // archive
  'arhiva', 'arNewNav',
  // goods / production
  'skan', 'uvozMat', 'masovno', 'vlez', 'izlez', 'opomeni', 'uslugi', 'odobrenija', 'povratDob', 'efaktura', 'g_kartica', 'g_lager', 'g_lagerk',
  'normativ', 'prod', 'rasNorm', 'izlezProd', 'mrp', 'prodCost', 'lotovi', 'kalkG', 'prenosi', 'zaliha', 'profakturi', 'ispratnici', 'g_trg', 'kalkCalc',
  'g_trgv', 'uprosek',
  // retail
  'uvozMalo', 'kalkM', 'masovnoM', 'm_izlez', 'm_trg', 'kdfi', 'm_kartica', 'm_lager', 'm_lagerp', 'nivel', 'm_akcii', 'kasa',
  // industries
  'hotel', 'hotelSoby', 'hotelKniga', 'servis', 'vozila', 'delovi', 'potsetnici', 'rent', 'flota', 'rentIzv', 'gradba', 'gradbaIzv', 'tura', 'turaIzv',
  'frTuri', 'frFak', 'frDnev', 'frGor', 'frDok', 'termini', 'kartoni', 'periodicni', 'porachki', 'nabavki', 'dopolnuvanje', 'pnalozi', 'pnGorivo',
  'lojalnost', 'restoran', 'kujna',
  // analyses, fixed assets, interest
  'klDash', 'analizi', 'os', 'kamati',
  // codebooks of the firm (office-wide rows are read-only for demo, `sifrarnik/actions.ts`)
  'sifrarnik', 'partneri', 'artikli', 'uslugiS', 'artNames', 'artQ', 'artKonta', 'barkodi', 'konto', 'tarifi', 'terkovi',
  'cb_cash', 'cb_cenovnik', 'cb_country', 'cb_currency', 'cb_fgroup', 'cb_hall', 'cb_location', 'cb_municipality', 'cb_oe', 'cb_route', 'cb_store', 'cb_vehicle', 'cb_warehouse',
  // imports into the firm, AI reading (AI itself is off unless the owner allows it)
  'uvoz', 'aiCitanje',
];

/**
 * Office views a demo ADMIN sees as the owner of the sandboxed demo office — each one scoped to demo users / demo firms /
 * the demo office profile only (`lib/demo.ts`, `lib/demo-office.ts`). Views that are not provably scoped stay out.
 */
export const DEMO_OFFICE_VIEWS: readonly string[] = [
  'korisnici', 'aktivnost', 'produktivnost', 'kdogovori', 'kdfakturi', 'firmIzv', 'rokovi', 'mesIzv', 'kanc', 'mojzad', 'klInbox', 'aiTrosok',
];

/** `/print/<x>` documents of the demo firm. */
export const DEMO_PRINT: readonly string[] = [
  'analizi', 'bilanc', 'cenovnik', 'ddv04', 'ddvKniga', 'ddvKnigi', 'ddvTab', 'dnevnik', 'doc', 'fin', 'firmi', 'kalk', 'kartice', 'kkart', 'metg', 'nalog', 'prenos', 'prodKalk', 'scr',
];

/** API endpoints a demo user may call (each checks the firm itself; the firm list is the demo firms only). */
export const DEMO_API: readonly string[] = [...SHARED_API, '/api/firms', '/api/ubl'];

export const demoViews = (): ReadonlySet<string> => new Set([...DEMO_BOOK_VIEWS, ...DEMO_OFFICE_VIEWS]);

/* ---------------- the shared allow-list gate (🎭 demo and 🔒 book-only users) ---------------- */

const apiHit = (p: string, a: string) => p === a || p.startsWith(a + '/');

/**
 * One gate for every user who sees only an ALLOW-list of views (🎭 demo users, 🔒 book-only colleagues):
 * `null` = allowed; `'/'` = back to the dashboard; `'403'` for an API call. Views by the first path segment (pages,
 * route handlers and the `(print)` group live under their view's folder), `/print/<x>` by `print`, APIs by `api`.
 */
export function allowListVerdict(pathname: string, o: {
  views: ReadonlySet<string>; print: (sub: string, sub2: string) => boolean; api: (p: string) => boolean;
}): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (publicPath(p) || p === '/') return null;
  if (p.startsWith('/api/')) return o.api(p) ? null : '403';
  const [, seg = '', sub = '', sub2 = ''] = p.split('/');
  if (seg === 'print') return o.print(sub, sub2) ? null : '/';
  return o.views.has(seg) ? null : '/';
}

/**
 * Server actions by the source file that defines them (Next's server-reference manifest maps every action id to its
 * `filename`, read by `proxy.ts`): the actions of the allowed views, the shared private folders (`_ai`, `_stock`, `_fx`,
 * `_retail`, `_repost`), the firm / year picker (`app/(app)/actions.ts`), the login and the document print; the top
 * bar's actions (`top-actions.ts`: alerts, client messages) only with `top`. Anything else — the actions of every
 * blocked view — is refused before it runs, even when its id is posted to an allowed page. Unknown files are refused
 * (fail closed).
 */
export function actionAllowedFor(filename: string | null | undefined, views: ReadonlySet<string>, o: { top: boolean }): boolean {
  const f = (filename ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^apps\/web\//, '');
  if (!f) return false;
  if (f === 'app/login/actions.ts' || f.startsWith('app/print/doc/')) return true;
  const m = /^app\/\(app\)\/(.+)$/.exec(f);
  if (!m) return false;
  const rest = m[1]!;
  if (rest === 'actions.ts') return true;
  if (rest === 'top-actions.ts') return o.top;
  const seg = rest.split('/')[0]!;
  if (['_ai', '_stock', '_retail', '_repost', '_fx'].includes(seg)) return true;
  return views.has(seg);
}

/** `null` = allowed; `'/'` = back to the demo dashboard; `'403'` for an API call. */
export function demoVerdict(pathname: string): string | null {
  return allowListVerdict(pathname, {
    views: demoViews(), print: (sub) => DEMO_PRINT.includes(sub), api: (p) => DEMO_API.some((a) => apiHit(p, a)),
  });
}

/** 🎭 Server actions a demo user may call (`actionAllowedFor` over the demo views, the top bar's actions included). */
export function demoActionAllowed(filename: string | null | undefined): boolean {
  return actionAllowedFor(filename, demoViews(), { top: true });
}

/* ---------------- 🔒 book-only colleagues („Колегите гледаат само сметководство“) ---------------- */

/** `app_settings` key of the office setting „🔒 Колегите гледаат само сметководство“ (`{ on }`; ON when missing). */
export const BOOK_ONLY_KEY = 'bookOnlyColleagues';
export const bookOnlyOn = (v: unknown): boolean => !(v && typeof v === 'object' && (v as { on?: unknown }).on === false);
export const BOOK_ONLY_MSG = 'Немате пристап до овој дел од програмата (само сметководство).';

/**
 * 🔒 THE bookkeeping allow-list: what an office colleague (not the owner, not demo, not klient / teren) sees while
 * „Колегите гледаат само сметководство“ is on and the owner gave them no other access (Корисници → „Пристап до менија“).
 * Every view NOT listed here is hidden (menu, links, home widgets) and refused (route guard, server actions by file) —
 * among them: Систем (sistem, uredi, greski, semi, mailPotpis, aktivnost), Корисници, Канцеларија (kanc, mojzad,
 * baranja, tpl, autop, aml, zzlp, osnovanje), the client portal (klPortal, klInbox, klProfili, klDogovori, mesIzv),
 * contracts and fee invoices (kdogovori, kdfakturi), the owner's screens (produktivnost, aiTrosok, firmIzv), the robot,
 * laws and controls (zakoni, zakon, lawAi, lawrep, ujpZakoni, insp, kontroli), rokovi, firm administration and firm
 * documents (firmi, firmiImp, firmiResh, dosie, paket, moduli, arhiva, arNewNav), Анализи (klDash, analizi, mojIzv) with
 * analitika / poobjekti, the year end (zsProc…, zs_*, mbyllja, vjetore, prenos), the all-firm lists (izvestuvanja,
 * zatvoranje, efPrep, mpinIn, payBatch, zakoni), the legacy import (uvozStara), kursna, bankFmt, mailhist, pnLive.
 * The owner can grant any of them per user („Прилагодено“).
 */
export const BOOK_ONLY_VIEWS: readonly string[] = [
  // Финансово: statements and banks, cash, payment orders, the journal (+ dnevnik print), cards, reconciliation, trial balance
  'banka', 'devizni', 'banke', 'bkPick', 'bkUnl', 'bkAdv', 'blagajna', 'ppNal', 'fiskPer', 'kompenzacii', 'pocetna', 'nalozi',
  'kartici', 'kkart', 'recFree', 'recon', 'bilanc', 'bbPart', 'pozajmici', 'kamati',
  // ДДВ
  'ddv', 'ddvKnigi', 'ddvTab', 'pdd',
  // payroll (the МПИН of the selected firm is `plati/[month]/mpin`; the all-firms `mpinIn` / `payBatch` stay hidden), travel orders
  'plati', 'vraboteni', 'payPredlog', 'payGod', 'payM4', 'cb_city', 'cb_paysif', 'cb_position', 'dogovori', 'pnalozi', 'pnGorivo',
  // outgoing / incoming documents and stock (Материјално)
  'skan', 'uvozMat', 'masovno', 'vlez', 'izlez', 'opomeni', 'uslugi', 'odobrenija', 'povratDob', 'efaktura', 'g_kartica', 'g_lager', 'g_lagerk',
  'normativ', 'prod', 'rasNorm', 'izlezProd', 'mrp', 'prodCost', 'lotovi', 'kalkG', 'prenosi', 'zaliha', 'profakturi', 'ispratnici', 'g_trg', 'kalkCalc',
  'g_trgv', 'uprosek', 'porachki', 'nabavki', 'dopolnuvanje',
  // Малопродажба
  'uvozMalo', 'kalkM', 'masovnoM', 'm_izlez', 'm_trg', 'kdfi', 'm_kartica', 'm_lager', 'm_lagerp', 'nivel', 'm_akcii', 'kasa', 'lojalnost', 'restoran', 'kujna',
  // Дејности (the industry modules of the firm)
  'hotel', 'hotelSoby', 'hotelKniga', 'servis', 'vozila', 'delovi', 'potsetnici', 'rent', 'flota', 'rentIzv', 'gradba', 'gradbaIzv', 'tura', 'turaIzv',
  'frTuri', 'frFak', 'frDnev', 'frGor', 'frDok', 'termini', 'kartoni', 'periodicni',
  // Основни средства
  'os',
  // Шифрарник of the firm (konto: the chart; office-wide rows keep their own rights)
  'sifrarnik', 'partneri', 'artikli', 'uslugiS', 'artNames', 'artQ', 'artKonta', 'barkodi', 'konto', 'tarifi', 'terkovi',
  'cb_cash', 'cb_cenovnik', 'cb_country', 'cb_currency', 'cb_fgroup', 'cb_hall', 'cb_location', 'cb_municipality', 'cb_oe', 'cb_route', 'cb_store', 'cb_vehicle', 'cb_warehouse',
  // tools: imports into the firm, the converter, AI document reading (the AI budget guard still applies)
  'uvoz', 'konvertor', 'aiCitanje',
  // firm selection (the top-bar picker; the firms are still only the user's own), own password, help
  'izlezF', 'lozinka', 'pomos',
];

/** Always in a restricted set (also with „Прилагодено“): leaving the firm, the own password, the help. */
export const BOOK_ALWAYS_VIEWS: readonly string[] = ['izlezF', 'lozinka', 'pomos'];

/** `/print/<x>` → the views that print it (any one of them suffices). An unknown print needs the view of its name. */
const PRINT_VIEWS: Readonly<Record<string, readonly string[]>> = {
  analizi: ['analizi'], bilanc: ['bilanc'], cenovnik: ['sifrarnik', 'artikli'], ddv04: ['ddv'], ddv04All: ['ddv04All'], ddvKniga: ['ddv', 'ddvKnigi'],
  ddvKnigi: ['ddvKnigi'], ddvTab: ['ddv', 'ddvTab'], dnevnik: ['nalozi'], nalog: ['nalozi'], kkart: ['kkart'], kartice: ['g_kartica', 'm_kartica', 'zaliha'],
  doc: ['izlez', 'vlez', 'profakturi', 'ispratnici', 'porachki', 'nabavki', 'uslugi', 'odobrenija', 'm_izlez', 'periodicni', 'kasa'],
  kalk: ['kalkG', 'kalkM', 'vlez'], prodKalk: ['prodCost', 'prod'], metg: ['g_trg', 'm_trg'], prenos: ['prenosi'], scr: ['povratDob'],
  firmIzv: ['firmIzv'], firmPregled: ['firmi'], firmi: ['firmi'], izjava: ['korisnici'], klNote: ['klPortal'], produktivnost: ['produktivnost'],
};
/** `/print/fin/<doc>` (`app/print/fin/[doc]`). */
const FIN_PRINT: Readonly<Record<string, readonly string[]>> = {
  kartici: ['kartici'], sinteticka: ['kartici'], potvrda: ['kartici'], ios: ['kartici', 'analitika'], analitika: ['analitika'], pkartica: ['analitika'],
  poobjekti: ['poobjekti'], pdd: ['pdd'], pozajmica: ['pozajmici'],
};
/** API endpoints of a restricted colleague: the shared ones, the firm list (picker), the UBL e-invoice, the device check. */
const BOOK_API: readonly string[] = [...SHARED_API, '/api/firms', '/api/ubl', '/api/device-check'];
/** Other APIs → the views they belong to (open with any of them). */
const API_VIEWS: Readonly<Record<string, readonly string[]>> = {
  '/api/office/pkg': ['paket'], '/api/office/tpl': ['tpl', 'kdogovori', 'korisnici', 'aml', 'osnovanje', 'zzlp'], '/api/rokovi': ['rokovi'],
};

/** Per-user „Пристап до менија“ (`users.view_access`): `book` = the allow-list above, `full` = as before, `custom` = `views`. */
export type ViewAccessMode = 'book' | 'full' | 'custom';
export interface ViewAccess { mode: ViewAccessMode; views: string[] }
export function viewAccessClean(v: unknown): ViewAccess {
  const o = (v && typeof v === 'object' ? v : {}) as { mode?: unknown; views?: unknown };
  const mode: ViewAccessMode = o.mode === 'full' || o.mode === 'custom' ? o.mode : 'book';
  const views = mode === 'custom' && Array.isArray(o.views)
    ? [...new Set(o.views.filter((x): x is string => typeof x === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(x)))] : [];
  return { mode, views };
}

/** Who the user is for the book-only rule: `'unknown'` = the owner could not be determined (lookup failed / none set). */
export type OwnerState = 'yes' | 'no' | 'unknown';

/**
 * The views a signed-in user may open, or `null` = not restricted here (everything as before). Restricted: an office
 * colleague while the setting is on — never the owner, never a demo user (own gate), a klient or a teren user (own
 * rules). When the owner is `'unknown'` the setting does not apply to admins, so nobody can be locked out.
 */
export function restrictedViews(u: { role: string; demo?: boolean | null }, o: { on: boolean; owner: OwnerState; access: unknown }): ReadonlySet<string> | null {
  if (u.demo || u.role === 'klient' || u.role === 'teren' || !o.on) return null;
  if (o.owner === 'yes' || (o.owner === 'unknown' && u.role === 'admin')) return null;
  const a = viewAccessClean(o.access);
  if (a.mode === 'full') return null;
  return new Set([...(a.mode === 'custom' ? a.views : [...BOOK_ONLY_VIEWS, ...BOOK_READONLY_VIEWS.map((v) => RO + v)]), ...BOOK_ALWAYS_VIEWS]);
}

/** Views the default list opens read-only (their server actions are refused): the chart of accounts. „Прилагодено“ with it ticked = writable. */
export const BOOK_READONLY_VIEWS: readonly string[] = ['konto'];
const RO = '!ro:';
/** Is `view` open read-only in this restricted set? */
export const readOnlyIn = (views: ReadonlySet<string> | null, view: string): boolean => !!views?.has(RO + view);

/** 🔒 Route verdict of a restricted colleague (`null` = allowed; `'/'` = back to the dashboard; `'403'` for an API call). */
export function bookVerdict(pathname: string, views: ReadonlySet<string>): string | null {
  const any = (L: readonly string[] | undefined, dflt: string | null) => (L ?? (dflt ? [dflt] : [])).some((v) => views.has(v));
  return allowListVerdict(pathname, {
    views,
    print: (sub, sub2) => (sub === 'fin' ? any(FIN_PRINT[sub2], null) : any(PRINT_VIEWS[sub], sub)),
    api: (p) => BOOK_API.some((a) => apiHit(p, a)) || Object.entries(API_VIEWS).some(([a, L]) => apiHit(p, a) && L.some((v) => views.has(v))),
  });
}

/** 🔒 Server actions of a restricted colleague: the allowed views' files (the top bar's alerts / messages are hidden). */
export const bookActionAllowed = (filename: string | null | undefined, views: ReadonlySet<string>): boolean =>
  actionAllowedFor(filename, new Set([...views].filter((v) => !views.has(RO + v))), { top: false });
