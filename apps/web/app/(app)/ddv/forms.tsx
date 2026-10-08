'use client';
import { useActionState } from 'react';
import type { ActionState } from '@/lib/books';
import { saveCorrectionsAction, saveVatAccountsAction } from './actions';

const Msg = ({ st }: { st: ActionState }) => (
  <>
    {st.error && <div className="callout bad" role="alert">{st.error}</div>}
    {st.ok && <div className="callout good" role="status">{st.ok}</div>}
  </>
);

/** Field 30 "Останати корекции" + amendment number (legacy always 0 — LEGACY-MAP 5.4 item 5). */
export function CorrectionsForm({ period, field30, note, amendmentNo, disabled }: {
  period: string; field30: number; note: string; amendmentNo: string; disabled: boolean;
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveCorrectionsAction, {});
  return (
    <form className="card" action={action}>
      <div className="hd" style={{ margin: '0 0 6px' }}><b>Корекции и исправка</b></div>
      <Msg st={st} />
      <input type="hidden" name="period" value={period} />
      <div className="row" style={{ gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="f">Поле 30 – останати корекции (ден.)<input name="field30" defaultValue={field30 ? String(field30) : ''} inputMode="decimal" disabled={disabled} style={{ width: 160 }} /></label>
        <label className="f">Исправка на ДДВ-04 – број<input name="amendmentNo" defaultValue={amendmentNo} disabled={disabled} style={{ width: 140 }} /></label>
        <label className="f" style={{ flex: 1, minWidth: 220 }}>Образложение<input name="note" defaultValue={note} disabled={disabled} /></label>
        {!disabled && <button className="btn" disabled={pending}>Зачувај</button>}
      </div>
      <p className="note" style={{ margin: '6px 0 0' }}>Поле 31 = 20 − 29 − 30. Позитивна корекција го намалува долгот.</p>
    </form>
  );
}

type Vals = Record<string, string>;

/** Даночни тарифи — VAT kontos per rate (legacy `VIEWS.tarifi` 12844). */
export function VatAccountsForm({ values, names, firmName, canGlobal, options }: {
  values: Vals; names: Record<string, string>; firmName: string; canGlobal: boolean; options: [string, string][];
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveVatAccountsAction, {});
  const inp = (id: string) => (
    <>
      <input name={id} defaultValue={values[id] ?? ''} style={{ width: 110 }} list="trkl" inputMode="numeric" />
      <div className="mini mut" style={{ maxWidth: 180 }}>{values[id] ? names[values[id]!] ?? '⚠ нема во контниот план' : ''}</div>
    </>
  );
  const R: [string, number, string, string][] = [
    ['А', 18, 'Општа стапка', '01/02 · 21/22'], ['Б', 10, 'Угостителство и др. повластени', '03/04'], ['В', 5, 'Храна, лекови, книги и др. повластени', '05/06'],
  ];
  return (
    <form action={action}>
      <Msg st={st} />
      <div className="tw"><table>
        <thead><tr><th>Тарифа</th><th>Стапка</th><th>Примена</th><th>Излезен ДДВ</th><th>Претходен ДДВ</th><th>ДДВ при увоз</th><th>ДДВ-04 полиња</th></tr></thead>
        <tbody>
          {R.map(([t, r, n, p]) => <tr key={r}><td>{t}</td><td>{r}%</td><td>{n}</td><td>{inp('o' + r)}</td><td>{inp('i' + r)}</td><td>{inp('m' + r)}</td><td>{p}</td></tr>)}
          <tr><td>Г</td><td>0%</td><td>Извоз / ослободен промет</td><td>—</td><td>—</td><td>—</td><td>07 / 08 / 09 / 10</td></tr>
          <tr><td>Чл. 32-а</td><td>18% пренесен</td><td>Пренесување на даночна обврска</td><td>{inp('r32out')}</td><td>{inp('r32in')}</td><td>—</td><td>11 · 16–19 · 25/26</td></tr>
          <tr><td colSpan={3}>Затворање на ДДВ-04</td><td>{inp('ddvPay')}<div className="mini">обврска за плаќање</div></td><td>{inp('ddvClaim')}<div className="mini">побарување (поврат)</div></td><td /><td /></tr>
        </tbody>
      </table></div>
      <datalist id="trkl">{options.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
      <div className="card">
        <div className="row" style={{ gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="rb"><input type="radio" name="scope" value="f" defaultChecked /> само за оваа фирма ({firmName})</label>
          {canGlobal && <label className="rb"><input type="radio" name="scope" value="g" /> за сите фирми</label>}
          <span style={{ flex: 1 }} />
          <button className="btn pri" disabled={pending}>Зачувај конта</button>
        </div>
        <p className="note" style={{ margin: '8px 0 0' }}>Новите конта важат за документите што ќе се книжат одсега. Збирните конта (2300, 1300, 230, 130 …) не се дозволени за ДДВ. Затворањето на ДДВ и пресметката од налозите ги гледаат контата од оваа табела.</p>
      </div>
    </form>
  );
}
