/**
 * Numeric helpers for the stock module.
 *
 * Legacy rounds with `Math.round(x * 10^dp) / 10^dp` (half-up towards +Infinity) on raw floats, so values
 * such as `1.005 * 100 = 100.49999999999999` round the "wrong" way. `rnd` keeps legacy's half-up direction
 * but snaps float noise first, so a value that is mathematically on a half rounds up.
 *
 * Sums over many moves are done in integer cents (money) and integer 1/10 000 units (quantities), which is
 * the precision legacy rounds to (`r2` / `r4`), so long ledgers do not drift.
 */

/** Legacy `+x || 0`: coerce anything (string, null, NaN) to a finite number. */
export const num = (v: unknown): number => {
  const n = +(v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Round half-up (towards +Infinity, like `Math.round`) to `dp` decimals, tolerant to float noise. */
export const rnd = (n: number, dp: number): number => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  const x = n * f;
  const fl = Math.floor(x);
  const tol = 1e-9 + Math.abs(x) * Number.EPSILON * 8;
  const r = x - fl >= 0.5 - tol ? fl + 1 : fl;
  return r / f + 0; // `+ 0` turns -0 into 0
};

/** Legacy `r2` (money, 2 decimals). */
export const r2 = (n: unknown): number => rnd(num(n), 2);
/** Legacy `r4` (quantities and unit prices, 4 decimals). */
export const r4 = (n: unknown): number => rnd(num(n), 4);
/** Legacy `Math.round` on money (whole denars). */
export const r0 = (n: unknown): number => rnd(num(n), 0);

/** Money → integer cents. */
export const cents = (v: unknown): number => Math.round(r2(v) * 100);
/** Quantity → integer 1/10 000 units. */
export const qunits = (v: unknown): number => Math.round(r4(v) * 10_000);
export const fromCents = (c: number): number => c / 100 + 0;
export const fromQunits = (q: number): number => q / 10_000 + 0;

/** Legacy `fmt`: Macedonian money format, 2 decimals ("1.234,50"). */
export const fmtMk = (n: unknown): string =>
  num(n).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Legacy `fq`: Macedonian quantity format, up to 3 decimals. */
export const fqMk = (n: unknown): string => num(n).toLocaleString('mk-MK', { maximumFractionDigits: 3 });
/** Legacy `dmy`: `YYYY-MM-DD` → `DD.MM.YYYY`. */
export const dmy = (d: string | null | undefined): string => (d ? String(d).split('-').reverse().join('.') : '');

/** `YYYY-MM-DD` + n days (UTC, no DST surprises). */
export const addDaysIso = (date: string, n: number): string => {
  const x = new Date(date + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** Day of week (0 = Sunday) of a `YYYY-MM-DD` date. */
export const weekdayIso = (date: string): number => new Date(date + 'T12:00:00Z').getUTCDay();
/** Whole days from `a` to `b` (legacy `dDiffD`). */
export const dayDiffIso = (a: string, b: string): number =>
  Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
