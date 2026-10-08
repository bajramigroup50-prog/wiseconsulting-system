'use client';

/** Client-side .xlsx download, one sheet per entry (legacy `dtXlsx` 16828 with SheetJS). */
export function DownloadXlsx({ name, sheets, label = '⬇ Excel' }: { name: string; sheets: { name: string; rows: (string | number | null)[][] }[]; label?: string }) {
  return (
    <button className="btn" type="button" onClick={async () => {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{label}</button>
  );
}
