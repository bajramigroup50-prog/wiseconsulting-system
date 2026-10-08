'use client';
/** Partner editor — fields of legacy `VIEWS.partneri0` 6819 (`simpleList` form). */
import Link from 'next/link';
import { useActionState } from 'react';
import type { Partner } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { savePartner } from './actions';

const F: [keyof Partner, string, string?][] = [
  ['code', 'Шифра'], ['name', 'Назив'], ['edb', 'ЕДБ'], ['embs', 'ЕМБС'], ['address', 'Адреса'], ['city', 'Град'],
  ['country', 'Држава'], ['email', 'Е-пошта', 'email'], ['phone', 'Телефон (WhatsApp/Viber)'], ['contact', 'Лице за контакт'],
  ['bankAccount', 'Жиро сметка'], ['bankName', 'Банка'],
];

export function PartnerForm({ p, nextCode, used }: { p: Partner | null; nextCode: string; used: number }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(savePartner, {});
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
      <div className="row">
        {p && used > 0 && <span className="note">🔒 Користен во {used} ставки – не може да се избрише (може да се одбележи како неактивен).</span>}
        <Link className="btn" href="/partneri">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
