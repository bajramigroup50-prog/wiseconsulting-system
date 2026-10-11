'use client';
/**
 * Pay-change notes (legacy `pnCard` 15240 / `pnSaveGo` / `pnDone` / `pnUndo` / `pnDel`). While a note is open for the
 * month, calculating (F4), locking and the MPIN export are blocked (legacy v501 `pnBlock`, enforced server-side).
 */
import { useActionState, useState } from 'react';
import { PAY_NOTE_TYPES } from '@wise/core/payroll';
import type { ActionState } from '@/lib/books';
import { RowAction } from '@/components/row-action';
import { deleteNoteAction, noteDoneAction, saveNoteAction } from './actions';

export interface NoteRow {
  id: string; month: string; type: string; employeeId: string | null; empName: string | null; amount: string | null; text: string | null;
  done: boolean; doneAt: string | null; doneMonth: string | null; createdAt: string;
}
const MON = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const mo = (m: string) => `${MON[+m.slice(5) - 1] ?? ''} ${m.slice(0, 4)}`;

export function NotesCard({ notes, month, open, employees, canWrite, canDel }: {
  notes: NoteRow[]; month: string; open: number; employees: { id: string; name: string; position: string | null }[]; canWrite: boolean; canDel: boolean;
}) {
  const [ed, setEd] = useState<Partial<NoteRow> | null>(null);
  const [st, action, pending] = useActionState<ActionState, FormData>(async (p, f) => { const r = await saveNoteAction(p, f); if (r.ok) setEd(null); return r; }, {});
  const O = notes.filter((n) => !n.done && n.month <= month), fut = notes.filter((n) => !n.done && n.month > month), D = notes.filter((n) => n.done);
  const row = (n: NoteRow, act: React.ReactNode) => (
    <tr key={n.id} style={n.done ? undefined : { background: 'color-mix(in srgb,var(--bad) 7%,transparent)' }}>
      <td style={{ whiteSpace: 'nowrap' }}>{mo(n.month)}</td><td><b>{n.type}</b></td><td>{n.empName}</td>
      <td>{n.text}{n.amount && <span className="mini"> ({n.amount} ден)</span>}<div className="mini">{n.createdAt.slice(0, 10).split('-').reverse().join('.')}{n.done && ` · ✓ внесено ${n.doneMonth ? 'во ' + n.doneMonth : ''}`}</div></td>
      <td style={{ whiteSpace: 'nowrap' }}>{act}</td>
    </tr>
  );
  const manual = ed && (ed.employeeId === '' || (!ed.employeeId && !!ed.empName) || ed.type === 'Нов вработен');
  return (
    <div className="card" id="pn_card" style={open ? { border: '2px solid var(--bad)' } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>🔔 Известувања за промени кај платите {O.length ? <span className="pill bad">{O.length} отворени за {mo(month)}</span> : <span className="pill good">нема отворени</span>}</h2>
        <span className="row" style={{ gap: 6 }}>
          <a className="btn sm" href="/payBatch" title="Плати за сите фирми (legacy pnCard)">👥 Сите фирми</a>
          {canWrite && <button className="btn sm pri" type="button" onClick={() => setEd({ month, type: 'Промена на плата / коефициент' })}>+ Ново известување</button>}
        </span>
      </div>
      {ed && (
        <form action={action} style={{ marginTop: 8 }}>
          {ed.id && <input type="hidden" name="id" value={ed.id} />}
          {st.error && <div className="callout bad">{st.error}</div>}
          <div className="form">
            <label className="f">Важи од месец<input name="month" type="month" defaultValue={ed.month} required /></label>
            <label className="f">Вид<select name="type" defaultValue={ed.type} onChange={(x) => setEd({ ...ed, type: x.target.value })}>{PAY_NOTE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="f">Вработен
              <select name="employeeId" value={manual ? '__man' : ed.employeeId ?? ''} onChange={(x) => setEd({ ...ed, employeeId: x.target.value === '__man' ? '' : x.target.value, empName: x.target.value === '__man' ? ed.empName ?? ' ' : '' })}>
                <option value="">— општо (без вработен) —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.position ? ' – ' + e.position : ''}</option>)}
                <option value="__man">✎ Впиши рачно (нов вработен / друг)</option>
              </select>
            </label>
            {manual && <label className="f">Име и презиме (рачно)<input name="empName" defaultValue={ed.empName?.trim() ?? ''} /></label>}
            <label className="f">Износ (ако има)<input name="amount" type="number" step="any" defaultValue={ed.amount ?? ''} /></label>
            <label className="f wide">Опис<input name="text" defaultValue={ed.text ?? ''} placeholder="пр. од 15.10 нова плата нето 32.000; боледување 5–9 окт." /></label>
          </div>
          <div className="row" style={{ gap: 6 }}><button className="btn pri sm" disabled={pending}>💾 Зачувај</button><button className="btn sm" type="button" onClick={() => setEd(null)}>Откажи</button></div>
        </form>
      )}
      {O.length ? (
        <table className="dense" style={{ marginTop: 8 }}><thead><tr><th>Од месец</th><th>Вид</th><th>Вработен</th><th>Опис</th><th></th></tr></thead>
          <tbody>{O.map((n) => row(n, <>
            {canWrite && <RowAction className="btn sm pri" action={noteDoneAction.bind(null, n.id, true, month)} label="✓ Внесено" title="Промената е внесена во платата" />}{' '}
            {canWrite && <button className="btn sm ghost" type="button" onClick={() => setEd(n)}>✎</button>}
            {canDel && <RowAction className="btn sm ghost danger" action={deleteNoteAction.bind(null, n.id)} label="✕" confirm="Да се избрише известувањето?" />}
          </>))}</tbody></table>
      ) : <p className="mini" style={{ margin: '6px 0 0' }}>Кога клиентот ќе јави промена (нов вработен, отказ, нова плата, боледување, бонус…), запишете ја тука. Додека има отворени известувања, програмата <b>не дозволува</b> пресметка (F4), заклучување на месецот и МПИН.</p>}
      {fut.length > 0 && <details style={{ marginTop: 6 }}><summary className="mini">За следни месеци ({fut.length})</summary><table className="dense"><tbody>{fut.map((n) => row(n, canWrite && <button className="btn sm ghost" type="button" onClick={() => setEd(n)}>✎</button>))}</tbody></table></details>}
      {D.length > 0 && <details style={{ marginTop: 6 }}><summary className="mini">Внесени ({D.length})</summary><table className="dense"><tbody>{D.slice(-30).reverse().map((n) => row(n, canWrite && <RowAction action={noteDoneAction.bind(null, n.id, false, null)} label="↺" title="Врати како отворено" />))}</tbody></table></details>}
    </div>
  );
}
