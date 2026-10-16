'use client';
/**
 * P34 — „📦 Масовен извоз за е-Фактура“ on the Е-Фактура screen: period / not-yet-exported / ticked invoices → one ZIP
 * of UBL XML + `lista.csv` from `POST /api/ubl/zip`. Preparation only: nothing is sent to УЈП.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ticked } from './bulk-select';

const GROUP = 'ef';

export function EfExport({ firmId, from: f0, to: t0, unsent }: { firmId: string; from: string; to: string; unsent: number }) {
  const router = useRouter();
  const [from, setFrom] = useState(f0);
  const [to, setTo] = useState(t0);
  const [n, setN] = useState(0);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const h = () => setN(ticked(GROUP).length);
    document.addEventListener('wise-sel', h);
    return () => document.removeEventListener('wise-sel', h);
  }, []);
  const run = (sel: 'period' | 'unsent' | 'ids') => start(async () => {
    setMsg(null);
    const fd = new FormData();
    fd.set('fid', firmId); fd.set('sel', sel); fd.set('from', from); fd.set('to', to);
    if (sel === 'ids') for (const id of ticked(GROUP)) fd.append('id', id);
    try {
      const r = await fetch('/api/ubl/zip', { method: 'POST', body: fd });
      if (!r.ok) { setMsg({ t: await r.text(), bad: true }); return; }
      const cd = r.headers.get('content-disposition') ?? '';
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? 'eFaktura.zip');
      const url = URL.createObjectURL(await r.blob());
      Object.assign(document.createElement('a'), { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      const ok = Number(r.headers.get('x-ef-exported') ?? 0);
      const bad = Number(r.headers.get('x-ef-failed') ?? 0);
      setMsg({ t: `Извезени ${ok} фактури${bad ? `; ${bad} не се извезени (причините се во lista.csv во ZIP-от)` : ''}.`, bad: bad > 0 });
      router.refresh();
    } catch { setMsg({ t: 'Извозот не успеа – проверете ја врската.', bad: true }); }
  });
  return (
    <div className="card noprint">
      <h2 style={{ margin: '0 0 6px' }}>📦 Масовен извоз за е-Фактура (ZIP)</h2>
      <p className="mini" style={{ margin: '0 0 8px' }}>Секоја фактура се извезува како UBL 2.1 XML и пред тоа се проверува (податоци на фирмата и купувачот, збирови, ДДВ). Фактурите со грешка не влегуваат во ZIP-от – наведени се со причината во <b>lista.csv</b>. <b>Ништо не се испраќа до УЈП</b> – ова е само подготовка.</p>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="mini">Од <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="mini">до <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
        <button type="button" className="btn pri" disabled={pending} onClick={() => run('unsent')}>⬇ Неизвезени во периодот{unsent ? ` (${unsent} во годината)` : ''}</button>
        <button type="button" className="btn" disabled={pending} onClick={() => run('period')}>⬇ Сите во периодот</button>
        <button type="button" className="btn" disabled={pending || !n} onClick={() => run('ids')}>⬇ Штиклираните ({n})</button>
        {pending && <span className="mini">Се подготвува…</span>}
      </div>
      {msg && <div className={'callout ' + (msg.bad ? 'warn' : 'good')} style={{ marginTop: 8 }}>{msg.t}</div>}
    </div>
  );
}
