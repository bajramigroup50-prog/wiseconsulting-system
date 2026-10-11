'use client';
/** Legacy `zmBox` „📥 Увези од поднесена годишна сметка (Excel / CSV)“ (10947, `zmImport` 10953). */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importZsAopAction } from '@/app/(app)/zsProc/actions';

const TEMPLATE = [
  ['Биланс на состојба'],
  ['', 'АОП', 'Позиција', 'Тековна година', 'Претходна година'],
  ['', '001', 'А. Постојани средства', '', ''],
  ['', '063', 'Вкупна актива', '', ''],
  ['Биланс на успех'],
  ['', 'АОП', 'Позиција', 'Тековна година', 'Претходна година'],
  ['', '201', 'I. Приходи од работењето', '', ''],
];

export function ZmImport({ year }: { year: number }) {
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="card" id="zm_box">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b>📥 Увези од поднесена годишна сметка (Excel / CSV)</b>
        <button type="button" className="btn sm" onClick={async () => {
          const XLSX = await import('xlsx');
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(TEMPLATE), 'Годишна сметка');
          const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
          const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out])), download: `Godisna_smetka_obrazec_${year}.xlsx` });
          a.click();
        }}>⬇ Образец</button>
        <label className="btn sm pri">{pending ? 'Се чита…' : 'Избери датотека'}<input type="file" hidden accept=".xlsx,.xls,.csv" disabled={pending} onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          start(async () => {
            let r;
            try {
              if (/\.csv$/i.test(f.name)) r = await importZsAopAction({ csv: await f.text() });
              else {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
                let grid: unknown[][] = [];
                for (const sn of wb.SheetNames) grid = grid.concat(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn]!, { header: 1, raw: true, defval: '' }).map((row) => [sn, ...row]));
                r = await importZsAopAction({ grid });
              }
            } catch { r = { error: 'Датотеката не може да се прочита.' }; }
            setMsg(r);
            if (!r.error) router.refresh();
          });
        }} /></label>
      </div>
      <p className="mini" style={{ margin: '6px 0 0' }}>Износите за {year} (тековна година) и {year - 1} (претходна година) од поднесената сметка (на пр. од друга програма или од ЦРМ) се зачувуваат како рачни износи. PDF: прво зачувајте го како Excel (или внесете ги износите рачно).</p>
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 6 }}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}
