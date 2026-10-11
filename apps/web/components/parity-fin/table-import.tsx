'use client';
/**
 * Generic Excel/CSV import for the finance screens (legacy `XLSX.read` + `sheet_to_json({header:1})` pattern):
 * the browser reads the first sheet into rows and hands them to a server action; a „⬇ образец“ button downloads
 * the template with the recognised headings.
 */
import { useState, useTransition } from 'react';
import { xlsxDownload, type Cell } from './export-bar';

export interface ImportResult { ok?: string; error?: string }

export async function readSheetRows(file: File): Promise<Cell[][]> {
  const XLSX = await import('xlsx');
  const name = file.name.toLowerCase();
  const wb = /\.(csv|txt)$/.test(name)
    ? XLSX.read((await file.text()).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  return rows.map((r) => r.map((c) => (c instanceof Date
    ? `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
    : typeof c === 'number' ? c : c == null ? '' : String(c))));
}

export function TableImport({ action, template, label = '📥 Увоз од Excel', accept = '.xlsx,.xls,.csv', confirm, note }: {
  action: (rows: Cell[][], file: string) => Promise<ImportResult>;
  template?: { name: string; rows: Cell[][] };
  label?: string; accept?: string; confirm?: string; note?: string;
}) {
  const [msg, setMsg] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <label className="btn" title={note}>{pending ? 'Се увезува…' : label}
        <input type="file" accept={accept} hidden disabled={pending} onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            try { setMsg(await action(await readSheetRows(f), f.name)); } catch (err) { setMsg({ error: 'Датотеката не е прочитана: ' + ((err as Error).message || '') }); }
          });
        }} />
      </label>
      {template && <button type="button" className="btn ghost" onClick={() => xlsxDownload(template.name, [{ name: 'Образец', rows: template.rows }])}>⬇ Образец</button>}
      {msg && <span className={`pill ${msg.error ? 'bad' : 'good'}`} role="status" onClick={() => setMsg(null)}>{msg.error ?? msg.ok}</span>}
    </>
  );
}
