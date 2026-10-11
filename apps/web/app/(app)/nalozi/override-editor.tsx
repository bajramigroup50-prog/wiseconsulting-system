'use client';
/**
 * Manual correction of a nalog created from a document — legacy `nalPage` edit mode 3573 / `nalogHTML(g,false,true)`
 * 3552 / `nalSaveRows` 3580: konto, должи, побарува, комитент, опис, документ per line; ✕ deletes an original line
 * (struck through, ↺ restores), „+ Нов ред (Ins)“, live totals, „Зачувај (F4)“, „Откажи (Esc)“.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { lineTotals, needsPartner } from '@wise/core';
import type { OvRow } from '@wise/core/finpar';
import { fmt } from '@/lib/fmt';
import { saveOverrideAction } from './actions';

export function OverrideEditor({ journalId, number, rows: initial, chart, partners }: {
  journalId: string; number: string; rows: OvRow[]; chart: [string, string][]; partners: { id: string; code: string | null; name: string }[];
}) {
  const [rows, setRows] = useState<OvRow[]>(initial);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const names = new Map(chart);
  const back = `/nalozi?n=${encodeURIComponent(number)}`;
  const set = (i: number, p: Partial<OvRow>) => setRows((R) => R.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const add = () => setRows((R) => [...R, { i: null, account: '', debit: 0, credit: 0, partnerId: null, note: R.find((r) => r.note)?.note ?? '', doc: R.find((r) => r.doc)?.doc ?? '', del: false }]);
  const t = lineTotals(rows.filter((r) => !r.del).map((r) => ({ debit: r.debit, credit: r.credit })));
  const save = () => start(async () => {
    setErr('');
    const res = await saveOverrideAction(journalId, rows.filter((r) => r.i != null || r.debit || r.credit));
    if (res?.error) setErr(res.error);
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F4') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); router.push(back); }
      else if (e.key === 'Insert') { e.preventDefault(); add(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const num = (v: string) => Number(String(v).replace(',', '.')) || 0;
  return (
    <>
      <div className="hd">
        <h1>Налог за книжење бр. {number}<span className="mk">рачна корекција</span></h1>
        <div className="row">
          <button type="button" className="btn" onClick={add}>+ Нов ред (Ins)</button>
          <button type="button" className="btn" onClick={() => router.push(back)}>Откажи (Esc)</button>
          <button type="button" className="btn pri" disabled={pending} onClick={save}>{pending ? 'Се зачувува…' : 'Зачувај (F4)'}</button>
        </div>
      </div>
      <div className="callout">Рачна корекција: може да се менува <b>контото, износите (должи/побарува), бројот на документот, описот и комитентот</b>, да се <b>бришат редови (✕)</b> и да се додаваат нови редови (Ins). Налогот мора да остане изедначен – ако избришете ред, внесете го износот на друго конто или со нов ред. Корекциите остануваат и по повторното книжење на документот; ако самиот документ (фактура, извод) се измени, корекцијата на тој ред се поништува.</div>
      {err && <div className="callout bad" role="alert">{err}</div>}
      <datalist id="nkpl">{chart.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
      <div className="tw"><table className="dense nalg">
        <thead><tr><th className="n">Р.бр.</th><th>Конто</th><th className="n">Должи</th><th className="n">Побарува</th><th>Комитент</th><th style={{ minWidth: 200 }}>Опис / содржина</th><th>Документ</th><th></th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const miss = !r.del && needsPartner(r.account) && !r.partnerId && (r.debit || r.credit);
            return (
              <tr key={i} style={r.del ? { textDecoration: 'line-through', opacity: 0.45 } : r.i == null ? { background: 'var(--accent-soft)' } : undefined}>
                <td className="n">{r.i == null ? 'нов' : r.i + 1}</td>
                <td title={names.get(r.account) ?? ''}><input className="kin" list="nkpl" value={r.account} disabled={r.del} onChange={(e) => set(i, { account: e.target.value.trim() })} style={{ width: 96 }} />
                  {r.account && !names.has(r.account) && <><br /><small style={{ color: 'var(--bad)' }}>непознато конто</small></>}</td>
                <td className="n"><input inputMode="decimal" defaultValue={r.debit || ''} disabled={r.del} onChange={(e) => set(i, { debit: num(e.target.value) })} style={{ width: 105, textAlign: 'right' }} /></td>
                <td className="n"><input inputMode="decimal" defaultValue={r.credit || ''} disabled={r.del} onChange={(e) => set(i, { credit: num(e.target.value) })} style={{ width: 105, textAlign: 'right' }} /></td>
                <td><select value={r.partnerId ?? ''} disabled={r.del} onChange={(e) => set(i, { partnerId: e.target.value || null })} style={{ maxWidth: 200, ...(miss ? { borderColor: 'var(--bad)' } : {}) }}>
                  <option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.code ? p.code + ' · ' : ''}{p.name}</option>)}
                </select></td>
                <td><input value={r.note} disabled={r.del} onChange={(e) => set(i, { note: e.target.value })} style={{ width: 190 }} /></td>
                <td><input value={r.doc} disabled={r.del} onChange={(e) => set(i, { doc: e.target.value })} style={{ width: 95 }} /></td>
                <td>{r.i == null
                  ? <button type="button" className="btn sm ghost" style={{ color: 'var(--bad)' }} onClick={() => setRows((R) => R.filter((_, k) => k !== i))}>✕</button>
                  : r.del
                    ? <button type="button" className="btn sm ghost" title="Врати го редот" style={{ textDecoration: 'none' }} onClick={() => set(i, { del: false })}>↺</button>
                    : <button type="button" className="btn sm ghost" title="Избриши го овој ред од налогот" style={{ color: 'var(--bad)' }} onClick={() => set(i, { del: true })}>✕</button>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td colSpan={2}>Вкупно ({rows.filter((r) => !r.del).length} ставки) {t.balanced ? <span className="pill good">изедначен</span> : <span className="pill bad">неизедначен · разлика {fmt(t.diff)}</span>}</td>
          <td className="n">{fmt(t.D)}</td><td className="n">{fmt(t.P)}</td><td colSpan={4} />
        </tr></tfoot>
      </table></div>
    </>
  );
}

/** Legacy 7891–7893: F2 = корекција, Esc = листа (on the nalog view). */
export function NalogKeys({ edit, list }: { edit?: string; list: string }) {
  const router = useRouter();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tg = (e.target as HTMLElement)?.tagName;
      if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
      if (e.key === 'F2' && edit) { e.preventDefault(); router.push(edit); }
      else if (e.key === 'Escape') { e.preventDefault(); router.push(list); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [edit, list, router]);
  return null;
}
