'use client';
/**
 * Export / PDF / import buttons shared by the stock, production and codebook screens (parity pass).
 *
 * - `ExportButtons`: legacy `lagSave(name, aoa, type)` 4960 — Excel (.xlsx, SheetJS) and CSV (BOM, `;`, decimal comma).
 * - `ServerPdfButton`: the server PDF (`pdf.render`) of the report area `#rpt` (legacy `pdf(name, html, {land})`).
 * - `ImportButton`: Excel / CSV / XML import with header recognition and a downloadable template (legacy `xlImport` /
 *   `lagImport` / `pcImport` style): the browser parses, the server action receives `{ rows: [{key: value}] , ...extra }`.
 */
import { startTransition, useActionState, useRef, useState } from 'react';
import { PdfButton } from './pdf-button';
import type { ActionState } from '@/lib/books';

export type Cell = string | number | null | undefined;

/** CSV as legacy `lagSave(..., 'csv')`: BOM, `;` separator, numbers with a decimal comma. */
export function legacyCsv(aoa: readonly (readonly Cell[])[]): string {
  return '﻿' + aoa.map((r) => r.map((x) => {
    const s = typeof x === 'number' ? String(x).replace('.', ',') : String(x ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
}

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadXlsx(name: string, aoa: readonly (readonly Cell[])[], sheet = 'Лист', widths?: number[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((r) => r.map((c) => (c == null ? '' : c))));
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  save(name.endsWith('.xlsx') ? name : name + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/** „Excel“ + „CSV“ buttons for one table (file name without extension). */
export function ExportButtons({ name, rows, sheet, widths, csv = true, xlsxLabel = 'Excel', csvLabel = 'CSV' }: {
  name: string; rows: Cell[][]; sheet?: string; widths?: number[]; csv?: boolean; xlsxLabel?: string; csvLabel?: string;
}) {
  return (
    <>
      <button type="button" className="btn" onClick={() => void downloadXlsx(name, rows, sheet, widths)}>{xlsxLabel}</button>
      {csv && <button type="button" className="btn" onClick={() => save(name + '.csv', new Blob([legacyCsv(rows)], { type: 'text/csv;charset=utf-8' }))}>{csvLabel}</button>}
    </>
  );
}

/** Server PDF of the report area (default `#rpt`). */
export function ServerPdfButton({ title, landscape, target = '#rpt', className = 'btn pri' }: { title: string; landscape?: boolean; target?: string; className?: string }) {
  return <PdfButton selector={target} title={title} landscape={landscape} className={className} />;
}

/* ------------------------------------------------------------------ import */

export interface ImpField {
  key: string;
  /** Column title in the template. */
  label: string;
  /** Header recognition (case-insensitive regex source). */
  re: string;
  num?: boolean;
  req?: boolean;
}

/** Locale-aware number: `1.234,56`, `1,234.56`, `1234,5`, `1234.5` (legacy `impNum` / `fkN`). */
export function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/\s| /g, '');
  if (!s) return null;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > d) s = s.replace(/\./g, '').replace(',', '.');
  else if (d > c && c >= 0) s = s.replace(/,/g, '');
  const x = Number(s.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(x) ? x : null;
}

/** Header row (first 15 rows) where the required fields are recognised; `-1` = none. */
export function findHeader(rows: unknown[][], fields: readonly ImpField[]): { hi: number; map: Record<string, number> } {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const H = (rows[i] ?? []).map((x) => String(x ?? '').trim().toLowerCase());
    const map: Record<string, number> = {};
    for (const f of fields) {
      const re = new RegExp(f.re, 'i');
      const ix = H.findIndex((h, k) => h && re.test(h) && !Object.values(map).includes(k));
      if (ix >= 0) map[f.key] = ix;
    }
    if (fields.filter((f) => f.req).every((f) => map[f.key] != null) && Object.keys(map).length) return { hi: i, map };
  }
  return { hi: -1, map: {} };
}

export function parseImport(rows: unknown[][], fields: readonly ImpField[]): { rows: Record<string, string | number | null>[]; error?: string } {
  const { hi, map } = findHeader(rows, fields);
  if (hi < 0) return { rows: [], error: 'Колоните не се препознаени. Потребни: ' + fields.filter((f) => f.req).map((f) => f.label).join(', ') + ' (преземете го шаблонот).' };
  const out = rows.slice(hi + 1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')).map((r) => Object.fromEntries(fields.filter((f) => map[f.key] != null).map((f) => {
    const v = r[map[f.key]!];
    return [f.key, f.num ? parseNum(v) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim()];
  }))).filter((r) => !/^(вкупно|total)/i.test(String(Object.values(r)[0] ?? '')));
  return { rows: out };
}

/** „Увоз од Excel“ + „Шаблон“: parse a file in the browser and post `{rows, ...extra}` to the action. */
export function ImportButton({ action, fields, template, name, label = 'Увоз од Excel / CSV', confirmText, extra }: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  fields: readonly ImpField[];
  /** Example rows for the template (after the header). */
  template?: Cell[][];
  /** Template file name (without extension). */
  name: string;
  label?: string;
  /** Confirmation text; `{n}` = number of rows, `{file}` = file name (a string: functions can't cross to client components). */
  confirmText?: string;
  extra?: Record<string, unknown>;
}) {
  const [st, run, pending] = useActionState<ActionState, FormData>(action, {});
  const [err, setErr] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    try {
      const { readRows } = await import('@/app/(app)/_retail/read-file');
      const R = await readRows(f);
      const p = parseImport(R, fields);
      if (p.error) { setErr(p.error); return; }
      if (!p.rows.length) { setErr('Нема редови за увоз.'); return; }
      if (!window.confirm(confirmText ? confirmText.replaceAll('{n}', String(p.rows.length)).replaceAll('{file}', f.name) : `Да се увезат ${p.rows.length} редови од „${f.name}“?`)) return;
      const fd = new FormData();
      fd.set('payload', JSON.stringify({ ...(extra ?? {}), rows: p.rows }));
      startTransition(() => run(fd));
    } catch { setErr('Датотеката не може да се прочита.'); }
  };
  return (
    <>
      <button type="button" className="btn" disabled={pending} onClick={() => inp.current?.click()}>{pending ? 'Се увезува…' : label}</button>
      <button type="button" className="btn" onClick={() => void downloadXlsx(name, [fields.map((f) => f.label), ...(template ?? [])])}>Шаблон</button>
      <input ref={inp} type="file" hidden accept=".xlsx,.xls,.csv,.txt,.xml" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {(err || st.error) && <span className="pill bad" role="alert">{err || st.error}</span>}
      {st.ok && !err && <span className="pill good">{st.ok}</span>}
    </>
  );
}
