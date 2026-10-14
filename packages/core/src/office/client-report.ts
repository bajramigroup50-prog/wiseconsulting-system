/**
 * „📊 Месечен извештај за клиентот“ — per firm and month: revenue, expenses, result, VAT to pay and its due date,
 * receivables older than 60 days, payables, money in bank + cash and the key changes vs the previous month.
 *
 * Every number is computed deterministically from the books (free): ledger lines for revenue / expenses (`isRev` /
 * `isExp`, the control dashboard's classes, the year-close journal excluded) and money (accounts 10…), the open issued
 * invoices / purchases for receivables / payables, the VAT period computation for VAT. The optional AI summary
 * (`clientReportPrompt`) gets ONLY these numbers — no firm name, partner, person or document data.
 */
import { isExp, isRev } from '../firms/dash';

export type ReportLang = 'mk' | 'sq';
export const REPORT_LANGS: Record<ReportLang, string> = { mk: 'македонски', sq: 'албански (shqip)' };
export const isReportLang = (v: unknown): v is ReportLang => v === 'mk' || v === 'sq';

/** 'YYYY-MM' */
export const isReportPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** First and last day of a month period. */
export function monthBounds(p: string): [string, string] {
  const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7));
  return [`${p}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
}
/** The month before. */
export function prevMonth(p: string): string {
  const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** The last finished month before `today` (the default report period). */
export const lastFinishedMonth = (today: string): string => prevMonth(today.slice(0, 7));

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

export interface ReportLine { account: string; debit: number; credit: number; date: string; kind?: string | null }

/** Revenue and expenses of the lines dated in [from, to] (year-close journal excluded). */
export function ledgerTotals(L: readonly ReportLine[], from: string, to: string): { rev: number; exp: number } {
  let rev = 0, exp = 0;
  for (const l of L) {
    if (l.kind === 'close' || l.date < from || l.date > to) continue;
    if (isRev(l.account)) rev += (+l.credit || 0) - (+l.debit || 0);
    else if (isExp(l.account)) exp += (+l.debit || 0) - (+l.credit || 0);
  }
  return { rev: r2(rev), exp: r2(exp) };
}

/** Money (bank + cash, accounts 10…) at `to`, from the business year's lines (opening journal included, close excluded). */
export function moneyAt(L: readonly ReportLine[], to: string): number {
  const from = `${to.slice(0, 4)}-01-01`;
  let s = 0;
  for (const l of L) if (l.kind !== 'close' && l.date >= from && l.date <= to && l.account.startsWith('10')) s += (+l.debit || 0) - (+l.credit || 0);
  return r2(s);
}

/** An open issued invoice / purchase: remaining amount in denars, due date (or the document date). */
export interface OpenDoc { remaining: number; date: string; due: string | null }

/** Receivables: total open, and the part more than 60 days past due at `asOf`. */
export function receivablesAt(D: readonly OpenDoc[], asOf: string): { total: number; over60: number; n60: number } {
  let total = 0, over60 = 0, n60 = 0;
  for (const d of D) {
    if (d.date > asOf || d.remaining <= 0.005) continue;
    total += d.remaining;
    if (daysBetween(d.due || d.date, asOf) > 60) { over60 += d.remaining; n60++; }
  }
  return { total: r2(total), over60: r2(over60), n60 };
}

/** Payables: total open and the part already past due at `asOf`. */
export function payablesAt(D: readonly OpenDoc[], asOf: string): { total: number; overdue: number } {
  let total = 0, overdue = 0;
  for (const d of D) {
    if (d.date > asOf || d.remaining <= 0.005) continue;
    total += d.remaining;
    if (daysBetween(d.due || d.date, asOf) > 0) overdue += d.remaining;
  }
  return { total: r2(total), overdue: r2(overdue) };
}

export interface ReportVat {
  /** VAT period id ('YYYY-MM' or 'YYYY-Тq'). */
  period: string;
  /** positive = to pay, negative = refund */
  amount: number;
  due: string;
  /** the return is filed (frozen numbers) */
  closed: boolean;
  /** the month ends before the quarter does: amount so far */
  partial: boolean;
}

export interface ReportChange { key: 'rev' | 'exp' | 'res' | 'cash'; cur: number; prev: number; diff: number; pct: number | null }

export interface ClientReportData {
  period: string;
  from: string;
  to: string;
  rev: number;
  exp: number;
  res: number;
  prev: { period: string; rev: number; exp: number; res: number; cash: number };
  cash: number;
  recv: { total: number; over60: number; n60: number };
  pay: { total: number; overdue: number };
  vat: ReportVat | null;
  changes: ReportChange[];
}

export interface ClientReportInput {
  period: string;
  /** ledger lines from Jan 1 of the previous month's year up to the end of the month */
  lines: readonly ReportLine[];
  invoices: readonly OpenDoc[];
  purchases: readonly OpenDoc[];
  vat: ReportVat | null;
}

const pct = (a: number, b: number): number | null => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

/** The report's numbers (deterministic). */
export function buildClientReport(i: ClientReportInput): ClientReportData {
  const [from, to] = monthBounds(i.period);
  const pp = prevMonth(i.period);
  const [pf, pt] = monthBounds(pp);
  const cur = ledgerTotals(i.lines, from, to), prv = ledgerTotals(i.lines, pf, pt);
  const cash = moneyAt(i.lines, to), cashPrev = moneyAt(i.lines, pt);
  const res = r2(cur.rev - cur.exp), pres = r2(prv.rev - prv.exp);
  const ch = (key: ReportChange['key'], a: number, b: number): ReportChange => ({ key, cur: a, prev: b, diff: r2(a - b), pct: pct(a, b) });
  return {
    period: i.period, from, to, rev: cur.rev, exp: cur.exp, res,
    prev: { period: pp, rev: prv.rev, exp: prv.exp, res: pres, cash: cashPrev },
    cash, recv: receivablesAt(i.invoices, to), pay: payablesAt(i.purchases, to), vat: i.vat,
    changes: [ch('rev', cur.rev, prv.rev), ch('exp', cur.exp, prv.exp), ch('res', res, pres), ch('cash', cash, cashPrev)],
  };
}

/* ---------------- texts (mk / sq) ---------------- */

const MON: Record<ReportLang, readonly string[]> = {
  mk: ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'],
  sq: ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'],
};
/** „октомври 2026“ / „tetor 2026“ */
export const periodLabel = (p: string, lang: ReportLang = 'mk'): string => `${MON[lang][Number(p.slice(5, 7)) - 1] ?? ''} ${p.slice(0, 4)}`;

export const CR_TXT: Record<ReportLang, Record<string, string>> = {
  mk: {
    title: 'Месечен извештај', rev: 'Приходи', exp: 'Расходи', res: 'Резултат', profit: 'добивка', loss: 'загуба',
    vat: 'ДДВ за плаќање', vatRefund: 'ДДВ за поврат', vatDue: 'рок', vatPartial: 'досега во кварталот', vatFiled: 'поднесена пријава', noVat: 'не е ДДВ обврзник',
    recv: 'Купувачите ни должат', recv60: 'од тоа постаро од 60 дена', pay: 'Должиме на добавувачи', payLate: 'од тоа доспеано', cash: 'Пари (банка + каса)',
    changes: 'Главни промени во однос на минатиот месец', cash2: 'Пари', summary: 'Краток преглед', note: 'Бројките се од прокнижените документи. Износите се во денари.',
    up: 'пораст', down: 'пад', same: 'без промена', inv: 'фактури', den: 'ден.',
  },
  sq: {
    title: 'Raport mujor', rev: 'Të ardhurat', exp: 'Shpenzimet', res: 'Rezultati', profit: 'fitim', loss: 'humbje',
    vat: 'TVSH për pagesë', vatRefund: 'TVSH për kthim', vatDue: 'afati', vatPartial: 'deri tani në tremujor', vatFiled: 'deklarata e dorëzuar', noVat: 'nuk është i regjistruar për TVSH',
    recv: 'Blerësit na detyrohen', recv60: 'prej tyre më të vjetra se 60 ditë', pay: 'Detyrime ndaj furnitorëve', payLate: 'prej tyre me afat të kaluar', cash: 'Para (bankë + arkë)',
    changes: 'Ndryshimet kryesore krahasuar me muajin e kaluar', cash2: 'Para', summary: 'Përmbledhje e shkurtër', note: 'Shifrat janë nga dokumentet e kontabilizuara. Shumat janë në denarë.',
    up: 'rritje', down: 'rënie', same: 'pa ndryshim', inv: 'fatura', den: 'den.',
  },
};

const fmtN = (n: number) => Math.round(n).toLocaleString('de-DE');
const dmy = (d: string) => d.split('-').reverse().join('.');

/** One line per change: „Приходи: 120.000 (пораст 20 %)“. */
export function changeLines(d: ClientReportData, lang: ReportLang = 'mk'): string[] {
  const T = CR_TXT[lang];
  const name: Record<ReportChange['key'], string> = { rev: T.rev!, exp: T.exp!, res: T.res!, cash: T.cash2! };
  return d.changes.map((c) => {
    const dir = Math.abs(c.diff) < 1 ? T.same : c.diff > 0 ? T.up : T.down;
    const p = c.pct == null || Math.abs(c.diff) < 1 ? '' : ` ${Math.abs(c.pct).toLocaleString('de-DE')} %`;
    return `${name[c.key]}: ${fmtN(c.cur)} ${T.den} (${dir}${p}${Math.abs(c.diff) >= 1 ? `, ${c.diff > 0 ? '+' : '−'}${fmtN(Math.abs(c.diff))}` : ''}; ${fmtN(c.prev)} → ${fmtN(c.cur)})`;
  });
}

/**
 * Prompt for the optional AI summary: ONLY the report's numbers (no firm / partner / person names, no ЕДБ, no
 * documents). Plain language, 4–6 short sentences, in the client's language.
 */
export function clientReportPrompt(d: ClientReportData, lang: ReportLang = 'mk'): string {
  const nums = {
    period: d.period, revenue: d.rev, expenses: d.exp, result: d.res,
    previousMonth: { revenue: d.prev.rev, expenses: d.prev.exp, result: d.prev.res, money: d.prev.cash },
    moneyBankAndCash: d.cash,
    receivables: { total: d.recv.total, olderThan60Days: d.recv.over60, invoicesOlderThan60Days: d.recv.n60 },
    payables: { total: d.pay.total, overdue: d.pay.overdue },
    vat: d.vat ? { amountToPay: d.vat.amount, dueDate: d.vat.due, period: d.vat.period, partialQuarter: d.vat.partial, filed: d.vat.closed } : null,
  };
  const L = lang === 'sq' ? 'на албански јазик (shqip)' : 'на македонски јазик';
  return [
    `Ти си сметководител што на сопственик на мала фирма му објаснува ${periodLabel(d.period)} со едноставни зборови.`,
    `Напиши краток преглед ${L}: 4 до 6 кратки реченици, без наслов, без табели, без markdown.`,
    'Користи САМО бројките подолу (износи во денари, заокружи ги на цели денари). Не измислувај други податоци, имиња или совети за даноци.',
    'Спомени: резултатот (добивка или загуба), промената во однос на минатиот месец, ДДВ за плаќање и рокот (ако има), побарувањата постари од 60 дена (ако има) и парите на крајот на месецот.',
    '',
    JSON.stringify(nums, null, 1),
  ].join('\n');
}

/** HTML of the report (portal view, PDF and e-mail). `firm` is shown only in the header — never sent to AI. */
export function clientReportHtml(d: ClientReportData, o: { firm: string; lang?: ReportLang; summary?: string | null; by?: string | null }): string {
  const lang = o.lang ?? 'mk';
  const T = CR_TXT[lang];
  const h = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const cell = (l: string, v: string, sub = '', bad = false) =>
    `<td style="border:1px solid #d0d5dd;padding:8px 10px;vertical-align:top"><div style="font-size:11px;color:#667085">${h(l)}</div><div style="font-size:16px;font-weight:700${bad ? ';color:#b42318' : ''}">${h(v)}</div>${sub ? `<div style="font-size:11px;color:#667085">${h(sub)}</div>` : ''}</td>`;
  const vat = d.vat
    ? cell(d.vat.amount < 0 ? T.vatRefund! : T.vat!, `${fmtN(Math.abs(d.vat.amount))} ${T.den}`, `${T.vatDue} ${dmy(d.vat.due)}${d.vat.partial ? ` · ${T.vatPartial}` : ''}${d.vat.closed ? ` · ${T.vatFiled}` : ''}`)
    : cell(T.vat!, '—', T.noVat);
  return `<div style="font-family:Arial,sans-serif;font-size:12px;color:#111">
<div style="border-bottom:1.5px solid #111;padding-bottom:4px"><b style="font-size:14px">${h(o.firm)}</b></div>
<h2 style="text-align:center;margin:10px 0 2px">${h(T.title)}</h2><div style="text-align:center;margin:0 0 10px">${h(periodLabel(d.period, lang))}</div>
<table style="width:100%;border-collapse:collapse;margin:0 0 8px"><tr>${cell(T.rev!, `${fmtN(d.rev)} ${T.den}`)}${cell(T.exp!, `${fmtN(d.exp)} ${T.den}`)}${cell(T.res!, `${fmtN(d.res)} ${T.den}`, d.res >= 0 ? T.profit : T.loss, d.res < 0)}${vat}</tr>
<tr>${cell(T.recv!, `${fmtN(d.recv.total)} ${T.den}`, d.recv.over60 ? `${T.recv60}: ${fmtN(d.recv.over60)} ${T.den} (${d.recv.n60} ${T.inv})` : '', d.recv.over60 > 0)}${cell(T.pay!, `${fmtN(d.pay.total)} ${T.den}`, d.pay.overdue ? `${T.payLate}: ${fmtN(d.pay.overdue)} ${T.den}` : '')}${cell(T.cash!, `${fmtN(d.cash)} ${T.den}`)}<td style="border:1px solid #d0d5dd"></td></tr></table>
<h3 style="margin:12px 0 4px;font-size:13px">${h(T.changes)} (${h(periodLabel(d.prev.period, lang))})</h3><ul style="margin:0 0 8px 18px;padding:0">${changeLines(d, lang).map((l) => `<li>${h(l)}</li>`).join('')}</ul>
${o.summary ? `<h3 style="margin:12px 0 4px;font-size:13px">${h(T.summary)}</h3><p style="white-space:pre-line;margin:0 0 8px">${h(o.summary)}</p>` : ''}
<p style="font-size:10px;color:#667085;margin-top:12px">${h(T.note)}${o.by ? ' · ' + h(o.by) : ''}</p></div>`;
}

/** Client report status: draft (office only) → published (the client sees it in the portal) → sent (also e-mailed). */
export const CLIENT_REPORT_STATUS = { draft: 'нацрт', published: 'објавен во порталот', sent: 'испратен' } as const;
export type ClientReportStatus = keyof typeof CLIENT_REPORT_STATUS;

/** Worker job that writes the AI summary of one report. */
export const CLIENT_REPORT_AI_JOB = 'client-report.summary';
