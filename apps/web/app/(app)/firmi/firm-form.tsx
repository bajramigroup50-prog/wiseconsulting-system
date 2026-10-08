'use client';
/** Firm card, "Основни податоци" tab of legacy `firmForm` (other tabs move over with their modules). */
import Link from 'next/link';
import { useActionState } from 'react';
import type { Firm } from '@wise/db';
import { saveFirm, type FirmFormState } from './actions';

const LF: [string, string][] = [
  ['dooel', 'ДООЕЛ'], ['doo', 'ДОО'], ['ad', 'АД'], ['tp', 'ТП (трговец поединец)'], ['zdr', 'Здружение / фондација'],
  ['ustanova', 'Установа'], ['podruznica', 'Подружница на странско друштво'], ['other', 'Друго'],
];

export function FirmForm({ firm: d }: { firm: Firm | null }) {
  const [st, action, pending] = useActionState<FirmFormState, FormData>(saveFirm, {});
  const I = ({ k, l, b, w, ph, type }: { k: keyof Firm; l: string; b?: boolean; w?: boolean; ph?: string; type?: string }) => (
    <label className={`fl${b ? ' b' : ''}${w ? ' w' : ''}`}>
      <span>{l}</span>
      <input name={k} defaultValue={(d?.[k] as string | null) ?? ''} placeholder={ph} type={type} />
    </label>
  );
  return (
    <form className="card firmcard" action={action}>
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="hd">
        <h2>{d ? 'Промена на податоци на фирмата' : 'Нова фирма'}</h2>
        <div className="row">
          <Link className="btn" href="/firmi">Излез</Link>
          <button className="btn pri" disabled={pending}>Во ред · зачувај</button>
        </div>
      </div>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="fgrid">
        <div className="fcol">
          <I k="code" l="Шифра" b />
          <I k="name" l="ИМЕ (целосен назив)" b w ph="на пр. БАЈРАМИ ГРОУП ДООЕЛ" />
          <label className="fl b w"><span>Правна форма / вид</span>
            <select name="legalForm" defaultValue={d?.legalForm ?? 'dooel'}>{LF.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
          </label>
          <I k="address" l="Адреса" w />
          <I k="city" l="Град" />
          <I k="phone" l="Телефон" />
          <I k="embs" l="Матичен број" />
          <I k="edb" l="Даночен број" ph="MK4030…" />
          <I k="activity" l="Шифра на дејност" ph="на пр. 69.20" />
          <I k="email" l="Е-маил" type="email" />
        </div>
        <div className="fcol side">
          <fieldset className="fs"><legend>ДДВ и години</legend>
            <label className="chk"><input type="checkbox" name="vatRegistered" defaultChecked={d?.vatRegistered ?? true} /> Регистрирана за ДДВ</label>
            <label className="fl"><span>Даночен период</span>
              <select name="vatPeriod" defaultValue={d?.vatPeriod ?? 'quarter'}>
                <option value="quarter">Тримесечен (≤ 25 мил.)</option>
                <option value="month">Месечен (&gt; 25 мил.)</option>
              </select>
            </label>
            <label className="fl"><span>Заклучено до</span><input name="lockDate" type="date" defaultValue={d?.lockDate ?? ''} /></label>
          </fieldset>
        </div>
      </div>
    </form>
  );
}
