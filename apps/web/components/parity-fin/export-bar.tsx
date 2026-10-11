'use client';
/**
 * Export buttons for the finance list/report screens (legacy `pdf(...)` + `xlsx`/`csv` header buttons):
 * server PDF of an on-screen area (`PdfButton` → `/api/pdf`), Excel (.xlsx via SheetJS) and CSV.
 */
import { PdfButton } from '@/components/pdf-button';
import { toCsv } from '@/lib/fmt';

export type Cell = string | number | null;

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function xlsxDownload(name: string, sheets: { name: string; rows: Cell[][] }[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const w = (s.rows[0] ?? []).map((_, i) => ({ wch: Math.min(60, Math.max(8, ...s.rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
    ws['!cols'] = w;
    XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Лист').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  download(name, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/**
 * PDF + Excel + CSV. `pdf` = CSS selector of the area to render (default `#finArea`), `name` = file name without
 * extension, `rows` = table for Excel/CSV (first row = headings).
 */
export function ExportBar({ name, rows, pdf = '#finArea', title, landscape, csv = true, sheets }: {
  name: string; rows: Cell[][]; pdf?: string | false; title?: string; landscape?: boolean; csv?: boolean;
  sheets?: { name: string; rows: Cell[][] }[];
}) {
  return (
    <>
      {pdf !== false && <PdfButton selector={pdf} title={title ?? name} landscape={landscape} />}
      <button className="btn" type="button" onClick={() => xlsxDownload(name + '.xlsx', sheets ?? [{ name: title ?? name, rows }])}>⬇ Excel</button>
      {csv && <button className="btn" type="button" onClick={() => download(name + '.csv', new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))}>CSV</button>}
    </>
  );
}
