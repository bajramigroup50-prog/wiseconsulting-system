'use client';
/**
 * Employee editor — fields of legacy `VIEWS.vraboteni` 6813 + MPIN code selects with inference from city /
 * address (legacy wrapper 14726).
 */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { MPIN_FZO, MPIN_OPS, mpFzoFrom, mpOpsFrom } from '@wise/core/payroll';
import type { Employee } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { saveEmployee } from './actions';

type K = keyof Employee;
const F: [K, string, ('number' | 'date' | 'email')?][] = [
  ['no', 'Бр.'], ['name', 'Име и презиме'], ['embg', 'ЕМБГ'], ['position', 'Работно место'], ['oe', 'Организациона единица (ОЕ)'],
  ['city', 'Град'], ['address', 'Адреса'], ['netBase', 'Основна нето плата', 'number'], ['coef', 'Коефициент', 'number'],
  ['start', 'Датум на вработување', 'date'], ['stazPrev', 'Претходен стаж (години)', 'number'], ['stazY', 'Стаж без датум (години)', 'number'],
  ['end', 'Договор до', 'date'], ['bankAcc', 'Сметка за плата'], ['bank', 'Банка'], ['email', 'Е-пошта (за пресметка на плата)', 'email'],
  ['hNorm', 'Месечен фонд часови (само скратено време, пр. 88)', 'number'], ['leaveDays', 'Годишен одмор (дена)', 'number'],
  ['m1Date', 'М1 пријава (датум)', 'date'], ['lekDate', 'Лекарски преглед (датум)', 'date'], ['bzrDate', 'Обука за БЗР (датум)', 'date'],
];

const str = (v: unknown) => (v == null ? '' : String(v));

export function EmployeeForm({ e, nextNo, positions }: { e: Employee | null; nextNo: string; positions: string[] }) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveEmployee, {});
  const [city, setCity] = useState(str(e?.city));
  const [address, setAddress] = useState(str(e?.address));
  const [ops, setOps] = useState(str(e?.mpOps));
  const [fzo, setFzo] = useState(str(e?.mpZan));
  const fill = (c: string, a: string) => {
    const txt = c.trim() || a;
    let o = ops;
    if (!o) { o = mpOpsFrom(txt); if (o) setOps(o); }
    if (!fzo) { const f = mpFzoFrom(o, txt); if (f) setFzo(f); }
  };
  return (
    <form className="card" action={action}>
      {e && <input type="hidden" name="id" value={e.id} />}
      <h2>{e ? 'Измена: ' + e.name : 'Нов вработен'}</h2>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="form">
        {F.map(([k, l, type]) => {
          if (k === 'city') return <label className="f" key={k}>{l}<input name={k} value={city} onChange={(x) => setCity(x.target.value)} onBlur={() => fill(city, address)} /></label>;
          if (k === 'address') return <label className="f" key={k}>{l}<input name={k} value={address} onChange={(x) => setAddress(x.target.value)} onBlur={() => fill(city, address)} /></label>;
          return (
            <label className="f" key={k}>{l}
              <input name={k} type={type ?? 'text'} step={type === 'number' ? 'any' : undefined} list={k === 'position' ? 'posList' : undefined}
                defaultValue={k === 'leaveDays' && !e ? '20' : k === 'coef' && !e ? '1' : str(e?.[k])}
                placeholder={k === 'no' && !e ? nextNo : undefined} required={k === 'name'} autoFocus={k === 'name'} />
            </label>
          );
        })}
        <label className="f">Вид договор
          <select name="contract" defaultValue={str(e?.contract)}><option value="">—</option><option>неопределено</option><option>определено</option></select>
        </label>
        <label className="f">МПИН 3.4ц: општина на живеење
          <select name="mpOps" value={ops} onChange={(x) => { setOps(x.target.value); if (!fzo) setFzo(mpFzoFrom(x.target.value, '')); }}>
            <option value="">— избери општина —</option>
            {MPIN_OPS.map((o) => <option key={o.code} value={o.code}>{o.code} – {o.name}</option>)}
            {ops && !MPIN_OPS.some((o) => o.code === ops) && <option value={ops}>{ops} (не е во листата)</option>}
          </select>
        </label>
        <label className="f">МПИН 3.4б: подрачна единица ФЗО (сини картони)
          <select name="mpZan" value={fzo} onChange={(x) => setFzo(x.target.value)}>
            <option value="">— стандардно од фирмата —</option>
            {MPIN_FZO.map((o) => <option key={o.code} value={o.code}>{o.code} – {o.name}</option>)}
            {fzo && !MPIN_FZO.some((o) => o.code === fzo) && <option value={fzo}>{fzo} (не е во листата)</option>}
          </select>
        </label>
        <label className="f">МПИН кол. 26: ознака
          <select name="mpC26" defaultValue={str(e?.mpC26)}><option value="">— од шаблонот (0050) —</option><option value="0050">0050 – полно работно време</option><option value="0047">0047 – скратено работно време</option></select>
        </label>
        <label className="chk"><input type="checkbox" name="active" defaultChecked={e?.active ?? true} /> Активен</label>
      </div>
      <datalist id="posList">{positions.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="row">
        <Link className="btn" href="/vraboteni">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
