/**
 * Legacy number formats: `fmt` (2 decimals) and `fq` (up to 3 decimals) in the mk-MK style `1.234.567,89`.
 * Implemented by hand rather than with `toLocaleString('mk-MK')`, whose output depends on the ICU data of the
 * runtime (Node vs. browser) — that would differ between server and client render.
 */
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export const fmt = (n: number | string | null | undefined): string => {
  const v = Number(n) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.') as [string, string];
  return (v < 0 && (i !== '0' || d !== '00') ? '-' : '') + group(i) + ',' + d;
};

export const fq = (n: number | string | null | undefined): string => {
  const v = Number(n) || 0;
  const [i, d = ''] = String(Math.round(Math.abs(v) * 1000) / 1000).split('.') as [string, string?];
  return (v < 0 ? '-' : '') + group(i) + (d ? ',' + d : '');
};

export const dmy = (d: string | null | undefined): string => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

/** CSV with `;` and a BOM, the way legacy `csv()` / `download()` produced Excel-friendly files. */
export const toCsv = (rows: readonly (readonly (string | number | null | undefined)[])[]): string =>
  '﻿' + rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
