'use client';
/** Legacy `pddEditor` 8341: recipients (name / ЕМБГ / account from employees and natural-person partners), type, net or gross, live calculation. */
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { pddCalc, pddTotal, type PddRow, type PddType } from '@wise/core/finance';
import { fmt } from '@/lib/fmt';
import { savePddAction } from './actions';

export interface Person { name: string; embg: string; acct: string; pid: string; active?: boolean; emp?: boolean }

export function PddEditor({ id, date, note, rows: rows0, types, people }: { id?: string; date: string; note: string; rows: PddRow[]; types: PddType[]; people: Person[] }) {
  const [rows, setRows] = useState<PddRow[]>(rows0.length ? rows0 : [{ tid: types[0]!.id, mode: 'n', amt: 0, name: '', embg: '', acct: '', pid: null }]);
  const [d, setD] = useState(date);
  const [n, setN] = useState(note);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const tOf = (tid: string) => types.find((t) => t.id === tid) ?? types[0]!;
  const set = (i: number, o: Partial<PddRow>) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const x = { ...r, ...o };
    if (o.name !== undefined) { const p = people.find((p) => p.name === o.name); if (p) { x.embg = x.embg || p.embg; x.acct = x.acct || p.acct; x.pid = p.pid || null; } }
    if (o.embg !== undefined) { const p = people.find((p) => p.embg && p.embg === String(o.embg).replace(/\D/g, '')); if (p) { x.name = x.name || p.name; x.acct = x.acct || p.acct; x.pid = p.pid || null; } }
    return x;
  }));
  const tot = pddTotal(rows, types);
  const save = () => start(async () => {
    setErr('');
    const bad = rows.filter((r) => (r.name || r.amt) && String(r.embg ?? '').replace(/\D/g, '').length !== 13);
    if (bad.length && !window.confirm('ЕМБГ не е точен (13 цифри) за: ' + bad.map((r) => r.name || '?').join(', ') + '. Сепак да се зачува?')) return;
    const r = await savePddAction({ id, date: d, note: n, rows });
    if (r?.error) setErr(r.error);
  });
  return (
    <>
      <div className="card"><div className="form">
        <label className="f">Датум на исплата<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="f">Опис<input value={n} onChange={(e) => setN(e.target.value)} placeholder="на пр. Закупнина 09/2026" /></label>
      </div></div>
      <datalist id="pe_pl">{people.map((p, i) => <option key={i} value={p.name}>{p.embg}</option>)}</datalist>
      <div className="tw"><table className="dense">
        <thead><tr><th>Име и презиме</th><th>ЕМБГ</th><th>Трансакциска сметка</th><th>Вид</th><th>Внес</th><th className="n">Износ</th><th className="n">Бруто</th><th className="n">Одбитоци</th><th className="n">ПДД</th><th className="n">Нето</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const c = pddCalc(r, tOf(r.tid));
          return (
            <tr key={i}>
              <td><input list="pe_pl" value={r.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: 170 }} /></td>
              <td><input value={r.embg ?? ''} onChange={(e) => set(i, { embg: e.target.value })} style={{ width: 120 }} /></td>
              <td><input value={r.acct ?? ''} onChange={(e) => set(i, { acct: e.target.value })} style={{ width: 140 }} /></td>
              <td><select value={r.tid} onChange={(e) => set(i, { tid: e.target.value })} style={{ width: 230 }}>{types.map((t) => <option key={t.id} value={t.id}>{t.sh || t.pod}</option>)}</select></td>
              <td><select value={r.mode} onChange={(e) => set(i, { mode: e.target.value as 'n' | 'g' })} style={{ width: 'auto' }}><option value="n">нето</option><option value="g">бруто</option></select></td>
              <td className="n"><input type="number" step="1" value={r.amt || ''} onChange={(e) => set(i, { amt: +e.target.value || 0 })} style={{ width: 100, textAlign: 'right' }} /></td>
              <td className="n">{fmt(c.G)}</td><td className="n">{fmt(c.ded)}</td><td className="n">{fmt(c.tax)}</td><td className="n"><b>{fmt(c.net)}</b></td>
              <td><button type="button" className="btn sm ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr><td colSpan={6}>Вкупно ({rows.length})</td><td className="n">{fmt(tot.G)}</td><td className="n">{fmt(tot.ded)}</td><td className="n">{fmt(tot.tax)}</td><td className="n">{fmt(tot.net)}</td><td /></tr></tfoot>
      </table></div>
      {err && <div className="callout bad" role="alert">{err}</div>}
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => { const l = rows[rows.length - 1]; setRows([...rows, { tid: l?.tid ?? types[0]!.id, mode: l?.mode ?? 'n', amt: 0, name: '', embg: '', acct: '', pid: null }]); }}>+ Примач</button>
        <button type="button" className="btn" onClick={() => {
          const tid = types.some((t) => t.id === 's1_15') ? 's1_15' : types[0]!.id;
          const add = people.filter((p) => p.emp && p.active !== false && !rows.some((r) => r.embg && r.embg === p.embg)).map((p) => ({ tid, mode: 'n' as const, amt: 0, name: p.name, embg: p.embg, acct: p.acct, pid: null }));
          setRows([...rows, ...add].filter((r) => r.name || r.amt));
        }}>+ Сите вработени</button>
        <span style={{ flex: 1 }} />
        <Link className="btn" href="/pdd">Откажи</Link>
        <button type="button" className="btn pri" disabled={pending} onClick={save}>{pending ? 'Се книжи…' : 'Зачувај и книжи'}</button>
      </div>
      <p className="note">Изберете име од листата (вработени и комитенти – физички лица) и ЕМБГ и сметката се пополнуваат сами. „Нето“ = сумата што ја добива примачот; програмот го пресметува брутото, данокот и трошокот.</p>
    </>
  );
}
