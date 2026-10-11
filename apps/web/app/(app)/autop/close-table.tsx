'use client';
/** Legacy `apClDdvHTML` 16422: ДДВ-04 bases of every firm of the period, selection, print and close of the selected. */
import { useActionState, useState } from 'react';
import { apCloseSelected } from './actions';

export interface ClRow { id: string; name: string; label: string; month: boolean; fields: Record<string, number>; closed: boolean; ready: boolean }
const K = ['01', '02', '03', '04', '05', '06', '21', '22'] as const;
const n = (v: number | undefined) => Math.round(v || 0).toLocaleString('mk-MK');

export function CloseTable({ rows, mode }: { rows: ClRow[]; mode: string }) {
  const [pick, setPick] = useState<Set<string>>(() => new Set(rows.filter((r) => r.ready && !r.closed).map((r) => r.id)));
  const [st, act, pending] = useActionState(apCloseSelected, {});
  const sel = rows.filter((r) => pick.has(r.id));
  const tot = (k: string) => sel.reduce((s, r) => s + (r.fields[k] || 0), 0);
  const print = () => {
    if (!sel.length) { alert('Означете барем една фирма.'); return; }
    window.open(`/print/ddv04All?mode=${encodeURIComponent(mode)}&${sel.map((r) => 'id=' + r.id).join('&')}`, '_blank');
  };
  return (
    <form className="card" action={act} onSubmit={(e) => { if (!sel.length) { e.preventDefault(); alert('Означете барем една фирма.'); } }}>
      <input type="hidden" name="mode" value={mode} />
      {sel.map((r) => <input key={r.id} type="hidden" name="fid" value={r.id} />)}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🧮 ДДВ-04 – основици за сите фирми</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm" onClick={() => setPick(new Set(rows.filter((r) => r.ready && !r.closed).map((r) => r.id)))}>Означи подготвени</button>
          <button type="button" className="btn sm" onClick={() => setPick(new Set(rows.map((r) => r.id)))}>Означи сите</button>
          <button type="button" className="btn sm" onClick={() => setPick(new Set())}>Тргни ги</button>
          <button type="button" className="btn" onClick={print}>🖨 Печати ДДВ-04 (означени)</button>
          <button className="btn pri" disabled={pending}>✅ Затвори ги означените (книжи ДДВ-04 + PDF)</button>
        </div>
      </div>
      {st.error && <div className="callout bad">{st.error}</div>}
      {st.ok && <div className="callout good">{st.ok}</div>}
      <p className="muted" style={{ fontSize: 12.5, margin: '6px 0' }}>Пополнето автоматски од книгата на фактури: <b>01</b> основица 18% · <b>02</b> ДДВ 18% · <b>03/04</b> 10% · <b>05/06</b> 5% · <b>21/22</b> влезен промет и претходен данок · <b>31</b> за плаќање (+) / поврат (−). По книжењето пријавата ја поднесувате во е-Даноци со истите износи.</p>
      <div className="tw"><table className="dense">
        <thead><tr><th></th><th>Фирма</th><th>Период</th><th className="n">01 Основица 18%</th><th className="n">02 ДДВ 18%</th><th className="n">03 Осн. 10%</th><th className="n">04 ДДВ 10%</th><th className="n">05 Осн. 5%</th><th className="n">06 ДДВ 5%</th><th className="n">21 Влез осн.</th><th className="n">22 Претх. данок</th><th className="n">31 Плаќање / поврат</th><th>Статус</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><input type="checkbox" checked={pick.has(r.id)} onChange={(e) => { const P = new Set(pick); if (e.target.checked) P.add(r.id); else P.delete(r.id); setPick(P); }} /></td>
            <td style={{ whiteSpace: 'nowrap' }}><b>{r.name}</b></td>
            <td style={{ whiteSpace: 'nowrap' }}>{r.label} <span className="muted" style={{ fontSize: 11 }}>{r.month ? 'месечно' : 'тримесечно'}</span></td>
            {K.map((k) => <td key={k} className="n">{n(r.fields[k])}</td>)}
            <td className="n" style={{ fontWeight: 700, color: (r.fields['31'] ?? 0) > 0 ? 'var(--bad)' : (r.fields['31'] ?? 0) < 0 ? 'var(--good)' : 'inherit' }}>{n(r.fields['31'])}</td>
            <td>{r.closed ? <span className="pill good">✅ книжена</span> : r.ready ? <span className="pill good">подготвена</span> : <span className="pill warn">недостасува нешто</span>}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td></td><td colSpan={2}>Вкупно означени ({sel.length})</td>{[...K, '31'].map((k) => <td key={k} className="n">{n(tot(k))}</td>)}<td></td></tr></tfoot>
      </table></div>
    </form>
  );
}
