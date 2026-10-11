'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ZsRule } from '@wise/core/yearend/aop';
import { prParse, prTemplate } from '@wise/core/yearend/tools';
import { resetZsRulesAction, saveZsRulesAction } from '../zsProc/actions';

export function RulesEditor({ rules, canSave }: { rules: ZsRule[]; canSave: boolean }) {
  const [R, setR] = useState<ZsRule[]>(rules);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (i: number, k: keyof ZsRule, v: string | number) => setR(R.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const done = (r: { ok?: string; error?: string }) => { setMsg(r); if (!r.error) router.refresh(); };
  return (
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <button type="button" className="btn" onClick={async () => {
          const XLSX = await import('xlsx');
          const ws = XLSX.utils.aoa_to_sheet(prTemplate(R));
          ws['!cols'] = [{ wch: 20 }, { wch: 8 }, { wch: 50 }, { wch: 22 }, { wch: 6 }, { wch: 24 }];
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'АОП');
          const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
          Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out])), download: 'AOP_pravila.xlsx' }).click();
        }}>Excel образец</button>
        <label className="btn">Увези од Excel<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          try {
            const XLSX = await import('xlsx');
            const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, defval: '' });
            const p = prParse(rows);
            if ('error' in p) { setMsg({ error: p.error }); return; }
            setR(p);
            setMsg({ ok: `Прочитани ${p.length} АОП позиции. Проверете ги и кликнете „Зачувај правила“.` });
          } catch { setMsg({ error: 'Excel не може да се прочита.' }); }
        }} /></label>
        {canSave && <button type="button" className="btn" disabled={pending} onClick={() => { if (window.confirm('Да се вратат стандардните правила?')) start(async () => done(await resetZsRulesAction())); }}>Врати стандардни</button>}
        {canSave && <button type="button" className="btn pri" disabled={pending} onClick={() => start(async () => done(await saveZsRulesAction(R)))}>Зачувај правила</button>}
      </div>
      {msg && <div className={'callout ' + (msg.error ? 'bad' : 'good')}>{msg.error ?? msg.ok}</div>}
      <div className="tw"><table>
        <thead><tr><th>Образец</th><th>АОП</th><th>Назив</th><th>Конта (префикси)</th><th>Знак</th><th>Формула</th><th></th></tr></thead>
        <tbody>{R.map((x, i) => (
          <tr key={i}>
            <td><select value={x.r} onChange={(e) => set(i, 'r', e.target.value)} style={{ width: 'auto' }}><option value="bu">БУ</option><option value="bs">БС</option></select></td>
            <td><input value={x.aop} onChange={(e) => set(i, 'aop', e.target.value)} style={{ width: 70 }} /></td>
            <td><input value={x.n} onChange={(e) => set(i, 'n', e.target.value)} style={{ minWidth: 260 }} /></td>
            <td><input value={x.k ?? ''} onChange={(e) => set(i, 'k', e.target.value)} style={{ width: 150 }} /></td>
            <td><select value={+x.s === -1 ? '-1' : '1'} onChange={(e) => set(i, 's', +e.target.value)} style={{ width: 'auto' }}><option value="1">+ Д</option><option value="-1">− П</option></select></td>
            <td><input value={x.f ?? ''} onChange={(e) => set(i, 'f', e.target.value)} style={{ width: 150 }} /></td>
            <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => setR(R.filter((_, j) => j !== i))}>✕</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="row"><button type="button" className="btn" onClick={() => setR([...R, { r: 'bu', aop: '', n: '', k: '', s: 1, f: '' }])}>+ Ред</button></div>
    </>
  );
}
