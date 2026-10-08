/**
 * Employment contracts, HR registry and disciplinary documents — the pure parts (legacy `CT_TYPES`,
 * `addMonthsEnd`, `DURS`, `ctDefaults`, `ctWarnings`, `extWarn`, `nextHrNo`, `docCode`, `DI_*`,
 * `diAddM`, `diWarn`, `PN_TYPES`, `pnOpen`). HTML templates live in the web app.
 *
 * DELIBERATE FIXES:
 *  - FIX (LEGACY-MAP 6.4 #16): `hrNextNo` is used whenever a contract/annex/decision is saved without a
 *    number. Legacy `ctSave` stored `no:''`, giving the id `hr-contract-{empId}-` that the next unnumbered
 *    save silently overwrote. The registry table additionally has a unique (firm, number) index.
 *  - FIX (#17): the document control code is stored on the registry row (and verified by a query), not
 *    in one global read-modify-write document (`appsettings/doccodes`).
 *  - The default leave entitlement (20 days, repeated four times in legacy, #21) is `HR_LEAVE_DAYS`.
 */
import { g4n } from './calc';
import type { PayParams } from './params';

type Num = number | string | null | undefined;
const n = (v: Num): number => +(v as number) || 0;

export const HR_LEAVE_DAYS = 20;

export type HrContractType = 'neopr' | 'opr' | 'skr' | 'sez' | 'dom';
export const HR_CT_TYPES: readonly (readonly [HrContractType, string])[] = [
  ['neopr', 'на неопределено време'],
  ['opr', 'на определено време'],
  ['skr', 'со скратено работно време'],
  ['sez', 'за сезонска работа'],
  ['dom', 'за работа од дома / на далечина'],
];
export const hrCtTypeName = (t: unknown): string => HR_CT_TYPES.find((x) => x[0] === t)?.[1] || '';
/** Fixed-term contract types (have an end date). */
export const hrFixedTerm = (t: unknown): boolean => t === 'opr' || t === 'sez';

/** Contract durations offered in the editor (months). */
export const HR_DURS = [1, 2, 3, 4, 6, 9, 12, 18, 24, 36] as const;

/** End date of a contract of `months` starting on `start` (day before the same day `months` later). */
export function hrAddMonthsEnd(start: string | null | undefined, months: Num): string {
  if (!start || !n(months)) return '';
  const d = new Date(start + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n(months));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Contract terms (legacy `employees.ct`). */
export interface HrContract {
  type: HrContractType;
  no: string;
  signDate: string;
  place: string;
  start: string;
  end: string;
  reason: string;
  position: string;
  duties: string;
  workPlace: string;
  hours: number;
  probation: number | '';
  gross: number;
  net: number;
  leave: number;
  notice: number;
  rep: string;
  repRole: string;
  firstStart?: string;
}

export interface HrFirm {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  edb?: string | null;
  embs?: string | null;
  signer?: string | null;
  signerRole?: string | null;
}

export interface HrEmployee {
  id?: string;
  name?: string | null;
  embg?: string | null;
  address?: string | null;
  position?: string | null;
  contract?: string | null;
  start?: string | null;
  end?: string | null;
  netBase?: Num;
  coef?: Num;
  leaveDays?: Num;
}

/** New contract proposal from the employee card (legacy `ctDefaults`); `saved` terms win. */
export function hrCtDefaults(e: HrEmployee, f: HrFirm, P: PayParams, today: string, saved?: Partial<HrContract> | null): HrContract {
  const gross = n(e.netBase) ? g4n(n(e.netBase) * (n(e.coef) || 1), P, n(P.exempt)) : 0;
  return {
    type: e.contract === 'определено' ? 'opr' : 'neopr',
    no: '',
    signDate: today,
    place: f.city || 'Скопје',
    start: e.start || today,
    end: e.end || '',
    reason: '',
    position: e.position || '',
    duties: '',
    workPlace: [f.address, f.city].filter(Boolean).join(', '),
    hours: n(e.coef) && n(e.coef) < 1 ? Math.round(40 * n(e.coef)) : 40,
    probation: '',
    gross,
    net: n(e.netBase),
    leave: n(e.leaveDays) || HR_LEAVE_DAYS,
    notice: 1,
    rep: f.signer || '',
    repRole: f.signerRole || 'Управител',
    ...(saved || {}),
  };
}

const YEAR_MS = 31557600000;
const dmy = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '');

/** Contract checks (legacy `ctWarnings`); `taken` = registry numbers already used by other documents. */
export function hrCtWarnings(c: Partial<HrContract>, P: Pick<PayParams, 'minGross'>, taken: readonly string[] = []): string[] {
  const W: string[] = [];
  if (hrFixedTerm(c.type)) {
    if (!c.end) W.push('За определено време задолжително внесете датум до кога важи договорот.');
    if (c.end && c.start && c.end <= c.start) W.push('Датумот „до“ мора да е по датумот на започнување.');
    if (c.start && c.end && (Date.parse(c.end) - Date.parse(c.start)) / YEAR_MS > 5)
      W.push('Договорот на определено време не треба да трае подолго од 5 години (вклучително и продолжувањата) – по тоа работникот се смета вработен на неопределено време.');
    if (!c.reason && c.type === 'opr') W.push('Препорачливо: наведете причина за определено време (замена, зголемен обем на работа, проект…).');
  }
  if (c.type === 'skr' && n(c.hours) >= 40) W.push('Скратено работно време: внесете помалку од 40 часа неделно.');
  if (n(c.probation) > 6) W.push('Пробната работа не може да трае подолго од 6 месеци.');
  if (c.gross && n(c.hours) >= 40 && n(c.gross) < n(P.minGross)) W.push(`Бруто платата е под минималната (${n(P.minGross)}).`);
  if (!c.position) W.push('Внесете работно место.');
  if (c.no && taken.includes(c.no)) W.push('Деловодниот број ' + c.no + ' веќе е искористен.');
  return W;
}

/** Extension / transformation of a fixed-term contract (legacy annex/decision `x`). */
export interface HrExtension {
  kind: 'ext' | 'transform';
  doc: 'annex' | 'odluka';
  no?: string;
  date: string;
  end?: string;
  reason?: string;
}

/** Checks before extending (legacy `extWarn`). */
export function hrExtWarnings(c: Partial<HrContract>, x: HrExtension): string[] {
  const W: string[] = [];
  const first = c.firstStart || c.start;
  if (x.kind !== 'transform') {
    if (!x.end) W.push('Внесете нов датум „до“.');
    if (x.end && c.end && x.end <= c.end) W.push('Новиот датум мора да е по сегашниот крај (' + dmy(c.end) + ').');
    if (first && x.end) {
      const y = (Date.parse(x.end) - Date.parse(first)) / YEAR_MS;
      if (y > 5)
        W.push(`Вкупното траење на определено од ${dmy(first)} би било ${y.toFixed(1)} години – над 5 години работникот по закон се смета вработен на неопределено време. Користете „Трансформирај во неопределено“.`);
    }
  }
  return W;
}

/** Next registry number for the year of `date`: `{prefix}{n}/{yyyy}` (legacy `nextHrNo`). */
export function hrNextNo(existing: readonly { no: string | null; date: string | null }[], date: string, prefix = ''): string {
  const y = date.slice(0, 4);
  const nums = existing.filter((d) => String(d.date || '').startsWith(y)).map((d) => parseInt(String(d.no || '').replace(prefix, '')) || 0);
  return prefix + ((nums.length ? Math.max(...nums) : 0) + 1) + '/' + y;
}

/**
 * Document control code (legacy `docCode`): two 32-bit FNV-style hashes over the JSON of the
 * document's content, shown as `XXXX-XXXX-XXXX`. Any change of the content changes the code.
 */
export function hrDocCode(o: unknown): string {
  const t = JSON.stringify(o || {});
  let a = 0x811c9dc5,
    b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c + i;
    b = Math.imul(b, 0x5bd1e995) >>> 0;
    b ^= b >>> 13;
  }
  const x = ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).toUpperCase();
  return x.slice(0, 4) + '-' + x.slice(4, 8) + '-' + x.slice(8, 12);
}

/** Control code of an employment contract (legacy `ctCode`). */
export function hrContractCode(firmId: string, e: { id?: string; name?: string | null; embg?: string | null; address?: string | null }, c: Partial<HrContract> & Record<string, unknown>): string {
  const K = ['type', 'no', 'signDate', 'start', 'end', 'position', 'duties', 'gross', 'net', 'hours', 'leave', 'notice', 'probation', 'sp', 'ncMonths', 'ncComp', 'workPlace', 'rep', 'repRole', 'obl'];
  const o: Record<string, unknown> = {};
  for (const k of K) o[k] = (c as Record<string, unknown>)[k] ?? '';
  return hrDocCode({ t: 'ct', f: firmId, e: e.id, n: e.name, m: e.embg, a: e.address, o });
}

/* ---------------- Disciplinary measures and termination (legacy v522) ---------------- */

export type HrDiKind = 'warn' | 'mera' | 'otkaz' | 'spog' | 'quit' | 'istek';
export const HR_DI_KIND: readonly (readonly [HrDiKind, string])[] = [
  ['warn', 'Писмено предупредување (пред отказ)'],
  ['mera', 'Решение за дисциплинска мерка'],
  ['otkaz', 'Отказ од работодавачот'],
  ['spog', 'Спогодбено раскинување'],
  ['quit', 'Отказ од работникот – потврда'],
  ['istek', 'Престанок – истек на определено време'],
];
export const HR_DI_GR: readonly (readonly [string, string])[] = [
  ['licna', 'лична причина (однесување, недостаток на знаења или способности) – член 76 став 1 точка 1'],
  ['vina', 'вина – кршење на договорните и другите обврски (член 76 став 1 точка 2 и член 81), со отказен рок'],
  ['vina_bez', 'вина – потешка повреда, без отказен рок (член 82)'],
  ['delovni', 'деловни причини (економски, организациони, технолошки, структурни) – член 76 став 1 точка 3'],
];
export const HR_DI_VIOL: readonly string[] = [
  'непочитување на работниот ред и дисциплина',
  'неизвршување или несовесно и ненавремено извршување на работните обврски',
  'непочитување на прописите за начинот на работа',
  'непочитување на работното време и распоредот на работното време',
  'неоправдано отсуство од работа или ненавремено известување за отсуство',
  'неизвестување за спреченост за работа поради болест во рок од 48 часа',
  'несовесно ракување со средствата за работа',
  'непријавување на штета, грешки или пропусти во работата',
  'непочитување на прописите за безбедност и здравје при работа',
  'недолично или насилно однесување на работа',
  'злоупотреба на средствата на работодавачот',
  'одавање деловна тајна или неовластено изнесување податоци и документи',
];

/** Disciplinary / termination document data (legacy `S.di.x`). */
export interface HrDiDoc {
  kind: HrDiKind;
  no?: string;
  date: string;
  days?: number;
  mtype?: 'opomena' | 'kazna';
  pct?: number;
  months?: number;
  from?: string;
  heard?: string;
  ground?: string;
  notice?: number;
  last?: string;
  wref?: string;
  sev?: number;
  recv?: string;
  short?: boolean;
  viol?: string[];
  facts?: string;
}

/** Date `m` months after `d` (legacy `diAddM`). */
export function hrAddMonths(d: string, m: Num): string {
  const x = new Date(d + 'T12:00:00Z');
  if (Number.isNaN(x.getTime())) return d;
  x.setUTCMonth(x.getUTCMonth() + n(m));
  return x.toISOString().slice(0, 10);
}

/** Last working day implied by notice (legacy change handler 15680). */
export function hrDiLastDay(x: HrDiDoc): string | undefined {
  if (x.kind === 'otkaz' && x.ground === 'vina_bez') return x.date;
  if (x.kind === 'otkaz') return hrAddMonths(x.date, x.notice ?? 1);
  if (x.kind === 'quit') return hrAddMonths(x.recv || x.date, x.notice ?? 1);
  return x.last;
}

/** Legal checks for a disciplinary document (legacy `diWarn`). */
export function hrDiWarnings(x: HrDiDoc): string[] {
  const W: string[] = [];
  if (x.kind === 'mera' && x.mtype === 'kazna') {
    if (!(n(x.pct) > 0) || n(x.pct) > 15) W.push('Паричната казна е најмногу 15% од последната месечна нето плата.');
    if (!(n(x.months) >= 1) || n(x.months) > 6) W.push('Паричната казна трае од 1 до 6 месеци.');
  }
  if (x.kind === 'otkaz') {
    if ((x.ground === 'licna' || x.ground === 'vina') && !x.wref)
      W.push('За отказ поради лична причина или вина (со отказен рок) прво е потребно писмено предупредување – внесете го бројот/датумот или направете „Писмено предупредување“.');
    if (x.ground === 'vina_bez' && !(x.viol || []).length) W.push('Изберете ја повредата поради која е отказот без отказен рок.');
  }
  if ((x.kind === 'mera' || x.kind === 'otkaz') && !x.facts) W.push('Внесете образложение (што, кога, како е сторено).');
  if (x.kind === 'mera' && !x.heard) W.push('Препорачливо: работникот прво да се изјасни (внесете датум на изјаснување).');
  if (['otkaz', 'spog', 'quit', 'istek'].includes(x.kind))
    W.push('По престанокот: одјава од задолжително социјално осигурување (М2 / АВРМ) во законскиот рок, конечна пресметка на плата и неискористен годишен одмор, и враќање на опремата и пристапите (корисничката сметка во програмата).');
  return W;
}

/** Termination kinds that end the employment (`diApply`). */
export const hrDiEnds = (k: string): boolean => ['otkaz', 'spog', 'quit', 'istek'].includes(k);

/* ---------------- HR registry kinds ---------------- */

/** Registry document kinds: contracts and their annexes/decisions, disciplinary docs, leave and sick leave. */
export type HrDocKind = 'contract' | 'annex' | 'odluka' | `di-${HrDiKind}` | 'leave' | 'sick';

/** Registry label (FIX #15: legacy labelled every non-contract/annex document "Одлука – продолжување"). */
export function hrDocLabel(d: { kind: string; ctype?: string | null; transform?: boolean | null }): string {
  if (d.kind === 'contract') return 'Договор ' + hrCtTypeName(d.ctype);
  if (d.kind === 'annex') return d.transform ? 'Анекс – трансформација во неопределено' : 'Анекс – продолжување';
  if (d.kind === 'odluka') return d.transform ? 'Одлука – трансформација во неопределено' : 'Одлука – продолжување';
  if (d.kind === 'leave') return 'Решение за годишен одмор';
  if (d.kind === 'sick') return 'Боледување (евиденција)';
  if (d.kind.startsWith('di-')) return HR_DI_KIND.find((k) => 'di-' + k[0] === d.kind)?.[1] || 'Дисциплинска мерка';
  return d.kind;
}

/* ---------------- Pay-change notes (legacy `PN_TYPES`, `pnOpen`) ---------------- */

export const PAY_NOTE_TYPES = [
  'Нов вработен',
  'Престанок на работа',
  'Промена на плата / коефициент',
  'Боледување',
  'Годишен одмор / неплатено отсуство',
  'Прекувремена / дополнителни часови',
  'Бонус / награда',
  'Одбивка (кредит, аконтација, задршка)',
  'Друго',
] as const;

/** Open notes that block the payroll of `month` (legacy `pnOpen`: not done and valid from ≤ month). */
export function payNotesOpen<T extends { done: boolean; month: string | null }>(notes: readonly T[], month?: string): T[] {
  return notes.filter((x) => !x.done && (!month || String(x.month || '') <= month));
}
