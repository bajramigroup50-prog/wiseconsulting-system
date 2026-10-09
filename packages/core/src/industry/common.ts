/**
 * Shared helpers of the industry modules (legacy 9489–9509: `bzPad`, `ymd`, `addD`, `dDiff`, `ageAt`, `net4`,
 * `passK`, `bzNextNo`, `BZ_NAT`).
 *
 * Dates are calendar days (`YYYY-MM-DD`) computed in UTC so they never drift with the server time zone
 * (legacy used local noon for the same reason).
 */
import { r2 } from '../money';

export { r2 };
export const r4 = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 1e4) / 1e4;
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const D = (d: string) => new Date(String(d).slice(0, 10) + 'T12:00:00Z');
const iso = (x: Date) => x.toISOString().slice(0, 10);

/** Legacy `addD(d, n)`: date plus n days. */
export const addDays = (d: string, n: number): string => {
  const x = D(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
/** Legacy `dDiff(a, b)`: whole days from a to b. */
export const dayDiff = (a: string, b: string): number => Math.round((+D(b) - +D(a)) / 864e5);
/** Legacy `ageAt(birth, at)`: completed years on a date, null without a birth date. */
export function ageAt(birth: string | null | undefined, at: string): number | null {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return null;
  const [by, bm, bd] = birth.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [ay, am, ad] = String(at).slice(0, 10).split('-').map(Number) as [number, number, number];
  let y = ay - by;
  if (am < bm || (am === bm && ad < bd)) y--;
  return y;
}
/** Days of month `YYYY-MM`. */
export const daysInMonth = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Legacy `net4(gross, rate)`: price incl. VAT → net unit price with 4 decimals.
 * FIX (LEGACY-MAP 10.4 item 6): hotel, rent-a-car, appointments and the restaurant take prices incl. VAT,
 * construction and freight net prices; every gross price goes through this one function before it reaches the
 * Phase 3 invoice service (which always takes net prices).
 */
export const net4 = (gross: number | string, rate: number | string): number => Math.round((num(gross) / (1 + num(rate) / 100)) * 1e4) / 1e4;

/**
 * Net price of a single (qty 1) line whose VAT-inclusive total must equal `gross` to the cent, the way the invoice
 * service rounds (base per line to the cent, VAT = round(base × rate)). Falls back to the closest base when no exact
 * one exists.
 */
export function netOfGross(gross: number | string, rate: number | string): number {
  const g = Math.round(num(gross) * 100), r = num(rate);
  const est = Math.round(g / (1 + r / 100));
  let best = est, err = Infinity;
  for (let b = est - 3; b <= est + 3; b++) {
    const e = Math.abs(b + Math.round((b * r) / 100) - g);
    if (e < err) { err = e; best = b; }
  }
  return best / 100;
}

/** Legacy `passK(k)`: konto of class 2 (tourist tax, deposits, pass-through collections) is not VAT turnover. */
export const passThroughAccount = (k: string | null | undefined): boolean => /^2/.test(String(k ?? ''));

/**
 * Next document number `PRE001/2026` from the numbers already used in the year (legacy `bzNextNo`).
 * FIX (LEGACY-MAP 10.4 item 12): construction projects were numbered `count + 1` (duplicates after a delete);
 * every module now numbers from the highest number used in the year, and the services re-check uniqueness on save.
 */
export function nextModuleNumber(prefix: string, used: readonly (string | null | undefined)[], year: string | number, pad = 3): string {
  const mx = used.reduce<number>((m, x) => Math.max(m, parseInt(String(x ?? '').replace(/^\D+/, ''), 10) || 0), 0);
  return `${prefix}${String(mx + 1).padStart(pad, '0')}/${year}`;
}

/** Legacy `BZ_NAT` — nationality codes on guest / driver / passenger forms. */
export const NATIONALITIES: readonly (readonly [string, string])[] = [
  ['MK', 'Македонија'], ['AL', 'Албанија'], ['XK', 'Косово'], ['RS', 'Србија'], ['BG', 'Бугарија'], ['GR', 'Грција'], ['TR', 'Турција'],
  ['DE', 'Германија'], ['AT', 'Австрија'], ['CH', 'Швајцарија'], ['IT', 'Италија'], ['FR', 'Франција'], ['NL', 'Холандија'],
  ['GB', 'В. Британија'], ['US', 'САД'], ['HR', 'Хрватска'], ['SI', 'Словенија'], ['ME', 'Црна Гора'], ['BA', 'БиХ'], ['PL', 'Полска'],
  ['SE', 'Шведска'], ['OT', 'друго'],
];
export const nationalityName = (c: string | null | undefined): string => NATIONALITIES.find((x) => x[0] === c)?.[1] ?? (c || '');

/** A line for the Phase 3 invoice service (net unit price, VAT rate, revenue konto). */
export interface ModuleInvoiceLine {
  itemId?: string | null;
  name: string;
  unit?: string | null;
  qty: number;
  /** Net unit price (4 decimals). */
  price: number;
  rate: number;
  /** Revenue / pass-through konto; empty = item / scheme default of the invoice service. */
  account?: string | null;
}
