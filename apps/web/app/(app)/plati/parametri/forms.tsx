'use client';
import { useActionState, useState, useTransition } from 'react';
import { PAY_FUNDS, PAY_KEYS, PAY_SCH0, PAY_SCH_KEYS } from '@wise/core/payroll';
import type { ActionState } from '@/lib/books';
import { saveMpinTemplate, saveOrders, saveParamRows, saveScheme, type ParamRowInput } from './actions';

const Msg = ({ st }: { st: ActionState }) => (st.error ? <div className="callout bad">{st.error}</div> : st.ok ? <div className="callout good">{st.ok}</div> : null);

/** Editable list of override rows (legacy `#ppBody`). */
export function ParamTable({ scope, rows, last, canEdit }: { scope: 'firm' | 'office'; rows: ParamRowInput[]; last: ParamRowInput; canEdit: boolean }) {
  const [R, setR] = useState<ParamRowInput[]>(rows);
  const [st, setSt] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const keys = PAY_KEYS.map(([k]) => k);
  return (
    <div className="card">
      <div className="hd"><h2>{scope === 'firm' ? 'Измени за оваа фирма' : 'Измени за сите фирми (канцеларија)'}</h2>
        {canEdit && <div className="row">
          <button className="btn" type="button" onClick={() => setR([...R, { ...last, from: new Date().toISOString().slice(0, 7), src: '' }])}>+ Нов период</button>
          <button className="btn pri" type="button" disabled={pending} onClick={() => start(async () => setSt(await saveParamRows(scope, R)))}>Зачувај</button>
        </div>}
      </div>
      <Msg st={st} />
      {R.length ? (
        <div className="tw"><table className="dense">
          <thead><tr>{PAY_KEYS.map(([k, n]) => <th key={k} className={k === 'src' || k === 'from' ? undefined : 'n'}>{n}</th>)}<th></th></tr></thead>
          <tbody>{R.map((r, i) => (
            <tr key={i}>{keys.map((k) => (
              <td key={k}><input value={r[k] ?? ''} disabled={!canEdit} type={k === 'from' ? 'month' : k === 'src' ? 'text' : 'number'} step="any"
                style={k === 'from' || k === 'src' ? undefined : { width: 90, textAlign: 'right' }}
                onChange={(x) => setR(R.map((y, j) => (j === i ? { ...y, [k]: x.target.value } : y)))} /></td>
            ))}<td>{canEdit && <button className="btn sm ghost danger" type="button" onClick={() => setR(R.filter((_, j) => j !== i))}>✕</button>}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <p className="note">Нема измени – важат законските параметри од табелата погоре.</p>}
    </div>
  );
}

export function SchemeForm({ scheme, canEdit }: { scheme: Record<string, string>; canEdit: boolean }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveScheme, {});
  const L: Record<string, string> = {
    pay_gross: 'Трошок за бруто плата', pay_via: 'Обврска за бруто плата (меѓуконто, „-“ = без)', pay_net: 'Обврска за нето плата', pay_contrib: 'Придонеси (збирно)',
    pay_ded: 'Задршки од плата', pay_pio: 'ПИО', pay_zdr: 'Здравство', pay_dop: 'Доп. здравство', pay_vrab: 'Вработување', pay_tax: 'Персонален данок',
    pay_eTax: 'Трошок: данок („-“ = во бруто)', pay_ePio: 'Трошок: ПИО', pay_eZdr: 'Трошок: здравство', pay_eDop: 'Трошок: доп. здравство', pay_eVrab: 'Трошок: вработување',
  };
  return (
    <form className="card" action={action}>
      <h2>Конта за книжење на платата</h2><Msg st={st} />
      <div className="form">{PAY_SCH_KEYS.map((k) => (
        <label className="f" key={k}>{L[k] ?? k}<input name={k} defaultValue={scheme[k] ?? ''} placeholder={PAY_SCH0[k]} disabled={!canEdit} /></label>
      ))}</div>
      <p className="note">Празно поле = стандардно конто (сиво). Важи за новите книжења и за повторното книжење на отклучените месеци.</p>
      {canEdit && <div className="row"><button className="btn pri" disabled={pending}>Зачувај конта</button></div>}
    </form>
  );
}

export function OrdersForm({ o, canEdit, defaults }: { o: Record<string, unknown>; canEdit: boolean; defaults: { payerAcc: string; signer: string } }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveOrders, {});
  const funds = (o.funds ?? {}) as Record<string, { uplSm?: string; prihod?: string }>;
  const s = (k: string) => String(o[k] ?? '');
  return (
    <form className="card" action={action}>
      <h2>Налози за плаќање на платите</h2><Msg st={st} />
      <div className="form">
        <label className="f">Жиро сметка на фирмата (налогодавач)<input name="payerAcc" defaultValue={s('payerAcc')} placeholder={defaults.payerAcc} disabled={!canEdit} /></label>
        <label className="f">Банка на налогодавачот<input name="payerBank" defaultValue={s('payerBank')} disabled={!canEdit} /></label>
        <label className="f">Потписник (управител)<input name="signer" defaultValue={s('signer')} placeholder={defaults.signer} disabled={!canEdit} /></label>
        <label className="f">Функција на потписникот<input name="signerRole" defaultValue={s('signerRole')} placeholder="Управител" disabled={!canEdit} /></label>
        <label className="f">Шифра на општина на фирмата (МПИН)<input name="opstina" defaultValue={s('opstina')} disabled={!canEdit} /></label>
        <label className="f">Трезорска сметка<input name="trezor" defaultValue={s('trezor')} placeholder="100000000063095" disabled={!canEdit} /></label>
      </div>
      <table className="dense" style={{ marginTop: 8 }}><thead><tr><th>Придонес / данок</th><th>Уплатна сметка</th><th>Приходна шифра и програма</th></tr></thead>
        <tbody>{PAY_FUNDS.map(([k, n]) => (
          <tr key={k}><td>{n}</td><td><input name={`${k}_uplSm`} defaultValue={funds[k]?.uplSm ?? ''} disabled={!canEdit} /></td><td><input name={`${k}_prihod`} defaultValue={funds[k]?.prihod ?? ''} disabled={!canEdit} /></td></tr>
        ))}</tbody></table>
      <p className="note">Уплатните сметки и приходните шифри проверете ги според упатството на УЈП (ujp.gov.mk → Уплатни сметки). Без нив налозите ПП50 се печатат празни и се означени како непотполни.</p>
      {canEdit && <div className="row"><button className="btn pri" disabled={pending}>Зачувај</button></div>}
    </form>
  );
}

export function MpinTemplateForm({ info, canEdit }: { info: { edb: string; emps: number; ver: string } | null; canEdit: boolean }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveMpinTemplate, {});
  return (
    <form className="card" action={action}>
      <h2>МПИН шаблон</h2><Msg st={st} />
      <p className="note">Увезете еден претходен MPI3 .txt (од старата програма или е-УЈП) – се земаат шифрите на општина, подрачна единица и вид на примање по вработен. Шифрите внесени кај вработениот имаат предност.</p>
      {info ? <p>Активен шаблон: ЕДБ <b>{info.edb}</b> · {info.emps} вработени · верзија {info.ver || '—'}</p> : <p className="note">Нема шаблон – се користат шифрите од вработените и стандардните вредности.</p>}
      {canEdit && <div className="row">
        <input type="file" name="file" accept=".txt" />
        <button className="btn pri" disabled={pending}>Увези шаблон</button>
        {info && <button className="btn danger" name="remove" value="1" disabled={pending}>Отстрани шаблон</button>}
      </div>}
    </form>
  );
}
