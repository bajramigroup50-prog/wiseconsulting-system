/**
 * Macedonian public holidays and working-time calendar (legacy `orthEaster`, `BAJRAM`,
 * `mkHolidays`, `monthSplit`, `monthHours`, `workHoursBetween`).
 * All date maths is in UTC on `YYYY-MM-DD` strings, like the final legacy versions.
 */

/** Orthodox Easter Sunday (Gregorian date) for year `y` — Meeus Julian algorithm + 13 days. */
export function orthEaster(y: number): Date {
  const a = y % 4,
    b = y % 7,
    c = y % 19,
    d = (19 * c + 15) % 30,
    e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31),
    day = ((d + e + 114) % 31) + 1;
  const j = new Date(Date.UTC(y, month - 1, day));
  j.setUTCDate(j.getUTCDate() + 13);
  return j;
}

/**
 * Ramazan Bajram (Eid al-Fitr, first day) as `MM-DD` per year.
 *
 * DELIBERATE FIX (LEGACY-MAP 6.4 #21): legacy covered 2025–2032 only; years 2020–2024 are
 * added (needed for historic payroll imports). Years after 2032 are still missing because the
 * date is set by government decision each year — pass them via `mkHolidays(y, extra)`.
 */
export const BAJRAM: Readonly<Record<number, string>> = {
  2020: '05-24',
  2021: '05-13',
  2022: '05-02',
  2023: '04-21',
  2024: '04-10',
  2025: '03-30',
  2026: '03-20',
  2027: '03-10',
  2028: '02-27',
  2029: '02-15',
  2030: '02-05',
  2031: '01-25',
  2032: '01-14',
};

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  /** Name (Macedonian). */
  n: string;
}

const FIXED: readonly (readonly [string, string])[] = [
  ['01-01', 'Нова година'],
  ['01-07', 'Божик'],
  ['05-01', 'Ден на трудот'],
  ['05-24', 'Св. Кирил и Методиј'],
  ['08-02', 'Илинден'],
  ['09-08', 'Ден на независноста'],
  ['10-11', 'Ден на народното востание'],
  ['10-23', 'Ден на македонската револуционерна борба'],
  ['12-08', 'Св. Климент Охридски'],
];

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const dow = (ds: string): number => new Date(ds + 'T00:00:00Z').getUTCDay();

/**
 * Non-working public holidays for year `y`, sorted by date. A holiday falling on Sunday adds the
 * following Monday ("се празнува во понеделник"). `extra` adds holidays (e.g. a Bajram date for a
 * year not in `BAJRAM`, or a one-off government decision).
 */
export function mkHolidays(y: number, extra: readonly Holiday[] = []): Holiday[] {
  const L: Holiday[] = FIXED.map(([d, n]) => ({ date: y + '-' + d, n }));
  const e = orthEaster(y);
  e.setUTCDate(e.getUTCDate() + 1);
  L.push({ date: iso(e), n: 'Велигден (втор ден)' });
  const bj = BAJRAM[y];
  if (bj) L.push({ date: y + '-' + bj, n: 'Рамазан Бајрам' });
  for (const x of extra) if (x.date.startsWith(y + '-')) L.push({ ...x });
  const out: Holiday[] = [];
  for (const x of L) {
    out.push(x);
    if (dow(x.date) === 0) {
      const m = new Date(x.date + 'T00:00:00Z');
      m.setUTCDate(m.getUTCDate() + 1);
      out.push({ date: iso(m), n: x.n + ' (се празнува во понеделник)' });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const dmy = (d: string): string => (d ? String(d).split('-').reverse().join('.') : '');
const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymParts = (ym: string): [number, number] => {
  const [y, m] = ym.split('-').map(Number);
  return [y!, m!];
};

/** Working hours vs. paid-holiday hours on weekdays of month `ym` (legacy `monthSplit`). */
export function monthSplit(ym: string, extra: readonly Holiday[] = []): { work: number; hol: number; names: string[] } {
  const [y, m] = ymParts(ym);
  const H = new Map(mkHolidays(y, extra).map((x) => [x.date, x.n]));
  let work = 0,
    hol = 0;
  const names: string[] = [];
  const n = daysIn(y, m);
  for (let i = 1; i <= n; i++) {
    const ds = ym + '-' + String(i).padStart(2, '0');
    const w = dow(ds);
    if (!w || w === 6) continue;
    if (H.has(ds)) {
      hol += 8;
      names.push(dmy(ds) + ' ' + H.get(ds));
    } else work += 8;
  }
  return { work, hol, names };
}

/**
 * Monthly hour fund = weekdays × 8, holidays included (they are paid) — legacy `monthHours`,
 * stored as `params.hours`. Use `workingDays` for days actually worked.
 */
export function monthHours(ym: string): number {
  const [y, m] = ymParts(ym);
  let d = 0;
  const n = daysIn(y, m);
  for (let i = 1; i <= n; i++) {
    const w = new Date(Date.UTC(y, m - 1, i)).getUTCDay();
    if (w && w < 6) d++;
  }
  return d * 8;
}

/** Number of working days (Mon–Fri, excluding public holidays) in month `ym`. */
export function workingDays(ym: string, extra: readonly Holiday[] = []): number {
  return monthSplit(ym, extra).work / 8;
}

/** Work / holiday hours of month `ym` restricted to `[from, to]` (inclusive, YYYY-MM-DD) — legacy `workHoursBetween`. */
export function workHoursBetween(ym: string, from?: string, to?: string, extra: readonly Holiday[] = []): { work: number; hol: number } {
  const [y, m] = ymParts(ym);
  const H = new Set(mkHolidays(y, extra).map((x) => x.date));
  let w = 0,
    hol = 0;
  const n = daysIn(y, m);
  for (let i = 1; i <= n; i++) {
    const ds = ym + '-' + String(i).padStart(2, '0');
    if (from && ds < from) continue;
    if (to && ds > to) continue;
    const wd = dow(ds);
    if (!wd || wd === 6) continue;
    if (H.has(ds)) hol += 8;
    else w += 8;
  }
  return { work: w, hol };
}

/** Last day of month `ym` as YYYY-MM-DD (payroll `date`). */
export function monthEnd(ym: string): string {
  const [y, m] = ymParts(ym);
  return ym + '-' + String(daysIn(y, m)).padStart(2, '0');
}
