/**
 * „🧾 Месечна фактура за сметководствени услуги“ (office owner only): the monthly invoices of the office firm
 * (БАЈРАМИ ГРОУП — „Фирма на канцеларијата“) to every client with a contract fee, in one click or automatically on
 * the billing day, and the polite reminders for the unpaid ones.
 *
 * The fee per client comes from the contract summary (`kdRecPlan`: `settings.accFee` net, else `settings.kdog`).
 * Clients without a fee are skipped. Money in integer cents.
 */
import { MON_MK } from '../office/dates';
import { lastWorkingDay } from '../office/recurring';
import type { KdRecRow } from './kdog';

/** Office settings of the fee invoices (`app_settings.office.feeInv`). */
export interface FeeSettings {
  /** Billing day of the month (1–28) or `L` = the last working day (default). */
  day?: number | 'L';
  /** Issue automatically on the billing day (worker `fee.invoices`). */
  auto?: boolean;
  /** E-mail the PDF to the client (when SMTP is configured) / show it in the client portal. */
  mail?: boolean;
  portal?: boolean;
  /** Overdue reminders (opomeni). */
  remind?: { on?: boolean; days?: number; every?: number; max?: number };
}

export const FEE_DEF = { day: 'L' as const, mail: true, portal: true, remind: { on: true, days: 10, every: 15, max: 3 } };

const pad = (n: number) => String(n).padStart(2, '0');
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const nextYm = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const addD = (d: string, n: number) => new Date(at(d) + n * 864e5).toISOString().slice(0, 10);
export const cents = (v: number | string | null | undefined): number => Math.round((Number(v) || 0) * 100);

/** `2026-10` → „октомври 2026“. */
export const feeMonth = (ym: string): string => `${MON_MK[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Name of the invoice line. */
export const feeLineName = (ym: string): string => `Сметководствени услуги за ${feeMonth(ym)}`;

/** Billing date of month `ym`: the day (clamped to the month) or the last working day. */
export function feeBillingDate(ym: string, day: FeeSettings['day'] = 'L'): string {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  if (day === 'L' || !Number(day)) return lastWorkingDay(y, m - 1);
  return `${ym}-${pad(Math.min(Math.max(1, Math.round(Number(day))), dim(y, m)))}`;
}

/** The month to issue automatically today (today is its billing day), else null. */
export function feeAutoPeriod(today: string, s: FeeSettings | null | undefined): string | null {
  if (!s?.auto) return null;
  const ym = today.slice(0, 7);
  return feeBillingDate(ym, s.day ?? 'L') === today ? ym : null;
}

/** Due date: the contract's payment day of the month after the service month (not before the invoice), else +15 days. */
export function feeDue(date: string, ym: string, payDay?: number | string | null): string {
  const p = Math.round(Number(payDay));
  if (p >= 1 && p <= 28) { const d = `${nextYm(ym)}-${pad(p)}`; return d >= date ? d : addD(date, 15); }
  return addD(date, 15);
}

export type FeeSt = 'нова' | 'издадена' | 'периодична' | 'пред почеток' | 'истечен' | 'без купувач';
export const FEE_ST_PILL: Record<FeeSt, string> = { 'нова': 'info', 'издадена': 'good', 'периодична': 'warn', 'пред почеток': 'mut', 'истечен': 'mut', 'без купувач': 'warn' };

export interface FeePlanRow {
  firmId: string; name: string; no: string; partnerId: string | null;
  /** Net / VAT / gross (cents). */
  net: number; vat: number; gross: number; rate: number;
  st: FeeSt;
  /** Issued invoice of the month (id, number). */
  issued: { id: string | null; number: string | null } | null;
  /** The client has an active recurring definition from the old flow (`kdRecSync`) — would bill twice. */
  recurring: string | null;
}

/**
 * The plan of month `ym`: one row per client with a contract fee (`kdRecPlan` rows). A client already invoiced for
 * the month is `издадена`; a contract that starts after / ended before the month is skipped; an active recurring
 * definition of the same client is reported (`периодична`) so the month is never billed twice.
 */
export function feePlan(
  rows: readonly KdRecRow[], ym: string, rate: number,
  issued: ReadonlyMap<string, { id: string | null; number: string | null }>,
  recurring: ReadonlyMap<string, string>,
): FeePlanRow[] {
  const first = `${ym}-01`, last = `${ym}-${pad(dim(+ym.slice(0, 4), +ym.slice(5, 7)))}`;
  return rows.map((x) => {
    const net = cents(x.net);
    const vat = Math.round((net * rate) / 100);
    const iss = issued.get(x.firm.id) ?? null;
    const rec = recurring.get(x.firm.id) ?? null;
    const st: FeeSt = iss ? 'издадена'
      : x.start && x.start > last ? 'пред почеток'
        : x.end && x.end < first ? 'истечен'
          : rec ? 'периодична' : 'нова';
    return { firmId: x.firm.id, name: x.firm.name, no: x.no, partnerId: x.partnerId, net, vat, gross: net + vat, rate, st, issued: iss, recurring: rec };
  }).sort((a, b) => a.name.localeCompare(b.name, 'mk'));
}

/** Rows to issue now: new ones, and — when asked — those with a recurring definition (which is then switched off). */
export const feeToIssue = (P: readonly FeePlanRow[], o: { includeRecurring?: boolean; only?: readonly string[] } = {}): FeePlanRow[] =>
  P.filter((r) => (r.st === 'нова' || (r.st === 'периодична' && o.includeRecurring)) && (!o.only?.length || o.only.includes(r.firmId)));

/** Sum of the plan rows (cents). */
export const feeTotals = (P: readonly Pick<FeePlanRow, 'net' | 'vat' | 'gross'>[]) =>
  P.reduce((s, r) => ({ net: s.net + r.net, vat: s.vat + r.vat, gross: s.gross + r.gross }), { net: 0, vat: 0, gross: 0 });

/* ---------------- overdue reminders ---------------- */

export interface FeeRemindRow { due: string; remaining: number; reminders: number; lastReminder: string | null }

/**
 * A polite reminder is due: still open (> 1 den.), `days` after the due date, `every` days after the previous one,
 * at most `max` reminders.
 */
export function feeReminderDue(r: FeeRemindRow, today: string, cfg: FeeSettings['remind'] = FEE_DEF.remind): boolean {
  const c = { ...FEE_DEF.remind, ...(cfg ?? {}) };
  if (!c.on || r.remaining <= 100) return false;
  if (r.reminders >= Math.max(1, Number(c.max) || 3)) return false;
  if (today < addD(r.due, Math.max(0, Number(c.days) || 0))) return false;
  return !r.lastReminder || today >= addD(r.lastReminder, Math.max(1, Number(c.every) || 15));
}

const fmt = (c: number) => {
  const v = Math.abs(c) / 100;
  const [i, d] = v.toFixed(2).split('.') as [string, string];
  return (c < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
};
const dmy = (d: string) => d.split('-').reverse().join('.');

/** Polite reminder text (n = 1, 2, 3 …). */
export function feeReminderText(o: { n: number; number: string; date: string; due: string; remaining: number; ym: string; client: string; office: string; bank?: string | null }): { subject: string; body: string } {
  const first = o.n <= 1;
  return {
    subject: `${first ? 'Љубезен потсетник' : `Потсетник (${o.n})`}: фактура ${o.number} за сметководствени услуги – ${o.office}`,
    body: `Почитувани,\n\n${first ? 'Ве потсетуваме' : 'Повторно Ве потсетуваме'} дека фактурата бр. ${o.number} од ${dmy(o.date)} за сметководствени услуги за ${feeMonth(o.ym)} со рок на плаќање ${dmy(o.due)} е сè уште неплатена.\nНеплатен износ: ${fmt(o.remaining)} ден.${o.bank ? `\nЖиро-сметка: ${o.bank}` : ''}\n\nВе молиме уплатете го износот во наредните денови. Ако уплатата е веќе извршена, Ве молиме занемарете ја оваа порака.\n\nВи благодариме за соработката.\n\nСо почит,\n${o.office}`,
  };
}

/** Text of the portal message / e-mail with the new invoice. */
export function feeInvoiceText(o: { number: string; date: string; due: string; gross: number; ym: string; office: string; bank?: string | null }): { subject: string; body: string } {
  return {
    subject: `Фактура ${o.number} за сметководствени услуги за ${feeMonth(o.ym)} – ${o.office}`,
    body: `Почитувани,\n\nВо прилог е фактурата бр. ${o.number} од ${dmy(o.date)} за сметководствени услуги за ${feeMonth(o.ym)}.\nИзнос за плаќање: ${fmt(o.gross)} ден., рок на плаќање ${dmy(o.due)}.${o.bank ? `\nЖиро-сметка: ${o.bank}` : ''}\n\nСо почит,\n${o.office}`,
  };
}
