/** Small, defensive converters for user-typed legacy values. */
import { r2 } from '@wise/core';

/**
 * Number from a legacy value: numbers as is; strings typed by users ("1.234,50", "1,5", "1 200 ден.") parsed like
 * legacy `fkN` (11344): the last of `,`/`.` is the decimal separator; a lone comma with 1–2 decimals is decimal.
 */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean' || v == null) return 0;
  let t = String(v).replace(/[\s ']/g, '').replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc > -1 && ld > -1) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (lc > -1) t = /,\d{1,2}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/** Legacy `+x || 0` — what the legacy ledger did with stored line amounts. */
export const plus = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const money = (v: unknown): string => r2(num(v)).toFixed(2);
export const moneyOrNull = (v: unknown): string | null => (v == null || v === '' ? null : money(v));
export const dec = (v: unknown, places: number): string => num(v).toFixed(places);
export const decOrNull = (v: unknown, places: number): string | null => (v == null || v === '' ? null : dec(v, places));
export const int = (v: unknown, def = 0): number => {
  const n = Math.round(num(v));
  return Number.isFinite(n) && v !== '' && v != null ? n : def;
};

/** Trimmed string or null. */
export const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  return s || null;
};
export const strOr = (v: unknown, def: string): string => str(v) ?? def;

const isRealDate = (d: string): boolean => {
  const t = new Date(d + 'T00:00:00Z');
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/** `YYYY-MM-DD` from ISO, `dd.mm.yyyy`, `dd/mm/yyyy`; null when it is not a real date (legacy `fkNormDate`). */
export function isoDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let d: string | null = null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) d = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
    if (m) d = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return d && isRealDate(d) ? d : null;
}

/** Legacy booleans: true, 'true', 'Д', 'да', 1, 'on'. */
export const bool = (v: unknown): boolean => v === true || v === 1 || (typeof v === 'string' && /^(true|1|on|д|да|yes)$/i.test(v.trim()));

/** Plain object (or empty). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Copy of `o` without the given keys and without transient / bookkeeping fields legacy persisted (LEGACY-MAP 11.4 item 6). */
const TRANSIENT = new Set(['updated', 'by', 'byId', 'fuelOk', '_scan', '_newSup', 'calcAuto', 'autoShift', 'lateOk', 'dt', '_buyer', '_total', 'mergeFrom', 'pend', 'pendBy', 'pendAt']);
export function rest(o: Record<string, unknown>, used: readonly string[]): Record<string, unknown> {
  const U = new Set(used);
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (U.has(k) || TRANSIENT.has(k) || v === undefined) continue;
    r[k] = v;
  }
  return r;
}

/** Valid account code (the chart and the posting service accept 2–10 digits). */
export const ACCOUNT_RE = /^[0-9]{2,10}$/;
export const accountOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return ACCOUNT_RE.test(s) ? s : null;
};

export const yearOf = (d: string): number => Number(d.slice(0, 4));
