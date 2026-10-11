/**
 * Working years of a firm: a firm is listed (picker, /firmi, office-wide lists, counts) only in the years it exists.
 *
 * Kept in `firms.settings` (no column, no migration):
 *  - `fromYear` — first working year („Активна од година“), set in the firm form or by the Excel import („Година“);
 *  - `toYear`   — last working year („До година (затворена)“), set in the form or when the firm is deactivated
 *                 (`toYearAuto: true` marks the automatic value, cleared again when the firm is restored).
 *
 * Without an explicit `fromYear` the first year is computed at read time — nothing is backfilled:
 * the year the firm was entered (`createdAt`, Europe/Skopje), lowered to the year of its earliest journal /
 * invoice / purchase when it really has data in an earlier year. Legacy „Тековна година“ (`curYear`) and the
 * registration date (`regDate`) deliberately do not move the first year back (user decision 2026-10-11: earlier
 * years stay empty until the user fills them).
 *
 * Years after the current calendar year (Skopje) stay empty until the user carries the balances there: a firm is
 * listed in a future year only when it has data dated in that year or later (the „Почетна состојба“ `open-<Y>` posted
 * by the year-end carry counts) or its explicit `fromYear` is that year (user decision 2026-10-11).
 *
 * The SQL twin of `firmActiveIn` is `firmInYearSql` in `@wise/db` (same rule, used to filter lists in the database).
 */

export const FY_MIN = 1990;
export const FY_MAX = 2100;

export interface FirmYearSrc {
  settings?: Readonly<Record<string, unknown>> | null;
  createdAt?: Date | string | null;
}

/** A 4-digit year between FY_MIN and FY_MAX, else `null`. */
export function fyParse(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= FY_MIN && y <= FY_MAX ? y : null;
}

/** Year of a timestamp in Skopje (CET/CEST — only the new-year hour matters, where it is UTC+1). */
export function fyOfDate(d: Date | string | null | undefined): number | null {
  if (d == null || d === '') return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return Number(d.slice(0, 4));
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + 3600_000).getUTCFullYear();
}

/** Explicit `fromYear` of the settings, if any. */
export const firmFromYearSet = (f: FirmYearSrc): number | null => fyParse(f.settings?.fromYear);

/** Last working year (`toYear`), or `null` while the firm works. */
export const firmToYear = (f: FirmYearSrc): number | null => fyParse(f.settings?.toYear);

/**
 * First working year: explicit `fromYear`; otherwise the creation year lowered to the first year with data.
 * `fallbackYear` is used when neither is known (a firm row without `createdAt`).
 */
export function firmFromYear(f: FirmYearSrc, firstDataYear?: number | null, fallbackYear = new Date().getFullYear()): number {
  const ex = firmFromYearSet(f);
  if (ex != null) return ex;
  const c = fyOfDate(f.createdAt ?? null) ?? fallbackYear;
  return firstDataYear != null && Number.isFinite(firstDataYear) && firstDataYear < c ? firstDataYear : c;
}

/** Current calendar year in Skopje. */
export const fyNow = (): number => fyOfDate(new Date())!;

/** Future year (after `nowYear`) without a carry / data there yet, for a firm that started earlier. */
function fyNotCarried(f: FirmYearSrc, year: number, from: number, lastDataYear: number | null | undefined, nowYear: number): boolean {
  return year > nowYear && from < year && !(lastDataYear != null && lastDataYear >= year);
}

/** Is the firm listed in `year`? `lastDataYear` = year of its latest journal / invoice / purchase. */
export function firmActiveIn(f: FirmYearSrc, year: number, firstDataYear?: number | null, lastDataYear?: number | null, nowYear = fyNow()): boolean {
  const to = firmToYear(f);
  if (to != null && year > to) return false;
  const from = firmFromYear(f, firstDataYear, year);
  return from <= year && !fyNotCarried(f, year, from, lastDataYear, nowYear);
}

/** Callout for a selected firm outside the selected year, or `null` when it works in that year. */
export function firmYearNote(f: FirmYearSrc, year: number, firstDataYear?: number | null, lastDataYear?: number | null, nowYear = fyNow()): string | null {
  const to = firmToYear(f);
  if (to != null && year > to) return `Фирмата не е активна во ${year} – затворена е во ${to}.`;
  const from = firmFromYear(f, firstDataYear, year);
  if (from > year) return `Фирмата не е активна во ${year} – работи од ${from}.`;
  if (fyNotCarried(f, year, from, lastDataYear, nowYear))
    return `Фирмата сè уште нема пренос во ${year} – затворете ја ${year - 1} и пренесете ги салдата.`;
  return null;
}

/** Settings after deactivation (legacy delFirm → archive): `toYear` = the current year unless one is already set. */
export function fyOnDeactivate(s: Readonly<Record<string, unknown>>, year: number): Record<string, unknown> {
  if (fyParse(s.toYear) != null) return { ...s };
  return { ...s, toYear: String(year), toYearAuto: true };
}

/** Settings after restoring a deactivated firm: drop the automatic `toYear`, keep one the user typed. */
export function fyOnRestore(s: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const o = { ...s };
  if (o.toYearAuto) { delete o.toYear; delete o.toYearAuto; }
  return o;
}

/** Form check: both years valid, `toYear` not before `fromYear`. Returns an error text or `null`. */
export function fyCheck(fromYear: string | undefined, toYear: string | undefined): string | null {
  const a = (fromYear ?? '').trim(), b = (toYear ?? '').trim();
  if (a && fyParse(a) == null) return `Активна од година: внесете година (${FY_MIN}–${FY_MAX}).`;
  if (b && fyParse(b) == null) return `До година: внесете година (${FY_MIN}–${FY_MAX}).`;
  if (a && b && Number(b) < Number(a)) return '„До година“ не може да е пред „Активна од година“.';
  return null;
}
