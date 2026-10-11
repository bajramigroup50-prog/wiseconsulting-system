/**
 * Legal deadline arithmetic (рокови) for objections, appeals and lawsuits.
 *
 * Rules (Закон за општата управна постапка — ЗОУП, Сл. весник 124/2015, чл. 87–88 „Пресметување на роковите“; the
 * same rule is in the Закон за даночна постапка and the Закон за парничната постапка):
 * - a deadline in days starts on the day AFTER delivery (денот на доставувањето не се засметува);
 * - a deadline in months / years ends on the day with the same number as the delivery day (or the month's last day);
 * - if the last day falls on a public holiday, Saturday or Sunday, the deadline ends at the end of the next working day;
 * - `workdays` deadlines (работни денови, e.g. remarks on an inspection record) count only working days.
 * Public holidays: `mkHolidays` (payroll calendar — the same list the payroll uses, incl. Monday transfers).
 */
import { mkHolidays, type Holiday } from '../payroll/calendar';

export type DeadlineUnit = 'days' | 'workdays' | 'months';

const at = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addD = (d: string, n: number) => { const x = at(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };

const holCache = new Map<number, Set<string>>();
function holidays(y: number, extra: readonly Holiday[]): Set<string> {
  if (extra.length) return new Set(mkHolidays(y, extra).map((h) => h.date));
  let s = holCache.get(y);
  if (!s) { s = new Set(mkHolidays(y).map((h) => h.date)); holCache.set(y, s); }
  return s;
}

/** Monday–Friday and not a public holiday (state holidays for all citizens). */
export function isWorkday(d: string, extra: readonly Holiday[] = []): boolean {
  const w = at(d).getUTCDay();
  if (w === 0 || w === 6) return false;
  return !holidays(Number(d.slice(0, 4)), extra).has(d.slice(0, 10));
}

/** `d` itself when it is a working day, else the next working day. */
export function rollToWorkday(d: string, extra: readonly Holiday[] = []): string {
  let x = d.slice(0, 10);
  for (let i = 0; i < 20 && !isWorkday(x, extra); i++) x = addD(x, 1);
  return x;
}

function addMonthsClamp(d: string, n: number): string {
  const x = at(d);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + n);
  const dim = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, dim));
  return iso(x);
}

/**
 * Last day of a deadline of `n` `unit`s counted from `delivered` (the day of delivery / receipt).
 * Throws on a bad date or a non-positive length, so a typo never yields a silent wrong deadline.
 */
export function deadlineFrom(delivered: string, n: number, unit: DeadlineUnit, extra: readonly Holiday[] = []): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(delivered)) throw new Error('Неважечки датум на доставување.');
  if (!(Number.isInteger(n) && n > 0)) throw new Error('Неважечка должина на рокот.');
  if (unit === 'workdays') {
    let x = delivered, left = n;
    while (left > 0) { x = addD(x, 1); if (isWorkday(x, extra)) left--; }
    return x;
  }
  const last = unit === 'months' ? addMonthsClamp(delivered, n) : addD(delivered, n);
  return rollToWorkday(last, extra);
}

/** Calendar days from `today` to `due` (negative = expired). */
export function daysLeft(today: string, due: string): number {
  return Math.round((at(due).getTime() - at(today).getTime()) / 864e5);
}

export type DeadlineState = 'expired' | 'today' | 'urgent' | 'open';
/** expired (< today), today, urgent (≤ 3 days), open. */
export function deadlineState(today: string, due: string): DeadlineState {
  const n = daysLeft(today, due);
  return n < 0 ? 'expired' : n === 0 ? 'today' : n <= 3 ? 'urgent' : 'open';
}
