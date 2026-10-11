'use client';
/**
 * Parity toolbar for list / report / book screens (VAT, payroll, year-end, law): server PDF of a page region,
 * Excel export and Excel/CSV import with a downloadable template — the legacy screens carried these as
 * „⬇ PDF“, „⬇ Excel“ (`dtXlsx`/`pgXlsx`/`kkXlsx`) and „📥 Увоз од Excel“ buttons.
 */
import { useState, useTransition } from 'react';
import { PdfButton } from './pdf-button';

export type Cell = string | number | null;
export interface Sheet { name: string; rows: Cell[][] }

async function saveXlsx(name: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws['!cols'] = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(40, Math.max(8, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Лист').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name.endsWith('.xlsx') ? name : name + '.xlsx' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** „⬇ Excel“ — one sheet per entry. */
export function XlsxButton({ name, sheets, label = '⬇ Excel', className = 'btn' }: { name: string; sheets: Sheet[]; label?: string; className?: string }) {
  return <button className={className} type="button" onClick={() => saveXlsx(name, sheets)}>{label}</button>;
}

/** PDF of a page region + Excel export, side by side in a header. */
export function ExportTools({ pdf, title, landscape, xlsx, sheets }: {
  pdf?: string; title: string; landscape?: boolean; xlsx?: string; sheets?: Sheet[];
}) {
  return (
    <>
      {pdf && <PdfButton selector={pdf} title={title} landscape={landscape} />}
      {xlsx && sheets && sheets.some((s) => s.rows.length > 1) && <XlsxButton name={xlsx} sheets={sheets} />}
    </>
  );
}

export interface ImportResult { error?: string; ok?: string }

/**
 * „📥 Увоз од Excel“: reads the first sheet in the browser (xlsx/xls/csv), sends the rows (as text) to a guarded
 * server action, shows its result. „⬇ Образец“ downloads the header row as a template.
 */
export function XlsxImport({ action, template, templateName, label = '📥 Увоз од Excel', confirm }: {
  action: (rows: string[][]) => Promise<ImportResult>;
  template: string[][];
  templateName: string;
  label?: string;
  /** Confirmation text; `{n}` is replaced by the number of rows (a string: server components cannot pass functions). */
  confirm?: string;
}) {
  const [res, setRes] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn" onClick={() => saveXlsx(templateName, [{ name: 'Образец', rows: template }])}>⬇ Образец</button>
      <label className="btn">{pending ? 'Се увезува…' : label}<input type="file" accept=".xlsx,.xls,.csv" hidden disabled={pending} onChange={async (e) => {
        const fl = e.target.files?.[0]; e.target.value = '';
        if (!fl) return;
        try {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(new Uint8Array(await fl.arrayBuffer()), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]!]!;
          const F = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
          const R = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
          const rows = F.map((r, i) => r.map((v, j) => {
            const x = R[i]?.[j];
            return typeof x === 'number' && Number.isInteger(x) ? x.toLocaleString('fullwide', { useGrouping: false }) : String(v ?? '').trim();
          })).filter((r) => r.some((c) => c !== ''));
          if (rows.length < 2) { setRes({ error: 'Датотеката нема редови за увоз.' }); return; }
          if (confirm && !window.confirm(confirm.replace('{n}', String(rows.length - 1)))) return;
          start(async () => setRes(await action(rows.slice(0, 5001))));
        } catch { setRes({ error: 'Датотеката не може да се прочита.' }); }
      }} /></label>
      {res && <span className={'pill ' + (res.error ? 'bad' : 'good')} style={{ alignSelf: 'center' }} onClick={() => setRes(null)}>{res.error ?? res.ok}</span>}
    </>
  );
}
