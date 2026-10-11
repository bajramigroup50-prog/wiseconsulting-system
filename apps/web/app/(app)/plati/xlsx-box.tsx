'use client';
/** Legacy `#plx_box` (v478): „📥 Плата од Excel“ on the month list. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { payXlsxImport, payXlsxTemplate } from './xlsx-actions';

export function PayXlsxBox({ next }: { next: string }) {
  const [mo, setMo] = useState(next);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const tpl = () => start(async () => {
    const t = await payXlsxTemplate(mo);
    if (t.error || !t.sheets) { setMsg({ error: t.error ?? 'Образецот не може да се подготви.' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const [i, s] of t.sheets.entries()) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      if (i === 0) ws['!cols'] = s.rows[0]!.map((_, j) => ({ wch: j === 1 ? 28 : j === 0 ? 15 : 12 }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out])), download: t.name! });
    a.click();
  });
  const imp = () => {
    if (!file) { setMsg({ error: 'Изберете Excel датотека.' }); return; }
    start(async () => {
      let aoa: string[][];
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        const R = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: '' });
        aoa = R.map((r) => r.map((v) => (typeof v === 'number' ? String(v) : String(v ?? ''))));
      } catch { setMsg({ error: 'Датотеката не може да се прочита.' }); return; }
      let r = await payXlsxImport(mo, file.name, aoa, false);
      if (r.confirm) {
        if (!window.confirm(r.confirm)) return;
        r = await payXlsxImport(mo, file.name, aoa, true);
      }
      setMsg(r);
      if (r.month && !r.error) router.push(`/plati/${r.month}`);
    });
  };
  return (
    <div className="card" id="plx_box">
      <b>📥 Плата од Excel</b> <span className="note">– 1) преземете образец со вашите вработени, 2) пополнете ги часовите и износите, 3) увезете → програмата го отвора месецот како предлог за проверка.</span>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'end' }}>
        <label className="f" style={{ width: 'auto' }}>Месец<input type="month" value={mo} onChange={(e) => setMo(e.target.value)} /></label>
        <button type="button" className="btn" disabled={pending} onClick={tpl}>⬇ Excel образец</button>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" className="btn pri" disabled={pending} onClick={imp}>{pending ? 'Се увезува…' : '📥 Увези и отвори'}</button>
      </div>
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')} style={{ marginTop: 8 }}>{msg.error ?? msg.ok}</div>}
    </div>
  );
}

