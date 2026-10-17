'use client';
/**
 * „Прекнижи ги избраните со Шема N“: the bar of a nalog's document list. The row checkboxes (`name="j"`, `form="schrep"`)
 * belong to this form; the result shows the skipped documents and the konto totals before → after.
 */
import { useActionState } from 'react';
import { fmt } from '@/lib/fmt';
import { repostSchemeAction, type SchemeRepostState } from './scheme-actions';

export function SchemeRepostBar({ schemes }: { schemes: { no: number; label: string }[] }) {
  const [st, run, pending] = useActionState<SchemeRepostState, FormData>(repostSchemeAction, {});
  const all = (on: boolean) => document.querySelectorAll<HTMLInputElement>('input[form="schrep"][name="j"]').forEach((x) => { if (!x.disabled) x.checked = on; });
  return (
    <form id="schrep" action={run} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 8px' }} aria-busy={pending}>
      <button type="button" className="btn sm ghost" onClick={() => all(true)}>☑ Сите</button>
      <button type="button" className="btn sm ghost" onClick={() => all(false)}>☐ Ниеден</button>
      <label className="mini">Шема <select name="scheme" defaultValue={String(schemes[0]?.no ?? 1)} style={{ width: 'auto' }}>
        <option value="1">Шема 1 – основна</option>
        {schemes.map((s) => <option key={s.no} value={s.no}>{s.label}</option>)}
      </select></label>
      <button className="btn sm pri" disabled={pending} title="Само документи во отворен период; заклучените се прескокнуваат">↻ Прекнижи ги избраните со шемата</button>
      {st.error && <div className="callout bad" role="alert" style={{ flexBasis: '100%' }}>{st.error}</div>}
      {st.ok && <div className="callout good" role="status" style={{ flexBasis: '100%' }}>{st.ok}</div>}
      {!!st.skipped?.length && <div className="callout warn" style={{ flexBasis: '100%' }}>Прескокнати: {st.skipped.map((s, i) => <span key={i}>{i ? '; ' : ''}{s.label} – {s.reason}</span>)}</div>}
      {!!st.diffs?.length && (
        <div className="tw" style={{ flexBasis: '100%' }}><table className="dense">
          <thead><tr><th>Конто</th><th className="n">Должи пред</th><th className="n">Побарува пред</th><th className="n">Должи потоа</th><th className="n">Побарува потоа</th></tr></thead>
          <tbody>{st.diffs.map((d) => <tr key={d.konto}><td className="num"><b>{d.konto}</b></td><td className="n">{fmt(d.d0)}</td><td className="n">{fmt(d.c0)}</td><td className="n">{fmt(d.d1)}</td><td className="n">{fmt(d.c1)}</td></tr>)}</tbody>
        </table></div>
      )}
    </form>
  );
}
