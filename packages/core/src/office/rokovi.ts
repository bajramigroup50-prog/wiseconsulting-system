/**
 * „📅 Календар на рокови“ — statutory and agreed deadlines of every firm, generated from the firm's settings.
 *
 * Statutory dates (checked against the УЈП tax calendar, ujp.gov.mk › Даночен календар, month views, October 2026):
 * - ДДВ-04: by the 25th of the month after the tax period, for monthly AND quarterly filers („месечен или
 *   тримесечен даночен обврзник“) — filed through е-Даноци and paid on the same day;
 * - МПИН: the return by the 10th, the payment by the 15th of the month after the salary month;
 * - monthly advance of the profit tax (ДБ / МДБ) and of the personal income tax from business activity (ДЛД-ДБ):
 *   by the 15th of the month after;
 * - annual: ДБ and ДБ-ВП by 15 March when the annual account is filed electronically (28 February otherwise),
 *   ДЛД-ДБ + Образец „Б“ (sole traders) by 15 March, ДБ-НП/ВП (non-profit) by 28 February;
 * - a deadline on a Saturday, Sunday or public holiday moves to the next working day (stated on every month view of
 *   the УЈП calendar) — `rollToWorkday` with the payroll holiday list.
 *
 * Not confirmed from an official source (shown as „за проверка“, `verified: false`): ПДД-ГИ, the ДЗС statistical
 * report, the electronic annual account in the Central Register (date taken from the year-end guide `zsRok`), and the
 * АВРМ forms М1 / М2 (registration / de-registration of an employee — shown on the employment start / end date).
 *
 * Pure: the caller supplies the firm facts and stores the rows (`@wise/db` `syncRokovi`).
 */
import { rollToWorkday } from '../compliance/deadlines';
import type { YeEntity } from '../yearend';
import { addDays, daysBetween, dmy, fmtMk, MON_MK } from './dates';

export const ROK_TYPES = {
  ddv: { n: 'ДДВ-04', link: 'ddv', verified: true },
  mpin: { n: 'МПИН', link: 'plati', verified: true },
  akont: { n: 'Аконтација на данок на добивка', link: 'ppNal', verified: true },
  dld: { n: 'Аконтација ДЛД-ДБ', link: 'ppNal', verified: true },
  ye_db: { n: 'Даночен биланс ДБ / ДБ-ВП', link: 'zs_db', verified: true },
  ye_crm: { n: 'Годишна сметка – Централен регистар', link: 'zs_bs', verified: false },
  ye_tp: { n: 'ДЛД-ДБ + Образец „Б“', link: 'zsTP', verified: true },
  ye_npo: { n: 'Годишна сметка / ДБ-НП/ВП (НПО)', link: 'zsNPO', verified: true },
  pdd_gi: { n: 'ПДД-ГИ', link: 'plati', verified: false },
  dzs: { n: 'Статистички извештај (ДЗС)', link: 'zs_bs', verified: false },
  m1: { n: 'Образец М1 (пријава во осигурување)', link: 'vraboteni', verified: false },
  m2: { n: 'Образец М2 (одјава од осигурување)', link: 'vraboteni', verified: false },
  doc: { n: 'Истекува документ / лиценца', link: 'dosie', verified: true },
  kdog: { n: 'Договор за сметководствени услуги', link: 'kdogovori', verified: true },
  firm: { n: 'Рок на фирмата', link: 'dosie', verified: true },
} as const;
export type RokType = keyof typeof ROK_TYPES;
export const ROK_TYPE_IDS = Object.keys(ROK_TYPES) as RokType[];
export const isRokType = (v: unknown): v is RokType => typeof v === 'string' && v in ROK_TYPES;

/** Where the statutory date comes from (shown in the tooltip of the row). */
export const ROK_SRC: Partial<Record<RokType, string>> = {
  ddv: 'УЈП даночен календар: до 25-ти во месецот по даночниот период (месечен и тримесечен обврзник).',
  mpin: 'УЈП даночен календар: МПИН до 10-ти, плаќање до 15-ти во месецот.',
  akont: 'УЈП даночен календар: месечна аконтација на данокот на добивка до 15-ти.',
  dld: 'УЈП даночен календар: месечна аконтација ДЛД-ДБ до 15-ти.',
  ye_db: 'УЈП даночен календар: ДБ / ДБ-ВП до 15 март (при електронска годишна сметка во ЦРМ), инаку 28 февруари.',
  ye_tp: 'УЈП даночен календар: ДЛД-ДБ и Образец „Б“ до 15 март.',
  ye_npo: 'УЈП даночен календар: ДБ-НП/ВП до 28 февруари.',
  ye_crm: 'За проверка: рокот 15 март (електронски) е од „Што, каде и кога се поднесува“.',
  pdd_gi: 'За проверка: рокот не е потврден од службен извор.',
  dzs: 'За проверка: рокот не е потврден од службен извор.',
  m1: 'За проверка: пријавата се поднесува пред почетокот на работата.',
  m2: 'За проверка: одјавата се поднесува при престанок на работниот однос.',
};

export interface RokEmployee { id: string; name: string; start: string | null; end: string | null; m1Date: string | null }
export interface RokDoc { id: string; title: string; validTo: string }
export interface RokManual { id: string; title: string; due: string; done: boolean; note?: string | null }

/** Firm facts the generator needs. */
export interface RokFirm {
  id: string;
  name: string;
  vatRegistered: boolean;
  vatPeriod: string;
  entity: YeEntity;
  /** Pays the monthly profit-tax advance (default: every `co` firm not on ДБ-ВП). */
  akont?: boolean;
  employees: readonly RokEmployee[];
  docs?: readonly RokDoc[];
  /** Accounting-service contract end (owner's calendar only). */
  contract?: { no: string; end: string } | null;
  manual?: readonly RokManual[];
}

export interface Rok {
  /** Unique per firm (dedupe of the stored row and of the reminders). */
  key: string;
  firmId: string;
  type: RokType;
  title: string;
  /** `YYYY-MM`, `YYYY-Тq`, `YYYY` or a date. */
  period: string;
  /** The deadline (moved to the next working day). */
  due: string;
  /** The date in the law (before moving). */
  legal: string;
  /** View that does the work. */
  link: string;
  verified: boolean;
  /** Pre-set done (manual firm deadlines, М1 with a registration date). */
  done?: boolean;
  note?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymOf = (d: string) => d.slice(0, 7);
const ymAddN = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number) as [number, number]; const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
const monthEnd = (ym: string) => { const [y, m] = ym.split('-').map(Number) as [number, number]; return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const mmYYYY = (ym: string) => `${ym.slice(5, 7)}.${ym.slice(0, 4)}`;

/** Month label „септември 2026“. */
export const rokMonthName = (ym: string): string => `${MON_MK[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function mk(f: RokFirm, type: RokType, period: string, legal: string, title: string, extra: Partial<Rok> = {}): Rok {
  const T = ROK_TYPES[type];
  // statutory dates move to the next working day; documents / contracts / agreed dates stay as entered
  const roll = !['doc', 'kdog', 'firm', 'm1', 'm2'].includes(type);
  return { key: `${type}:${period}`, firmId: f.id, type, title, period, due: roll ? rollToWorkday(legal) : legal, legal, link: T.link, verified: T.verified, ...extra };
}

/** Employee worked (was employed) at some day of month `ym`. */
const employedIn = (e: RokEmployee, ym: string) => (!e.start || e.start <= monthEnd(ym)) && (!e.end || e.end >= `${ym}-01`);

/**
 * Deadlines of a firm whose due date falls in `[from, to]` (inclusive, `YYYY-MM-DD`).
 * Generated from the firm's settings: VAT payer and period, entity type (year-end forms), employees (МПИН, М1/М2),
 * dossier documents with a validity date, the service contract and the manual firm deadlines.
 */
export function rokGenerate(f: RokFirm, from: string, to: string): Rok[] {
  const R: Rok[] = [];
  const inRange = (r: Rok) => r.due >= from && r.due <= to;
  const push = (r: Rok) => { if (inRange(r)) R.push(r); };
  // obligations for month M are due in M+1 (or M+1 after the quarter): walk the months M from (from − 4) to `to`
  const first = ymAddN(ymOf(from), -4), last = ymOf(to);
  for (let ym = first; ym <= last; ym = ymAddN(ym, 1)) {
    const nx = ymAddN(ym, 1);
    const m = Number(ym.slice(5, 7));
    if (f.vatRegistered) {
      if (f.vatPeriod === 'month') push(mk(f, 'ddv', ym, `${nx}-25`, `ДДВ-04 за ${mmYYYY(ym)}`));
      else if (m % 3 === 0) { const q = `${ym.slice(0, 4)}-Т${m / 3}`; push(mk(f, 'ddv', q, `${nx}-25`, `ДДВ-04 за ${m / 3}. тримесечје ${ym.slice(0, 4)}`)); }
    }
    if (f.employees.some((e) => employedIn(e, ym))) push(mk(f, 'mpin', ym, `${nx}-10`, `МПИН за ${mmYYYY(ym)} (плаќање до 15-ти)`));
    if (f.entity === 'co' && f.akont !== false) push(mk(f, 'akont', ym, `${nx}-15`, `Аконтација данок на добивка за ${mmYYYY(ym)}`));
    if (f.entity === 'tp' || f.entity === 'sd') push(mk(f, 'dld', ym, `${nx}-15`, `Аконтација ДЛД-ДБ за ${mmYYYY(ym)}`));
  }
  // year-end obligations for the business year Y − 1, due in Y
  for (let Y = Number(from.slice(0, 4)); Y <= Number(to.slice(0, 4)); Y++) {
    const y = String(Y - 1);
    if (f.entity === 'co') {
      push(mk(f, 'ye_db', y, `${Y}-03-15`, `Даночен биланс ДБ / ДБ-ВП за ${y}`, { note: 'При хартиена годишна сметка рокот е 28 февруари.' }));
      push(mk(f, 'ye_crm', y, `${Y}-03-15`, `Годишна сметка за ${y} – Централен регистар (електронски)`));
      push(mk(f, 'dzs', y, `${Y}-03-15`, `Статистички извештај за ${y} (ДЗС)`));
    }
    if (f.entity === 'tp' || f.entity === 'sd') push(mk(f, 'ye_tp', y, `${Y}-03-15`, `ДЛД-ДБ + Образец „Б“ за ${y}`));
    if (f.entity === 'npo') push(mk(f, 'ye_npo', y, `${Y}-02-28`, `Годишна сметка / ДБ-НП/ВП за ${y} (НПО)`));
    if (f.employees.some((e) => employedIn(e, `${y}-12`) || employedIn(e, `${y}-06`))) push(mk(f, 'pdd_gi', y, `${Y}-01-31`, `ПДД-ГИ за ${y}`));
  }
  for (const e of f.employees) {
    if (e.start) push(mk(f, 'm1', e.id, e.start, `Образец М1 – ${e.name} (почеток ${e.start.split('-').reverse().join('.')})`, { key: `m1:${e.id}`, done: !!e.m1Date }));
    if (e.end) push(mk(f, 'm2', e.id, e.end, `Образец М2 – ${e.name} (престанок ${e.end.split('-').reverse().join('.')})`, { key: `m2:${e.id}` }));
  }
  for (const d of f.docs ?? []) push(mk(f, 'doc', d.id, d.validTo, `Истекува: ${d.title}`, { key: `doc:${d.id}` }));
  if (f.contract?.end) push(mk(f, 'kdog', f.contract.no || f.contract.end, f.contract.end, `Истекува договорот за сметководствени услуги ${f.contract.no}`.trim(), { key: `kdog:${f.contract.no || f.contract.end}` }));
  for (const d of f.manual ?? []) push(mk(f, 'firm', d.id, d.due, d.title, { key: `firm:${d.id}`, done: d.done, note: d.note ?? undefined }));
  return R.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}

/* ---------------- paid from the bank statements ---------------- */

/**
 * One outgoing bank-statement line of the firm (booked or only imported), as the payment rule reads it.
 * `amount` is the signed MKD amount in denars (− outflow).
 */
export interface RokPayLine {
  id: string;
  date: string;
  amount: number;
  desc?: string | null;
  name?: string | null;
  purpose?: string | null;
  /** Bank reference / „Повикување на број“ as imported. */
  bref?: string | null;
  counterAccount?: string | null;
  /** Booked counter konto (null = not booked). */
  konto?: string | null;
  split?: readonly { k: string }[] | null;
  /** Payroll month the bank matching assigned (`payMatch`: contributions / PIT / net of that run). */
  payRef?: string | null;
  /** Statement number (извод бр.). */
  statementNo?: string | null;
}

/** Kontos of the firm's own posting schemes the rule accepts as evidence. */
export interface RokPayKontos {
  /** Profit-tax liability (the bank suggestion books a ПП50 „данок на добивка“ there; year-end `taxPayable` 2330). */
  profitTax: string;
  /** Payroll contribution liabilities (pay_pio / pay_zdr / pay_dop / pay_vrab / pay_contrib). */
  contrib: readonly string[];
}

export interface RokPayment { lineIds: string[]; date: string; no: string | null; amount: number; note: string }

/** Treasury account of the Budget at NBRM (ПП50 recipient `PP_BUDGET_ACC` / `PP_TREZOR` 100000000063095). */
const TREASURY_ACC = /^(MK07)?100000000063/;
const TREASURY_TXT = /трезор|буџет на (р\.?\s?с?\.?\s?м|република|рсм)|управа за јавни приходи|(^|[^а-ш])ујп([^а-ш]|$)|народна банка/;
/** Revenue codes of the ПП50 templates (`PP_TAX`): 711212 = profit-tax advance; the others identify a different tax. */
const AKONT_CODE = /711212/;
const akontWords = (t: string) => /аконтациј/.test(t) && /добивк/.test(t);
const NOT_AKONT = /711216|714116|7111\d\d|713113|ддв|данок на додадена|персонален|придонес|мпин|годишен|доплат|данок на имот|(^|[^а-ш])пио([^а-ш]|$)/;
const CONTRIB_TXT = /придонес|пензиск|здравствен|невработен|мпин|(^|[^а-ш])пио([^а-ш]|$)|(^|[^а-ш])фзо/;
const NOT_CONTRIB = /711212|711216|714116|ддв|данок на додадена|добивк|данок на имот/;

/**
 * Periods (`YYYY-MM`) a line names: the ПП50 „Повикување на број“ `01MMYYYY-DDMMYYYY` and „за MM/YYYY“.
 * `'*'` marks a reference that spans several months (an annual / quarterly payment) — not a monthly obligation.
 */
export function rokPayPeriods(text: string): string[] {
  const out = new Set<string>();
  const t = String(text ?? '');
  for (const m of t.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{4})\s*-\s*(\d{2})(\d{2})(\d{4})(?!\d)/g)) {
    out.add(m[2] === m[5] && m[3] === m[6] && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[3]}-${m[2]}` : '*');
  }
  const rest = t.replace(/(?<!\d)\d{8}\s*-\s*\d{8}(?!\d)/g, ' ').replace(/(?<!\d)\d{1,2}[./]\d{1,2}[./]\d{4}(?!\d)/g, ' ');
  for (const m of rest.matchAll(/(?<![\d./])(0?[1-9]|1[0-2])\s*[/.]\s*(20\d\d)(?!\d)/g)) out.add(`${m[2]}-${m[1]!.padStart(2, '0')}`);
  return [...out];
}

/**
 * Was the profit-tax advance (`akont`) or the МПИН payment (`mpin`) of month `period` paid? Evidence (conservative —
 * anything ambiguous gives null):
 * - an OUTGOING line to the Treasury (account 100000000063… or the Budget / УЈП / НБРМ as the counterparty) — or, for
 *   МПИН, a line the bank matching already tied to that payroll month (`payRef`) on a contribution konto;
 * - identifying the obligation: the revenue code 711212 / „аконтација … добивка“ (advance), contribution words / МПИН
 *   (МПИН); otherwise the booked konto of the firm's scheme (profit-tax liability / contribution liabilities); a line
 *   that also names a different tax is ignored;
 * - in time: a line that names its period (Повикување на број / „за MM/YYYY“ / payRef) must name exactly this month
 *   (it may be paid late); a line without a period counts only in the month of the deadline.
 */
export function rokPaymentEvidence(r: { type: string; period: string }, L: readonly RokPayLine[], K: RokPayKontos): RokPayment | null {
  if ((r.type !== 'akont' && r.type !== 'mpin') || !/^\d{4}-\d{2}$/.test(r.period)) return null;
  const ym = r.period, nx = ymAddN(ym, 1);
  const contrib = new Set(K.contrib.filter((k) => k && k !== '-'));
  const hit: RokPayLine[] = [];
  for (const l of L) {
    if (!(Number(l.amount) < 0)) continue;
    const t = [l.desc, l.name, l.purpose, l.bref].filter(Boolean).join(' ').toLowerCase();
    const acc = String(l.counterAccount ?? '').replace(/\s+/g, '').toUpperCase();
    const treasury = TREASURY_ACC.test(acc) || TREASURY_TXT.test(t);
    const P = rokPayPeriods(t);
    const splitK = (l.split ?? []).map((x) => x.k);
    let ok = false;
    let per: string[] = P;
    if (r.type === 'akont') {
      if (!treasury || NOT_AKONT.test(t)) continue;
      if (AKONT_CODE.test(t) || akontWords(t)) ok = true;
      // booked on the profit-tax liability without any text: only on time, and not in March (the annual top-up)
      else if (K.profitTax && l.konto === K.profitTax && !splitK.length && !P.length && nx.slice(5) !== '03') ok = true;
    } else if (l.payRef && /^\d{4}-\d{2}$/.test(l.payRef) && [l.konto ?? '', ...splitK].some((k) => contrib.has(k)) && !NOT_CONTRIB.test(t)) {
      ok = true;
      per = [l.payRef, ...P];
    } else if (treasury && !NOT_CONTRIB.test(t) && (CONTRIB_TXT.test(t) || (!!l.konto && contrib.has(l.konto)) || splitK.some((k) => contrib.has(k)))) ok = true;
    if (!ok) continue;
    const ps = [...new Set(per)];
    if (ps.length > 1 || ps[0] === '*') continue;
    if (ps.length === 1) { if (ps[0] !== ym || l.date < `${ym}-01`) continue; }
    else if (l.date < `${nx}-01` || l.date > monthEnd(nx)) continue;
    hit.push(l);
  }
  if (!hit.length) return null;
  hit.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const f = hit[0]!;
  const amount = Math.round(hit.reduce((a, l) => a + Math.abs(Number(l.amount)), 0) * 100) / 100;
  const no = f.statementNo?.trim() || null;
  const more = new Set(hit.map((l) => `${l.statementNo ?? ''}|${l.date}`)).size > 1 ? ' и др.' : '';
  return { lineIds: hit.map((l) => l.id), date: f.date, no, amount, note: `${ROK_PAID_NOTE}извод${no ? ` бр. ${no}` : ''} од ${dmy(f.date)}${more}, ${fmtMk(amount)} ден.)` };
}

/** Note prefix of a deadline marked done from the bank statements (the calendar sync keeps it). */
export const ROK_PAID_NOTE = '✓ платено (';

/* ---------------- state and reminders ---------------- */

export type RokState = 'done' | 'late' | 'today' | 'soon' | 'open';

/** Done; late (past due); today; soon (within `days`); open. */
export function rokState(today: string, due: string, done: boolean, days = 5): RokState {
  if (done) return 'done';
  const n = daysBetween(today, due);
  return n < 0 ? 'late' : n === 0 ? 'today' : n <= days ? 'soon' : 'open';
}

export const ROK_STATE_LBL: Record<RokState, [string, string]> = {
  done: ['✓ направено', 'good'], late: ['поминат рок', 'bad'], today: ['денес', 'bad'], soon: ['наскоро', 'warn'], open: ['отворено', 'info'],
};

/** Reminder settings (office profile `rok`). */
export interface RokSettings {
  /** Remind N days before the deadline (in-app + e-mail to the responsible colleague). */
  days?: number;
  /** E-mail the responsible colleagues (only when SMTP is configured). */
  mail?: boolean;
  /** Client reminders („Ве молиме доставете ги изводите / фактурите…“). */
  client?: { on?: boolean; day?: number; mail?: boolean; portal?: boolean };
}
export const rokDays = (s: RokSettings | null | undefined): number => { const v = Number(s?.days); return s?.days != null && Number.isFinite(v) && v >= 0 ? Math.min(60, Math.round(v)) : 5; };

/** The day the colleague's reminder goes out: `days` before the deadline. */
export const rokRemindOn = (due: string, days: number): string => addDays(due, -Math.max(0, days));

/** A reminder is due on `today` for an open deadline that entered its window and is not more than 30 days late. */
export function rokRemindDue(today: string, r: { due: string; done: boolean }, days: number): boolean {
  if (r.done) return false;
  return today >= rokRemindOn(r.due, days) && daysBetween(r.due, today) <= 30;
}

/** Day of the month on which the client reminder for the previous month goes out (1–28, default 3). */
export const rokClientDay = (s: RokSettings | null | undefined): number => Math.min(28, Math.max(1, Math.round(Number(s?.client?.day ?? 3)) || 3));

/**
 * The client reminder due on `today`: the month it asks documents for (the previous month) — or null when today is
 * not the configured day or client reminders are off.
 */
export function rokClientDue(today: string, s: RokSettings | null | undefined): string | null {
  if (!s?.client?.on) return null;
  if (Number(today.slice(8, 10)) !== rokClientDay(s)) return null;
  return ymAddN(today.slice(0, 7), -1);
}

/** Text of the client reminder for month `ym`. */
export function rokClientText(ym: string, o: { firm: string; office?: string | null; days?: number }): { subject: string; body: string } {
  const mon = rokMonthName(ym);
  return {
    subject: `Документи за ${mon} – ${o.firm}`,
    body: `Почитувани,\n\nВе молиме доставете ги изводите / фактурите за месец ${mon} (влезни и излезни фактури, банкарски изводи, благајна и останатите документи), за навремено книжење и поднесување на пријавите.\n\nДокументите можете да ги испратите преку порталот („📤 Испрати документ“) или по е-пошта.\n\nСо почит,\n${o.office || 'Сметководствена канцеларија'}`,
  };
}

/** Text of the colleague's reminder. */
export function rokReminderText(r: Pick<Rok, 'title' | 'due' | 'verified'>, firm: string): { subject: string; body: string } {
  const d = r.due.split('-').reverse().join('.');
  return {
    subject: `Рок ${d}: ${r.title} – ${firm}`,
    body: `Потсетник: ${r.title}\nФирма: ${firm}\nРок: ${d}${r.verified ? '' : '\n(датумот е за проверка)'}\n\nОтворете го „📅 Календар на рокови“ во програмата за да го означите како направено.`,
  };
}

/* ---------------- calendar helpers ---------------- */

/** Weeks (Monday first) of month `ym`: 6 × 7 dates, `null` outside the month. */
export function rokMonthGrid(ym: string): (string | null)[][] {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: dim }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const W: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) W.push(cells.slice(i, i + 7));
  return W;
}

export const rokYmAdd = ymAddN;

/* ---------------- ICS export ---------------- */

const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets (RFC 5545 §3.1), never inside a UTF-8 sequence. */
/** UTF-8 length of one code point. */
export const utf8Len = (ch: string): number => { const c = ch.codePointAt(0) ?? 0; return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = utf8Len(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** iCalendar (all-day events) of the deadlines; `firm` names the firm of each row. */
export function rokIcs(rows: readonly (Pick<Rok, 'key' | 'firmId' | 'title' | 'due' | 'verified'> & { firm: string; done?: boolean; url?: string })[], stamp: string): string {
  const d8 = (d: string) => d.replace(/-/g, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WISE CONSULTING//Kalendar na rokovi//MK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Рокови – WISE'];
  for (const r of rows) {
    L.push('BEGIN:VEVENT',
      `UID:${r.firmId}-${r.key.replace(/[^\w.-]/g, '_')}@wise`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d8(r.due)}`,
      `DTEND;VALUE=DATE:${d8(addDays(r.due, 1))}`,
      `SUMMARY:${icsEsc(`${r.done ? '✓ ' : ''}${r.title} – ${r.firm}`)}`,
      `DESCRIPTION:${icsEsc(`${r.firm}: ${r.title}${r.verified ? '' : ' (датумот е за проверка)'}`)}`,
      ...(r.url ? [`URL:${r.url}`] : []),
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}
