'use client';
/**
 * Manual journal editor — legacy `jEditor` 6403 (+ period 13460, nalog number 13472).
 * Totals update while typing (legacy 12981); one React state instead of the legacy global change listener.
 * Per-line note and document columns are new (FIX #9: the legacy editor had no per-line note).
 */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { lineTotals, needsPartner } from '@wise/core';
import type { ActionState } from '@/lib/books';
import { fmt } from '@/lib/fmt';
import { saveJournal } from './actions';
import { blankRow as blank, type EditorJournal, type EditorRow } from './editor-model';

/** End of month for "period from" (legacy 13461). */
const monthEnd = (d: string) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };

export function JournalEditor({ initial, chart, partners, numbers }: {
  initial: EditorJournal; chart: [string, string][]; partners: { id: string; code: string | null; name: string }[]; numbers: string[];
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveJournal, {});
  const [j, setJ] = useState(initial);
  const names = new Map(chart);
  const set = (p: Partial<EditorJournal>) => setJ((x) => ({ ...x, ...p }));
  const setRow = (i: number, p: Partial<EditorRow>) => setJ((x) => ({ ...x, rows: x.rows.map((r, k) => (k === i ? { ...r, ...p } : r)) }));
  const t = lineTotals(j.rows.map((r) => ({ debit: r.debit.replace(',', '.'), credit: r.credit.replace(',', '.') })));

  return (
    <form action={action} onKeyDown={(e) => { if (e.key === 'Insert') { e.preventDefault(); set({ rows: [...j.rows, blank('4400')] }); } }}>
      <input type="hidden" name="payload" value={JSON.stringify(j)} />
      <div className="hd">
        <h1>{j.id ? 'Корекција на налог ' + j.number : 'Рачен налог за книжење'}</h1>
        <div className="row">
          <Link className="btn" href={j.id ? `/nalozi?n=${encodeURIComponent(initial.number)}` : '/nalozi'}>Откажи</Link>
          <button className="btn pri" disabled={pending}>Зачувај</button>
        </div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="card"><div className="form">
        <label className="f">Број на налог
          <input list="j_noL" value={j.number} onChange={(e) => set({ number: e.target.value })} placeholder="на пр. 6/10-12 (празно = автоматски)" />
          <datalist id="j_noL">{numbers.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="f">Датум<input type="date" value={j.date} onChange={(e) => set({ date: e.target.value })} required /></label>
        <label className="f wide">Опис<input value={j.description} onChange={(e) => set({ description: e.target.value })} /></label>
        <label className="f">Период од<input type="date" value={j.periodFrom}
          onChange={(e) => set({ periodFrom: e.target.value, ...(e.target.value && !j.periodTo ? { periodTo: monthEnd(e.target.value) } : {}) })} /></label>
        <label className="f">до<input type="date" value={j.periodTo} onChange={(e) => set({ periodTo: e.target.value })} /></label>
      </div></div>
      <datalist id="kontoList">{chart.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
      <div className="tw"><table>
        <thead><tr><th>Конто</th><th>Назив</th><th>Партнер</th><th className="n">Должи</th><th className="n">Побарува</th><th>Опис (ред)</th><th>Документ</th><th></th></tr></thead>
        <tbody>
          {j.rows.map((r, i) => {
            const miss = needsPartner(r.account) && !r.partnerId && (Number(r.debit) || Number(r.credit));
            return (
              <tr key={i}>
                <td><input list="kontoList" value={r.account} onChange={(e) => setRow(i, { account: e.target.value.trim() })} style={{ width: 100 }} className="kin" /></td>
                <td className="mini">{names.get(r.account) ?? (r.account ? <span style={{ color: 'var(--bad)' }}>непознато конто</span> : '')}</td>
                <td>
                  <select value={r.partnerId} onChange={(e) => setRow(i, { partnerId: e.target.value })} style={{ maxWidth: 220, ...(miss ? { borderColor: 'var(--bad)' } : {}) }}>
                    <option value="">—</option>
                    {partners.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}
                  </select>
                </td>
                <td><input inputMode="decimal" value={r.debit} placeholder="0.00" onChange={(e) => setRow(i, { debit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
                <td><input inputMode="decimal" value={r.credit} placeholder="0.00" onChange={(e) => setRow(i, { credit: e.target.value })} style={{ textAlign: 'right', width: 130 }} /></td>
                <td><input value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} style={{ width: 190 }} /></td>
                <td><input value={r.doc} onChange={(e) => setRow(i, { doc: e.target.value })} style={{ width: 95 }} /></td>
                <td><button type="button" className="btn sm ghost danger" aria-label="Отстрани" onClick={() => set({ rows: j.rows.filter((_, k) => k !== i) })}>✕</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td colSpan={3}>Разлика: {fmt(t.diff)} {t.balanced ? <span className="pill good">изедначен</span> : <span className="pill bad">не е изедначен</span>}</td>
          <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td colSpan={3} />
        </tr></tfoot>
      </table></div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => set({ rows: [...j.rows, blank('4400')] })}>+ Ред (Ins)</button>
        <span className="note">Конто 120–128 и 220–228 бара партнер.</span>
      </div>
    </form>
  );
}
