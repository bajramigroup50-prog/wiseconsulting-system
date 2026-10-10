'use client';
/**
 * Read fiscal report — legacy `fkHTML` 11411 → 11528 → 13043 / 13084 / 13103 / 13119: the read table (Датум, Z, промет и
 * ДДВ по групи, Вкупно, Готовина, Картичка, Контрола), what was read from the image, options (објект, шема, конто за
 * приход / картичка / готовина, не е ДДВ обврзник, збирно или по денови, МЕТГ распределба) and „Прокнижи“ for all rows.
 */
import { useActionState, useState } from 'react';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { postFiskReadAction } from './actions';

export interface ReadRow { date: string; z: string; gross: Record<string, number>; vat: Record<string, number>; total: number; cash: number; card: number; problems: string[] }

export function FiskRead({ ai, rows, G, daily, device, period, text, text2, locs, schemes, init, dupDates }: {
  ai: string; rows: ReadRow[]; G: Record<string, number>; daily: boolean; device: string; period: string; text: string; text2: string;
  locs: { id: string; name: string; kind?: string }[]; schemes: [string, string][];
  init: { wh: string; sc: string; rev: string; cardK: string; cashK: string; nonVat: boolean };
  /** Dates (YYYY-MM-DD|wh) that already have a posted report. */
  dupDates: string[];
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(postFiskReadAction, {});
  const [o, setO] = useState({ ...init, sum: true, mg: 'spread' as 'spread' | 'one', date: '', replace: false, checked: false });
  const set = (p: Partial<typeof o>) => setO((x) => ({ ...x, ...p }));
  const L = Object.keys(G).filter((k) => rows.some((r) => r.gross[k]));
  const bad = rows.filter((r) => r.problems.length).length;
  const nRec = daily && rows.length > 1 && !o.sum ? rows.length : 1;
  const total = rows.reduce((s, r) => s + r.total, 0);
  const loc = locs.find((l) => l.id === o.wh);
  const dups = dupDates.filter((d) => d.endsWith('|' + o.wh)).length;
  return (
    <form action={action} className="card" style={{ borderColor: 'var(--accent)' }}
      onSubmit={(e) => { if (!window.confirm(`Да се прокнижат ${nRec} ${nRec === 1 ? 'запис' : 'дневни прометa'} (вкупно ${fmt(total)} ден.${o.nonVat ? ', без ДДВ' : ''}) во „${loc?.name ?? o.wh}“?`)) e.preventDefault(); }}>
      <input type="hidden" name="payload" value={JSON.stringify({ ai, ...o })} />
      <h2>🤖 Прочитан фискален извештај{device ? ` · ФМ ${device}` : ''}{period ? ` · ${period}` : ''}</h2>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      {st.ok && <div className="callout good" role="status">{st.ok}</div>}
      <div className="tw"><table className="dense">
        <thead><tr><th>Датум</th><th>Z</th>{L.map((k) => <th key={k} className="n">{k} ({G[k]}%) промет / ДДВ</th>)}<th className="n">Вкупно</th><th className="n">Готовина</th><th className="n">Картичка</th><th>Контрола</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            <td>{r.date.split('-').reverse().join('.')}</td><td>{r.z}</td>
            {L.map((k) => <td key={k} className="n">{r.gross[k] ? <>{fmt(r.gross[k])}<br /><small className="note">{fmt(r.vat[k] ?? 0)}</small></> : ''}</td>)}
            <td className="n"><b>{fmt(r.total)}</b></td><td className="n">{fmt(r.cash)}</td><td className="n">{fmt(r.card)}</td>
            <td>{r.problems.length ? <span className="pill bad" title={r.problems.join('\n')}>{r.problems.join(' · ')}</span> : <span className="pill good">✓</span>}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={2 + L.length}>Вкупно ({rows.length})</td><td className="n">{fmt(total)}</td><td className="n">{fmt(rows.reduce((s, r) => s + r.cash, 0))}</td><td className="n">{fmt(rows.reduce((s, r) => s + r.card, 0))}</td><td>{bad ? <span className="pill bad">{bad} со разлика</span> : <span className="pill good">контролите се во ред</span>}</td></tr></tfoot>
      </table></div>
      {(text || text2) && <details style={{ margin: '6px 0' }}><summary className="mini" style={{ cursor: 'pointer' }}>📝 Што е прочитано од сликата</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{text}{text2 ? '\n\n' + text2 : ''}</pre></details>}
      <div className="form">
        <label className="f">Објект<select value={o.wh} onChange={(e) => set({ wh: e.target.value })}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="f">Шема на книжење<select value={o.sc} onChange={(e) => set({ sc: e.target.value })}>{schemes.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="f">Конто за приход<input value={o.rev} onChange={(e) => set({ rev: e.target.value.trim() })} placeholder="7411" style={{ width: 110 }} /></label>
        <label className="f">Конто за картички (POS)<input value={o.cardK} onChange={(e) => set({ cardK: e.target.value.trim() })} placeholder="1200001" style={{ width: 110 }} /></label>
        <label className="f">Конто за готовина<input value={o.cashK} onChange={(e) => set({ cashK: e.target.value.trim() })} placeholder="1009" style={{ width: 110 }} /></label>
        {!daily && <label className="f">Датум на книжење<input type="date" value={o.date} onChange={(e) => set({ date: e.target.value })} /></label>}
      </div>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap', margin: '6px 0' }}>
        <label className="chk"><input type="checkbox" checked={o.nonVat} onChange={(e) => set({ nonVat: e.target.checked, ...(e.target.checked ? { sc: 'trgNoVat' } : {}) })} /> не е ДДВ обврзник (промет без ДДВ)</label>
        {daily && rows.length > 1 && <label className="chk"><input type="checkbox" checked={o.sum} onChange={(e) => set({ sum: e.target.checked })} /> прокнижи збирно за периодот (дневните прометите остануваат за МЕТГ/КДФИ); инаку посебно секој ден</label>}
        {!daily && <label className="f">МЕТГ по денови<select value={o.mg} onChange={(e) => set({ mg: e.target.value as 'spread' | 'one' })}><option value="spread">распореди по денови (пон–саб)</option><option value="one">еден ред за периодот</option></select></label>}
        {dups > 0 && <label className="chk" style={{ color: 'var(--bad)' }}><input type="checkbox" checked={o.replace} onChange={(e) => set({ replace: e.target.checked })} /> ⚠ За {dups} ден(а) во оваа каса веќе има промет – замени го постојниот</label>}
        {bad > 0 && <label className="chk"><input type="checkbox" checked={o.checked} onChange={(e) => set({ checked: e.target.checked })} /> ги проверив разликите</label>}
      </div>
      {loc && loc.kind && loc.kind !== 'store' && o.sc !== 'usl' && <div className="callout warn">Објектот „{loc.name}“ не е продавница – прометот нема да се појави во МЕТГ.</div>}
      <div className="row"><button className="btn pri" disabled={pending || (bad > 0 && !o.checked)}>Прокнижи {nRec === 1 ? 'извештај' : `${nRec} дневни прометa`}</button></div>
    </form>
  );
}
