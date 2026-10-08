'use client';
import { toCsv } from '@/lib/fmt';

/** Client-side CSV download button (legacy `bilCsv`, `kkXlsx`, `ledCsv`). */
export function DownloadCsv({ name, rows, label = 'Excel (CSV)' }: { name: string; rows: (string | number | null)[][]; label?: string }) {
  return (
    <button className="btn" type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{label}</button>
  );
}
