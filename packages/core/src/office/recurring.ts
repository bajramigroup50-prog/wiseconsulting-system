/**
 * Recurring invoices — legacy `recNext` (10173), `recDue` (10174), `lastWD` / `recNext2` / `recNote` /
 * `recItemName` / `recIssue` (13483–13495).
 */
import { MON_MK, addDays } from './dates';

export const REC_EVERY = { month: 1, quarter: 3, half: 6, year: 12 } as const;
export type RecEvery = keyof typeof REC_EVERY;
export const REC_EVERY_LBL: Record<RecEvery, string> = { month: 'Секој месец', quarter: 'Квартално', half: 'Полугодишно', year: 'Годишно' };
export const isRecEvery = (s: unknown): s is RecEvery => typeof s === 'string' && s in REC_EVERY;

/** Day of month (1–31) or `'L'` = last working day of the month. */
export type RecDay = number | 'L';

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m0: number, d: number) => {
  const x = new Date(Date.UTC(y, m0, d));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};
const dim = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Legacy `lastWD(y, m)`: last Mon–Fri of month `m0` (0-based, may overflow into next years). */
export function lastWorkingDay(y: number, m0: number): string {
  const x = new Date(Date.UTC(y, m0 + 1, 0));
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** Legacy `recNext2`: the next issue date after `d` (`day` clamped to the month length, or last working day). */
export function recNext(d: string, every: RecEvery, day: RecDay): string {
  const y = Number(d.slice(0, 4)), m0 = Number(d.slice(5, 7)) - 1 + (REC_EVERY[every] ?? 1);
  if (day === 'L') return lastWorkingDay(y, m0);
  const ny = y + Math.floor(m0 / 12), nm = ((m0 % 12) + 12) % 12;
  return ymdOf(ny, nm, Math.min(Number(day) || 1, dim(ny, nm)));
}

/** Legacy `recFirstL`: first last-working-day on or after today. */
export function firstLastWorkingDay(today: string): string {
  const y = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7)) - 1;
  const a = lastWorkingDay(y, m0);
  return a >= today ? a : lastWorkingDay(y, m0 + 1);
}

export interface RecurDef {
  active: boolean;
  next: string | null;
  end?: string | null;
  every: RecEvery;
  day: RecDay;
  dueDays: number;
  note?: string | null;
}

/** Legacy `recDue`: active, has a next date that has arrived and is not past `end`. */
export const recIsDue = (r: RecurDef, today: string): boolean =>
  r.active && !!r.next && r.next <= today && (!r.end || r.next <= r.end);

/** Legacy `recNote`: `{месец}` / `{претходен месец}` → month name of the issue date. */
export function recNote(note: string | null | undefined, next: string): string {
  const y = Number(next.slice(0, 4)), m0 = Number(next.slice(5, 7)) - 1;
  const pm0 = (m0 + 11) % 12, py = m0 === 0 ? y - 1 : y;
  return String(note ?? '')
    .replace('{месец}', `${MON_MK[m0]} ${y}`)
    .replace('{претходен месец}', `${MON_MK[pm0]} ${py}`);
}

/** Legacy `recItemName`: placeholders in item names, or append the month to "… за месец". */
export function recItemName(name: string, next: string): string {
  const nm = String(name ?? '');
  if (/\{(месец|претходен месец)\}/.test(nm)) return recNote(nm, next);
  if (/за\s+месец\s*$/i.test(nm)) {
    const t = `${MON_MK[Number(next.slice(5, 7)) - 1]} ${next.slice(0, 4)}`;
    return `${nm.trim()} ${nm === nm.toUpperCase() ? t.toUpperCase() : t}`;
  }
  return nm;
}

export interface RecItem { itemId?: string | null; name: string; qty: number; price: number; vat: number; unit?: string }

export interface DraftInvoice {
  date: string;
  due: string;
  partnerId: string;
  note: string;
  items: RecItem[];
  recurId: string;
}

/**
 * One issue of a recurring definition (legacy `recIssue` 13594): the draft invoice and the advanced `next`.
 * The invoice date is `next` for "last working day" definitions, otherwise today (legacy behaviour).
 */
export function recIssue(r: RecurDef & { id: string; partnerId: string; items: RecItem[] }, today: string): { invoice: DraftInvoice; next: string; finished: boolean } | null {
  if (!recIsDue(r, today)) return null;
  const next0 = r.next!;
  const date = r.day === 'L' ? next0 : today;
  const invoice: DraftInvoice = {
    date, due: addDays(date, Number(r.dueDays) || 0), partnerId: r.partnerId, recurId: r.id,
    note: recNote(r.note, next0),
    items: r.items.map((l) => ({ ...l, name: recItemName(l.name, next0) })),
  };
  // Legacy advances one period per issue; a definition that fell behind is caught up period by period
  // (the job calls this again while it stays due), each invoice naming its own month.
  const next = recNext(next0, r.every, r.day);
  return { invoice, next, finished: !!r.end && next > r.end };
}
