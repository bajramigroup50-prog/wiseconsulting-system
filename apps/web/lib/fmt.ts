/** Legacy number formats: `fmt` (2 decimals, mk-MK grouping) and `fq` (up to 3 decimals). */
export const fmt = (n: number | string | null | undefined): string =>
  (Number(n) || 0).toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fq = (n: number | string | null | undefined): string =>
  (Number(n) || 0).toLocaleString('mk-MK', { maximumFractionDigits: 3 });

export const dmy = (d: string | null | undefined): string => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');

/** CSV with `;` and a BOM, the way legacy `csv()` / `download()` produced Excel-friendly files. */
export const toCsv = (rows: readonly (readonly (string | number | null | undefined)[])[]): string =>
  '﻿' + rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
