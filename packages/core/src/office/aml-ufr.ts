/**
 * AML / УФР practice layer (ЗСППФТ): ongoing monitoring of the books (cash ≥ threshold incl. linked transactions,
 * payments with high-risk countries), deadlines (working days, Skopje holidays), the 10-year retention lock, the
 * client file completeness checklist (CDD), the extended risk assessment and the open-task list for the dashboard.
 *
 * Pure: no DB, no clock — every function takes `today`. Money is handled in whole denar cents (integers) when
 * summed or compared, never as floats. The legal references live in `AML_REF` (see docs/legal/AML-UFR.md).
 */
import { mkHolidays } from '../payroll/calendar';
import { addDays, addMonths, daysBetween } from './dates';
import { AML_LEVELS, AML_LV, amlRisk, type AmlAuto, type AmlFile, type AmlLevel, type AmlRisk } from './aml';

/* ------------------------------------------------------------------ law constants */

/** Article references used in the UI, the documents and the compliance matrix (docs/legal/AML-UFR.md). */
export const AML_LAW = 'Закон за спречување перење пари и финансирање на тероризам („Службен весник на РСМ“ бр. 151/2022 и 208/2024)';

/** Threshold for cash transactions (single or linked), in EUR (denar counter-value at the NBRM middle rate). */
export const AML_CASH_EUR = 15000;
/** Records (CDD, reports, evidence) are kept this many years after the end of the business relationship / the transaction. */
export const AML_RETENTION_YEARS = 10;
/**
 * „Поврзани готовински трансакции“ (чл. 2 т.14): two or more cash transactions of the same client / beneficiary
 * within one working day. `AML_SPLIT_DAYS` is the office's wider window for the *pattern* „split under the threshold“
 * (an indicator for the suspicion review, not the statutory definition). Office setting.
 */
export const AML_LINK_WORKDAYS = 1;
export const AML_SPLIT_DAYS = 30;
/** Office setting name (`linkDays`) = the split-pattern window. */
export const AML_LINK_DAYS = AML_SPLIT_DAYS;
/** Cash payment ban for goods and services (чл. 58 + чл. 204): 1.000 € since 01.01.2025 — an indicator for the review. */
export const AML_CASH_BAN_EUR = 1000;

/* ------------------------------------------------------------------ money & dates */

/** Denars → integer cents (the only form in which amounts are summed / compared). */
export const amlCents = (n: number | string | null | undefined): number => Math.round((Number(n) || 0) * 100);
/** Threshold in denar cents for `eur` at the given EUR rate. */
export const amlThresholdCents = (eurRate: number, eur = AML_CASH_EUR): number => Math.round(eur * (Number(eurRate) || 61.5) * 100);

const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const holSet = new Map<number, Set<string>>();
function holidays(y: number): Set<string> {
  let s = holSet.get(y);
  if (!s) { s = new Set(mkHolidays(y).map((h) => h.date)); holSet.set(y, s); }
  return s;
}
/** Not Saturday / Sunday and not a public holiday in North Macedonia (non-working days for everyone). */
export const amlWorkDay = (d: string): boolean => { const w = dow(d); return w !== 0 && w !== 6 && !holidays(Number(d.slice(0, 4))).has(d); };
/** `n` working days after `d` (n = 0 → `d` itself if it is a working day, else the next working day). */
export function amlAddWorkDays(d: string, n: number): string {
  let x = d;
  while (!amlWorkDay(x)) x = addDays(x, 1);
  for (let i = 0; i < n; i++) { x = addDays(x, 1); while (!amlWorkDay(x)) x = addDays(x, 1); }
  return x;
}

/* ------------------------------------------------------------------ reports to УФР & deadlines */

/**
 * Kinds of rows in `aml_reports` (`data.kind`; legacy rows without a kind are internal reports):
 *  - `int`   internal report of an employee to the compliance officer;
 *  - `alert` automatic monitoring alert from the books (review queue);
 *  - `str`   report of a suspicious transaction / activity to УФР;
 *  - `ctr`   report of a cash transaction ≥ 15.000 € (single or linked) to УФР.
 */
export const AML_KINDS = ['int', 'alert', 'str', 'ctr', 'ref', 'bo'] as const;
export type AmlKind = (typeof AML_KINDS)[number];
export const AML_KIND_LBL: Record<AmlKind, string> = {
  int: 'Внатрешна пријава', alert: 'Сигнал од мониторинг', str: 'Извештај за сомнителна трансакција/активност до УФР (чл. 65)', ctr: 'Извештај за готовинска трансакција ≥ 15.000 € до УФР (чл. 63)',
  ref: 'Известување до УФР за одбиен / прекинат деловен однос (чл. 46)', bo: 'Пријава до УФР за несогласување со Регистарот на вистински сопственици (чл. 32)',
};
/** Kinds that are reports *to УФР* (they have a deadline, a submission date and a УФР reference). */
export const AML_UFR_KINDS: readonly AmlKind[] = ['str', 'ctr', 'ref', 'bo'];
export const amlIsUfrKind = (k: AmlKind) => AML_UFR_KINDS.includes(k);
export const amlKindOf = (d: unknown): AmlKind => {
  const k = (d as { kind?: unknown } | null)?.kind;
  return typeof k === 'string' && (AML_KINDS as readonly string[]).includes(k) ? (k as AmlKind) : 'int';
};

/**
 * Deadline (date) for a report to УФР, from the day the obligation arose:
 *  - `str` (чл. 65): immediately; the complete report at the latest within 24 hours of learning of the suspicion →
 *    the next calendar day (the hour is kept in the report itself);
 *  - `ctr` (чл. 63): at the latest within 3 working days of the transaction;
 *  - `bo` (чл. 32 „веднаш“) and `ref` (чл. 46, no term in the law) — the program's rule: the next working day;
 *  - `int` / `alert`: the officer decides by the next working day (program rule; an STR then has its own 24 hours).
 */
export function amlDeadline(kind: AmlKind, from: string): string {
  if (kind === 'str') return addDays(from, 1);
  if (kind === 'ctr') return amlAddWorkDays(addDays(from, 1), 2);
  return amlAddWorkDays(addDays(from, 1), 0);
}

export type AmlDue = 'done' | 'late' | 'today' | 'soon' | 'ok';
export function amlDueState(due: string | null | undefined, today: string, done: boolean): AmlDue {
  if (done) return 'done';
  if (!due) return 'ok';
  if (due < today) return 'late';
  if (due === today) return 'today';
  return daysBetween(today, due) <= 2 ? 'soon' : 'ok';
}

/* ------------------------------------------------------------------ retention lock */

/**
 * End of the 10-year retention: from the end of the business relationship (client file) or the date of the
 * report / transaction. While a client relationship is open (`end` null) the records are kept indefinitely.
 */
export function amlRetainUntil(from: string | null | undefined): string | null {
  return from ? addMonths(from.slice(0, 10), 12 * AML_RETENTION_YEARS) : null;
}
/** Deletion is allowed only after the retention period has expired (never while the relationship lasts). */
export function amlCanPurge(from: string | null | undefined, today: string): boolean {
  const u = amlRetainUntil(from);
  return !!u && u < today;
}

/* ------------------------------------------------------------------ monitoring of the books */

/** A line on a monetary account (100–108) with the counter-party read from the same journal. */
export interface AmlMoneyLine {
  /** Stable id (journal id + line no) — the alert de-duplication key is built from it. */
  key: string;
  date: string;
  account: string;
  debit: number;
  credit: number;
  partnerId: string | null;
  partnerName: string;
  country?: string | null;
  doc?: string | null;
  /** Every other line of the journal is also a money account (cash deposit to the bank, withdrawal…): not a client transaction. */
  transfer?: boolean;
}
export type AmlRule = 'cash' | 'cashLinked' | 'cashSplit' | 'hrc';
export const AML_RULE_LBL: Record<AmlRule, string> = {
  cash: 'Готовинска трансакција ≥ 15.000 € (чл. 63)',
  cashLinked: 'Поврзани готовински трансакции во еден работен ден, збир ≥ 15.000 € (чл. 2 т.14, чл. 63)',
  cashSplit: 'Готовина поделена под прагот (индикатор, прозорец на канцеларијата)',
  hrc: 'Плаќање/наплата со лице од високоризична земја (чл. 43)',
};
export interface AmlAlertDraft { key: string; rule: AmlRule; date: string; amount: number; dir: 'in' | 'out'; partnerId: string | null; partnerName: string; refs: string[]; text: string }

/** Cash accounts: 102 (благајна во денари) and 105 (благајна во странска валута). */
export const amlIsCash = (account: string) => /^10[25]/.test(account);
/** Monetary accounts 100–108 (трансакциски / девизни сметки, благајна…). */
export const amlIsMoney = (account: string) => /^10[0-8]/.test(account);

const fmtD = (c: number) => (c / 100).toFixed(2);

/**
 * High-risk country match on the partner's country (ISO code or Macedonian/English name). `list` entries are ISO
 * codes or names, compared case-insensitively; names match as whole words.
 */
export function amlCountryRisky(country: string | null | undefined, list: readonly string[]): boolean {
  const c = String(country ?? '').trim().toLowerCase();
  if (!c || c === 'mk' || c === 'mkd') return false;
  return list.some((x) => {
    const y = x.trim().toLowerCase();
    if (!y) return false;
    if (y.length <= 3) return c === y;
    return c === y || c.includes(y);
  });
}

/**
 * Legacy had no monitoring of the books for УФР thresholds — server addition. Scans the money lines of one firm:
 *  - `cash`: a single cash receipt / payment ≥ threshold;
 *  - `cashLinked`: several cash transactions of the same counter-party and direction, each below the threshold,
 *    within `linkDays`, that together reach it (greedy, non-overlapping windows — deterministic);
 *  - `hrc`: any payment / receipt (100–108) with a counter-party from the high-risk country list.
 * The key of each alert is stable, so a re-scan never duplicates an alert that is already in the queue.
 */
export function amlScan(lines: readonly AmlMoneyLine[], o: { eurRate: number; thresholdEur?: number; linkDays?: number; hrc?: readonly string[] }): AmlAlertDraft[] {
  const thr = amlThresholdCents(o.eurRate, o.thresholdEur ?? AML_CASH_EUR);
  const days = Math.max(1, Math.round(o.linkDays ?? AML_SPLIT_DAYS));
  const out: AmlAlertDraft[] = [];
  const L = [...lines].filter((l) => amlIsMoney(l.account)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const amt = (l: AmlMoneyLine) => Math.abs(amlCents(l.debit) - amlCents(l.credit));
  const dirOf = (l: AmlMoneyLine): 'in' | 'out' => (amlCents(l.debit) >= amlCents(l.credit) ? 'in' : 'out');
  const dirLbl = (d: 'in' | 'out') => (d === 'in' ? 'наплата (прилив)' : 'плаќање (одлив)');
  const cash = L.filter((l) => amlIsCash(l.account) && amt(l) > 0 && !l.transfer);
  for (const l of cash) {
    const a = amt(l);
    if (a >= thr) {
      out.push({ key: `cash:${l.key}`, rule: 'cash', date: l.date, amount: a / 100, dir: dirOf(l), partnerId: l.partnerId, partnerName: l.partnerName, refs: [l.key],
        text: `Готовинска ${dirLbl(dirOf(l))} ${fmtD(a)} ден.${l.partnerName ? ` – ${l.partnerName}` : ''}${l.doc ? ` (док. ${l.doc})` : ''}` });
    }
  }
  // linked: per counter-party (named) and direction
  const groups = new Map<string, AmlMoneyLine[]>();
  for (const l of cash) {
    if (amt(l) >= thr) continue;
    const who = l.partnerId ?? (l.partnerName ? `n:${l.partnerName.trim().toLowerCase()}` : null);
    if (!who) continue;
    const g = `${who}|${dirOf(l)}`;
    groups.set(g, [...(groups.get(g) ?? []), l]);
  }
  // statutory linked transactions: within one working day (the later one at most on the next working day)
  const inLink = (first: string, d: string) => d <= amlAddWorkDays(addDays(first, 1), AML_LINK_WORKDAYS - 1);
  const used = new Set<string>();
  const windows = (G: AmlMoneyLine[], fits: (first: string, d: string) => boolean, rule: 'cashLinked' | 'cashSplit') => {
    let win: AmlMoneyLine[] = [];
    let sum = 0;
    for (const l of G) {
      if (used.has(l.key)) continue;
      while (win.length && !fits(win[0]!.date, l.date)) { sum -= amt(win[0]!); win = win.slice(1); }
      win.push(l); sum += amt(l);
      if (sum >= thr && win.length >= 2) {
        const f = win[0]!, d = dirOf(f);
        for (const x of win) used.add(x.key);
        out.push({ key: `${rule === 'cashLinked' ? 'linked' : 'split'}:${f.key}`, rule, date: l.date, amount: sum / 100, dir: d, partnerId: f.partnerId, partnerName: f.partnerName, refs: win.map((x) => x.key),
          text: `${win.length} ${rule === 'cashLinked' ? 'поврзани готовински трансакции (во еден работен ден)' : 'готовински трансакции под прагот'} (${dirLbl(d)}) од ${f.date} до ${l.date}, вкупно ${fmtD(sum)} ден.${f.partnerName ? ` – ${f.partnerName}` : ''}` });
        win = []; sum = 0;
      }
    }
  };
  for (const [, G] of groups) windows(G, inLink, 'cashLinked');
  for (const [, G] of groups) windows(G, (first, d) => daysBetween(first, d) < days, 'cashSplit');
  if (o.hrc?.length) {
    for (const l of L) {
      if (!amt(l) || l.transfer || !amlCountryRisky(l.country, o.hrc)) continue;
      out.push({ key: `hrc:${l.key}`, rule: 'hrc', date: l.date, amount: amt(l) / 100, dir: dirOf(l), partnerId: l.partnerId, partnerName: l.partnerName, refs: [l.key],
        text: `${dirOf(l) === 'in' ? 'Наплата од' : 'Плаќање кон'} ${l.partnerName || 'лице'} (${l.country}) – ${fmtD(amt(l))} ден.` });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
}

/* ------------------------------------------------------------------ client file (CDD) */

/** Extended client file (stored in `aml_records.data` next to the legacy `AmlFile` fields). */
export interface AmlCdd extends AmlFile {
  /** Business relationship: start (CDD must be complete before it), end (starts the 10-year retention). */
  relStart?: string | null;
  relEnd?: string | null;
  /** Date when the CDD measures were completed (identification + verification). */
  cddDone?: string | null;
  /** Services the office provides (nature of the relationship). */
  services?: string;
  client?: { legalForm?: string; seat?: string; crNo?: string; activity?: string; bankAccounts?: string };
  repX?: { idIssuer?: string; address?: string; cit?: string; dob?: string; verMethod?: string; verDate?: string | null; role?: string };
  /** Authorised person (ополномоштеник) if someone other than the legal representative acts for the client. */
  proxy?: { name?: string; embg?: string; idNo?: string; basis?: string };
  /** Beneficial owners — ЦРСМ (Регистар на вистински сопственици) check. */
  crsm?: { date?: string | null; result?: 'match' | 'mismatch' | 'none' | ''; discReported?: string | null; note?: string };
  pepDecl?: { date?: string | null; isPep?: boolean; fn?: string; relation?: string };
  /** Sanctions screening (UN Security Council consolidated list, national restrictive measures, EU). */
  sanc?: { date?: string | null; lists?: string; result?: 'none' | 'possible' | 'hit' | ''; by?: string; note?: string };
  /** Enhanced due diligence. */
  edd?: { reason?: string; measures?: string; mgrBy?: string; monitoring?: string };
  /** Simplified due diligence (only with a documented low risk). */
  simplified?: boolean;
  simplifiedReason?: string;
  /** CDD could not be completed → relationship refused / terminated (and the officer considers a report). */
  refused?: { date?: string | null; reason?: string };
  /** Risk assessment history (each save that changed level or a periodic review). */
  hist?: { date: string; level: AmlLevel; score: number; by?: string; factors?: string[] }[];
}

/** Checklist of the CDD file: [id, label, ok]. */
export function amlCddChecklist(A: AmlCdd, X: AmlAuto | null, level: AmlLevel, today: string): [string, string, boolean][] {
  const bo = A.bo?.length ? A.bo : X?.bo ?? [];
  const enh = level === 'high' || level === 'midhi' || !!A.pep || bo.some((b) => b.pep) || !!A.hrc;
  const L: [string, string, boolean][] = [
    ['cr', 'Тековна состојба од Централен регистар (не постара од 6 месеци при воспоставување)', !!A.crDate],
    ['rep', 'Законски застапник идентификуван (име, ЕМБГ, документ за идентификација)', !!(A.rep?.name && A.rep?.idNo)],
    ['repVer', 'Идентитетот на застапникот верификуван (оригинален документ / квалификуван е-потпис)', !!A.rep?.ver],
    ['bo', 'Вистински сопственик/ци утврдени', bo.length > 0],
    ['boVer', 'Вистинските сопственици проверени (датум на проверка)', bo.length > 0 && bo.every((b) => !!b.ver)],
    ['crsm', 'Проверка во Регистарот на вистински сопственици (ЦРСМ) – датум и резултат', !!(A.crsm?.date && A.crsm?.result)],
    ['crsmDisc', 'Неусогласеност со Регистарот пријавена до ЦРСМ', A.crsm?.result !== 'mismatch' || !!A.crsm?.discReported],
    ['purpose', 'Цел и намена на деловниот однос', !!A.purpose],
    ['source', 'Извор на средства', !!A.source],
    ['pep', 'Изјава за носител на јавна функција (PEP) добиена', !!(A.pepDecl?.date || A.pepAsked)],
    ['sanc', 'Проверка во листите на санкции (ОН / ограничувачки мерки) – во последните 12 месеци', !!A.sanc?.date && A.sanc.date >= addMonths(today, -12) && !!A.sanc.result],
    ['sancHit', 'Нема совпаѓање со листите на санкции (или е одлучено и пријавено)', A.sanc?.result !== 'hit'],
  ];
  if (enh) {
    L.push(['wealth', 'Засилена анализа: потекло на имотот и средствата', !!A.wealth]);
    L.push(['mgr', 'Засилена анализа: одобрение од раководството за воспоставување / продолжување', !!A.mgrOk]);
  }
  if (A.simplified) L.push(['simp', 'Поедноставена анализа: образложен низок ризик', level === 'low' && !!A.simplifiedReason]);
  return L;
}

/** Hard / extra factors the books-based legacy score does not know (sanctions, CDD not completed). */
export function amlRiskFull(A: AmlCdd, X: AmlAuto | null, o: { eurRate: number; today: string; year?: string | number; nkd?: string | null }): AmlRisk {
  const r = amlRisk(A, X, o);
  const F = [...r.factors];
  let s = r.score, hard = false;
  if (A.sanc?.result === 'hit') { F.push(['Совпаѓање со листа на санкции / ограничувачки мерки', 5]); s += 5; hard = true; }
  else if (A.sanc?.result === 'possible') { F.push(['Можно совпаѓање со листа на санкции (за проверка)', 3]); s += 3; hard = true; }
  if (A.crsm?.result === 'mismatch' || A.crsm?.result === 'none') { F.push([A.crsm.result === 'none' ? 'Вистинскиот сопственик не е запишан во Регистарот (ЦРСМ)' : 'Неусогласеност со Регистарот на вистински сопственици', 1]); s += 1; }
  if (A.refused?.date) { F.push(['Анализата не може да се спроведе (однос одбиен / прекинат)', 3]); s += 3; hard = true; }
  let level = r.level;
  if (hard) level = 'high';
  else if (s !== r.score) {
    const auto: AmlLevel = s >= 5 ? 'high' : s >= 3 ? 'midhi' : s >= 1 ? 'mid' : 'low';
    if (AML_LEVELS.indexOf(auto) > AML_LEVELS.indexOf(level)) level = auto;
  }
  return { factors: F, score: s, level, enhanced: r.enhanced || hard || level === 'high' || level === 'midhi' };
}

/** Next periodic review: the level's interval after the last review / creation (legacy `amlNext` semantics). */
export const amlReviewMonths = (lv: AmlLevel) => AML_LV[lv][1];

/* ------------------------------------------------------------------ office self-assessment */

/** Risk factors of the office's own assessment: [id, group, label]. Score each 1 (низок) – 3 (висок). */
export const AML_SELF_FACTORS = [
  ['cl', 'Клиенти', 'Структура на клиентите (правни лица, сложени структури, нерезиденти, PEP)'],
  ['clCash', 'Клиенти', 'Клиенти од готовински интензивни дејности'],
  ['geo', 'Географски', 'Поврзаност на клиентите со високоризични / странски земји'],
  ['svc', 'Услуги', 'Видови услуги (книговодство, плати, даночни пријави, основање фирми, застапување)'],
  ['ch', 'Канали', 'Начин на воспоставување на односот (без лично присуство, преку посредници)'],
  ['int', 'Внатрешно', 'Внатрешна организација, обученост на вработените и контроли'],
] as const;
export type AmlSelfId = (typeof AML_SELF_FACTORS)[number][0];
export interface AmlSelf { date: string; scores: Partial<Record<AmlSelfId, number>>; note?: string; measures?: string; by?: string }

export function amlSelfLevel(S: Pick<AmlSelf, 'scores'>): { avg: number; level: 'low' | 'mid' | 'high' } {
  const v = AML_SELF_FACTORS.map(([k]) => Number(S.scores[k]) || 0).filter((x) => x >= 1 && x <= 3);
  if (!v.length) return { avg: 0, level: 'high' };
  const avg = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
  return { avg, level: avg >= 2.34 || (v.includes(3) && avg >= 2) ? 'high' : avg >= 1.67 ? 'mid' : 'low' };
}

/* ------------------------------------------------------------------ open tasks (dashboard) */

export interface AmlOfficeState {
  officer?: string; deputy?: string; offUid?: string; appointed?: string | null; ufrNotified?: string | null;
  tr?: { date: string; topic: string; who?: string }[]; ctl?: string; ctlLog?: { date: string; period?: string; findings?: string; measures?: string; by?: string }[];
  self?: AmlSelf | null; selfHist?: AmlSelf[]; prog?: string | null;
}
export interface AmlTask { firmId: string | null; firm: string; text: string; due: string | null; sev: 'bad' | 'warn' | 'info'; tab: string }

export function amlTasks(a: {
  today: string;
  office: AmlOfficeState;
  clients: { id: string; name: string; rec: { data: AmlCdd; level: AmlLevel; nextReview: string | null } | null }[];
  reports: { id: string; firmId: string | null; firmName: string; status: string; data: Record<string, unknown>; createdAt: string }[];
}): AmlTask[] {
  const T: AmlTask[] = [];
  const { today: td, office: O } = a;
  const y = td.slice(0, 4);
  if (!O.officer) T.push({ firmId: null, firm: 'Канцеларија', text: 'Не е определено овластено лице и заменик', due: null, sev: 'bad', tab: 'off' });
  else if (!O.ufrNotified) T.push({ firmId: null, firm: 'Канцеларија', text: 'Не е евидентирано известувањето до УФР за овластеното лице / заменикот', due: null, sev: 'warn', tab: 'off' });
  if (!O.prog) T.push({ firmId: null, firm: 'Канцеларија', text: 'Не е донесена (евидентирана) Програма за спроведување на мерките', due: null, sev: 'bad', tab: 'off' });
  if (!O.self?.date) T.push({ firmId: null, firm: 'Канцеларија', text: 'Нема проценка на ризик на канцеларијата', due: null, sev: 'bad', tab: 'off' });
  else if (addMonths(O.self.date, 12) < td) T.push({ firmId: null, firm: 'Канцеларија', text: 'Проценката на ризик на канцеларијата е постара од 12 месеци', due: addMonths(O.self.date, 12), sev: 'warn', tab: 'off' });
  const tr = (O.tr ?? []).filter((t) => t.date.startsWith(y)).length;
  if (tr < 2) T.push({ firmId: null, firm: 'Канцеларија', text: `Обуки во ${y}: ${tr} (програмата предвидува најмалку 2)`, due: `${y}-12-31`, sev: 'warn', tab: 'off' });
  const lastCtl = [O.ctl, ...(O.ctlLog ?? []).map((c) => c.date)].filter(Boolean).sort().pop();
  if (!lastCtl || !lastCtl.startsWith(y)) T.push({ firmId: null, firm: 'Канцеларија', text: `Годишна внатрешна контрола за ${y} не е евидентирана`, due: `${y}-12-31`, sev: 'warn', tab: 'off' });
  for (const c of a.clients) {
    const r = c.rec;
    if (!r) { T.push({ firmId: c.id, firm: c.name, text: 'Нема анализа на клиентот (CDD) ни проценка на ризик', due: null, sev: 'bad', tab: 'cl' }); continue; }
    const A = r.data;
    if (A.relEnd) continue;
    const miss = amlCddChecklist(A, null, r.level, td).filter(([, , ok]) => !ok);
    if (miss.length) T.push({ firmId: c.id, firm: c.name, text: `Нецелосна анализа: ${miss.map(([, t]) => t.split(' (')[0]).slice(0, 3).join('; ')}${miss.length > 3 ? ` (+${miss.length - 3})` : ''}`, due: null, sev: miss.some(([k]) => ['bo', 'rep', 'sancHit', 'mgr'].includes(k)) ? 'bad' : 'warn', tab: 'cl' });
    if (r.nextReview && r.nextReview <= td) T.push({ firmId: c.id, firm: c.name, text: `Периодичен преглед на анализата (ризик ${AML_LV[r.level][0]})`, due: r.nextReview, sev: r.nextReview < td ? 'bad' : 'warn', tab: 'cl' });
  }
  for (const x of a.reports) {
    const k = amlKindOf(x.data);
    const due = typeof x.data.due === 'string' ? x.data.due : null;
    const ufr = amlIsUfrKind(k);
    const open = ufr ? !x.data.submitted : x.status === 'нова' || x.status === 'анализа';
    if (!open) continue;
    const s = amlDueState(due, td, false);
    T.push({ firmId: x.firmId, firm: x.firmName || '—', text: `${AML_KIND_LBL[k]}${ufr ? ' – да се достави до УФР' : ' – одлука на овластеното лице'}`, due, sev: s === 'late' || s === 'today' || k === 'str' ? 'bad' : 'warn', tab: k === 'alert' ? 'mon' : 'rep' });
  }
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return T.sort((p, q) => rank[p.sev] - rank[q.sev] || String(p.due ?? '9999').localeCompare(String(q.due ?? '9999')) || p.firm.localeCompare(q.firm, 'mk'));
}

/* ------------------------------------------------------------------ the УФР report form */

/**
 * Fields of the report to УФР for non-bank entities (Правилник за формата, видот и категориите на податоци од
 * извештајот, Сл. весник 240/2024: т.1 обврзник/контакт, т.2.1–2.4 физички и правни лица и поврзаност, т.4 активност,
 * т.5 вид на сомневање, индикатори, опис, претходни извештаи, т.6 прилог). The report itself is submitted through the
 * УФР electronic system; this is the content prepared and kept in the register. [key, label, multi-line]
 */
export const AML_UFR_FIELDS: readonly (readonly [string, string, boolean])[] = [
  ['contact', 'т.1 Обврзник – лице за контакт / овластено лице (име, телефон, е-пошта)', false],
  ['subjects', 'т.2.1 Физички лица (име и презиме, ЕМБГ / датум на раѓање, адреса, документ за идентификација, државјанство)', true],
  ['legal', 'т.2.2–2.3 Правни лица (назив, ЕДБ, ЕМБС, седиште, застапник, вистински сопственик)', true],
  ['relation', 'т.2.4 Поврзаност меѓу лицата', true],
  ['activity', 'т.4 Активност / трансакција (вид, начин, тек на средствата)', true],
  ['amount', 'Износ (ден. / валута)', false],
  ['txDate', 'Датум на трансакцијата / активноста', false],
  ['partner', 'Друга страна во трансакцијата', false],
  ['suspType', 'т.5 Вид на сомневање (перење пари / финансирање тероризам / друго)', false],
  ['indicators', 'т.5 Индикатори (од Листата на индикатори на УФР)', true],
  ['desc', 'т.5 Опис на сомневањето и образложение', true],
  ['prev', 'т.5 Претходни извештаи за истите лица', false],
] as const;
export const AML_UFR_FIELD_KEYS = AML_UFR_FIELDS.map(([k]) => k);

/** Date the 10-year retention of a report row starts from: submission to УФР, else the officer's decision (чл. 62 ст.1, 3). */
export function amlRetentionBase(data: unknown): string | null {
  const D = (data ?? {}) as { submitted?: string; decision?: { at?: string } };
  if (amlIsUfrKind(amlKindOf(D))) return D.submitted ?? null;
  return D.decision?.at ?? null;
}
