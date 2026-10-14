'use client';
/** Partner editor — fields of legacy `VIEWS.partneri0` 6819 (`simpleList` form) + the partner's bank accounts. */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { Partner } from '@wise/db';
import { parseAccount } from '@wise/core/bank/mk-banks';
import { partnerAccounts } from '@wise/core/bank/partner-accounts';
import type { ActionState } from '@/lib/books';
import { savePartner } from './actions';

const F: [keyof Partner, string, string?][] = [
  ['code', 'Шифра'], ['name', 'Назив'], ['edb', 'ЕДБ'], ['embs', 'ЕМБС'], ['address', 'Адреса'], ['city', 'Град'],
  ['country', 'Држава'], ['email', 'Е-пошта', 'email'], ['phone', 'Телефон (WhatsApp/Viber)'], ['contact', 'Лице за контакт'],
];

const SRC: Record<string, string> = { invoice: 'од фактура', statement: 'од извод', manual: 'рачно', import: 'увоз' };
interface Row { acc: string; bank: string; src?: string; at?: string }

export function PartnerForm({ p, nextCode, used }: { p: Partner | null; nextCode: string; used: number }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(savePartner, {});
  const init = p ? partnerAccounts(p) : [];
  const [rows, setRows] = useState<Row[]>(init.length ? init.map((a) => ({ acc: a.acc, bank: a.bank, src: a.src, at: a.at })) : [{ acc: '', bank: '' }]);
  const [def, setDef] = useState(Math.max(0, init.findIndex((a) => a.def)));
  const upd = (i: number, x: Partial<Row>) => setRows((L) => L.map((r, j) => (j === i ? { ...r, ...x } : r)));
  return (
    <form className="card" action={action}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <h2>{p ? 'Измена: ' + p.name : 'Нов комитент'}</h2>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="form">
        {F.map(([k, l, type]) => (
          <label className="f" key={k}>{l}
            <input name={k} type={type} defaultValue={(p?.[k] as string | null) ?? ''} placeholder={k === 'code' && !p ? nextCode : undefined}
              required={k === 'name'} autoFocus={k === 'name'} />
          </label>
        ))}
        <label className="chk"><input type="checkbox" name="vatRegistered" defaultChecked={p?.vatRegistered ?? true} /> ДДВ обврзник</label>
        <label className="chk"><input type="checkbox" name="foreign" defaultChecked={p?.foreign ?? false} /> Странски</label>
        <label className="chk"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Активен</label>
      </div>
      <fieldset className="fs" style={{ marginTop: 8 }}>
        <legend>🏦 Жиро сметки (за платни налози)</legend>
        <input type="hidden" name="accForm" value="1" />
        <table className="dense"><thead><tr><th>Основна</th><th>Сметка (15 цифри или IBAN)</th><th>Банка</th><th></th><th></th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const pa = r.acc.trim() ? parseAccount(r.acc) : null;
            return (
              <tr key={i}>
                <td><input type="radio" name="accDef" value={i} checked={def === i} onChange={() => setDef(i)} aria-label="Основна сметка" /></td>
                <td><input name="acc" value={r.acc} inputMode="numeric" placeholder="300-0000000000-00" aria-label="Сметка"
                  onChange={(e) => { const v = e.target.value; const x = parseAccount(v); upd(i, { acc: v, ...(x && !r.bank ? { bank: x.bank } : {}) }); }} />
                  {r.acc.trim() && <div className="mini">{pa ? '✓ ' + (pa.acc ? pa.iban : 'странски IBAN') : '⚠ невалидна (15 цифри + контролни цифри)'}</div>}</td>
                <td><input name="accBank" value={r.bank} placeholder={pa?.bank || 'назив на банка'} aria-label="Банка" onChange={(e) => upd(i, { bank: e.target.value })} /></td>
                <td className="mini">{r.src ? SRC[r.src] ?? r.src : ''}{r.at ? ' · ' + r.at.split('-').reverse().join('.') : ''}</td>
                <td><button type="button" className="btn sm ghost" aria-label="Отстрани сметка" onClick={() => { setRows((L) => L.filter((_, j) => j !== i)); setDef((d) => (d === i ? 0 : d > i ? d - 1 : d)); }}>✕</button></td>
              </tr>
            );
          })}</tbody>
        </table>
        <button type="button" className="btn sm" onClick={() => setRows((L) => [...L, { acc: '', bank: '' }])}>+ Додај сметка</button>
        <p className="note">Сметките се учат и автоматски – од жиро сметката отпечатена на прочитаните влезни фактури и од изводите (сметката на уплатувачот / примачот). Банката се препознава од првите 3 цифри.</p>
      </fieldset>
      <div className="row">
        {p && used > 0 && <span className="note">🔒 Користен во {used} ставки – не може да се избрише (може да се одбележи како неактивен).</span>}
        <Link className="btn" href="/partneri">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
