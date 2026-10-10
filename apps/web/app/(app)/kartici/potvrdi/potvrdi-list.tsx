'use client';
import { useState, useTransition } from 'react';
import { dmy, fmt } from '@/lib/fmt';
import { savePartnerEmailAction, sendConfirmationsAction } from '../potvrdi-actions';

export function PotvrdiList({ to, rows, write }: { to: string; write: boolean; rows: { pid: string; name: string; code: string; email: string; R: { s: string; v: number }[]; last: string }[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(rows.map((r) => r.pid)));
  const [q, setQ] = useState('');
  const [card, setCard] = useState(true);
  const [mail, setMail] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.pid, r.email])));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const V = rows.filter((x) => !q || (x.name + ' ' + x.code).toLowerCase().includes(q.toLowerCase()));
  const n = rows.filter((x) => sel.has(x.pid)).length, ne = rows.filter((x) => sel.has(x.pid) && mail[x.pid]).length;
  return (
    <div className="card">
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="chk"><input type="checkbox" checked={card} onChange={(e) => setCard(e.target.checked)} /> приложи и картица на комитентот</label>
        <input placeholder="Барај…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
        <button type="button" className="btn sm" onClick={() => setSel(new Set(rows.map((r) => r.pid)))}>Сите</button>
        <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>Ниеден</button>
        <span className="mini">избрани {n} · со е-пошта {ne}</span>
      </div>
      <div className="tw" style={{ marginTop: 8, maxHeight: '60vh', overflow: 'auto' }}><table className="dense">
        <thead><tr><th /><th>Комитент</th><th>Е-пошта</th><th>Салда</th><th>Испратено</th></tr></thead>
        <tbody>{V.length ? V.map((x) => (
          <tr key={x.pid}>
            <td><input type="checkbox" checked={sel.has(x.pid)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(x.pid); else s.delete(x.pid); setSel(s); }} /></td>
            <td>{x.code ? x.code + ' ' : ''}{x.name}</td>
            <td><input value={mail[x.pid] ?? ''} placeholder="нема е-пошта" style={{ width: 200 }} disabled={!write}
              onChange={(e) => setMail({ ...mail, [x.pid]: e.target.value })}
              onBlur={(e) => { if (e.target.value.trim() !== x.email) start(async () => { const r = await savePartnerEmailAction(x.pid, e.target.value); if (r.error) setMsg(r); }); }} /></td>
            <td className="mini">{x.R.map((r) => <span key={r.s}>{r.s}: <b>{fmt(r.v)}</b> · </span>)}</td>
            <td className="mini">{x.last ? dmy(x.last) : '—'}</td>
          </tr>
        )) : <tr><td colSpan={5} className="note">Нема комитенти со салдо на 120/162/220/262.</td></tr>}</tbody>
      </table></div>
      {msg.ok && <div className="callout good" role="status">{msg.ok}</div>}
      {msg.error && <div className="callout bad" role="alert">{msg.error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <a className="btn" href={`/print/fin/potvrda?all=1&to=${to}&ids=${[...sel].join(',')}`} target="_blank" rel="noopener">🖨 PDF на избраните ({n})</a>
        {write && <button type="button" className="btn pri" disabled={pending || !ne} onClick={() => {
          if (!window.confirm(`Да се испратат потврди на салдо на ${dmy(to)} на сите избрани комитенти со е-пошта (${ne})?`)) return;
          start(async () => setMsg(await sendConfirmationsAction({ to, ids: [...sel].filter((id) => mail[id]), card })));
        }}>{pending ? 'Се праќа…' : `✉ Испрати на ${ne} со е-пошта`}</button>}
      </div>
    </div>
  );
}
