'use client';
/**
 * List / report toolbar for the industry (Дејности) and transport screens — the user's rule "PDF, export and import
 * must not be missing anywhere":
 * - {@link ExportXlsx}: client-side .xlsx of the rows the page already rendered (legacy `frTXlsx`, `dtXlsx`, SheetJS);
 * - {@link ListPdf}: server PDF of a region of the page (legacy `pdf(fn, ph(title)+table)`, e.g. `htKPdf`);
 * - {@link XlsxImport}: Excel / CSV import with a downloadable template — the sheet is read in the browser and the rows
 *   (array of arrays, header row first) are posted as JSON in the form field `rows` to a guarded server action.
 */
import { useActionState, useState } from 'react';
import { serverPdf } from '@/lib/print-pdf';
import type { FormState } from './bank-form';

export type Cell = string | number | null | undefined;

async function xlsxBlob(sheets: { name: string; rows: Cell[][] }[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => r.map((c) => (c == null ? '' : c))));
    ws['!cols'] = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(40, Math.max(10, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Лист');
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** „⬇ Excel“: one sheet per entry, first row = header. */
export function ExportXlsx({ name, sheets, rows, label = '⬇ Excel', className = 'btn' }: {
  name: string; sheets?: { name: string; rows: Cell[][] }[]; rows?: Cell[][]; label?: string; className?: string;
}) {
  return (
    <button className={className} type="button" onClick={async () => {
      const S = sheets ?? [{ name: name.replace(/\.xlsx$/i, ''), rows: rows ?? [] }];
      download(await xlsxBlob(S), /\.xlsx$/i.test(name) ? name : name + '.xlsx');
    }}>{label}</button>
  );
}

/** „⬇ PDF“ of the element `#id` (server PDF, A4; `landscape` for wide tables). */
export function ListPdf({ target, title, landscape, label = '⬇ PDF', className = 'btn' }: { target: string; title: string; landscape?: boolean; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} title="PDF изработен на серверот (A4)" onClick={async () => {
      setBusy(true);
      try { await serverPdf({ selector: target.startsWith('#') ? target : '#' + target, title, landscape }); } finally { setBusy(false); }
    }}>{busy ? 'PDF…' : label}</button>
  );
}

/**
 * Excel / CSV import: „⬇ Образец“ downloads the template (header row + optional sample rows); choosing a file reads
 * the first sheet and posts `rows` (JSON array of arrays, header first) plus `name` to `action`.
 */
export function XlsxImport({ action, template, templateName, label = '📥 Увоз од Excel', note }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>; template: Cell[][]; templateName: string; label?: string; note?: string;
}) {
  const [st, run, pending] = useActionState<FormState, FormData>(action, {});
  const [err, setErr] = useState('');
  const read = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    try {
      const XLSX = await import('xlsx');
      const buf = new Uint8Array(await f.arrayBuffer());
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(new TextDecoder().decode(buf), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellDates: true });
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: false, defval: '' })
        .filter((r) => r.some((x) => String(x ?? '').trim() !== ''));
      if (aoa.length < 2) { setErr('Датотеката нема редови со податоци.'); return; }
      if (aoa.length > 5001) { setErr('Премногу редови (најмногу 5000) – поделете ја датотеката.'); return; }
      const fd = new FormData();
      fd.set('name', f.name);
      fd.set('rows', JSON.stringify(aoa.map((r) => r.map((x) => String(x ?? '').trim()))));
      run(fd);
    } catch { setErr('Датотеката не може да се прочита (Excel .xlsx/.xls или CSV).'); }
  };
  return (
    <span className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap', display: 'inline-flex' }}>
      <label className="btn" aria-busy={pending}>{pending ? 'Се увезува…' : label}<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <button type="button" className="btn ghost" title="Празен Excel образец со колоните што ги чита увозот" onClick={async () => download(await xlsxBlob([{ name: 'Образец', rows: template }]), templateName)}>⬇ Образец</button>
      {note && <span className="mini">{note}</span>}
      {(err || st.error) && <span className="pill bad" role="alert">{err || st.error}</span>}
      {st.ok && <span className="pill good" role="status">{st.ok}</span>}
    </span>
  );
}
