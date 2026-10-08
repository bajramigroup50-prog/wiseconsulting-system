'use client';
/** Item editor — fields of legacy `VIEWS.artikli0` 6821 (`simpleList` form). */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import type { Item, ItemType } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { saveItem } from './actions';

/** Legacy `TYPES` 3173 and `REV_K` defaults (SCH0 revService / revGoods / revProduct). */
const TYPES: Record<ItemType, string> = { service: 'Услуга', goods: 'Стока (трговија)', material: 'Суровина / материјал', product: 'Готов производ' };
const REV_K: Record<ItemType, string> = { service: '7400', goods: '7410', material: '7410', product: '7400' };

export function ItemForm({ it, barcodes, supplierCodes, revAccounts }: {
  it: Item | null; barcodes: string[]; supplierCodes: { code: string; partner: string | null }[]; revAccounts: [string, string][];
}) {
  const [st, action, pending] = useActionState<ActionState, FormData>(saveItem, {});
  const [type, setType] = useState<ItemType>(it?.type ?? 'service');
  const [rev, setRev] = useState(it?.revenueAccount ?? REV_K[it?.type ?? 'service']);
  const T = (k: keyof Item, l: string, o: { num?: boolean; ph?: string } = {}) => (
    <label className="f">{l}<input name={k} defaultValue={(it?.[k] as string | null) ?? ''} inputMode={o.num ? 'decimal' : undefined} placeholder={o.ph} /></label>
  );
  return (
    <form className="card" action={action}>
      {it && <input type="hidden" name="id" value={it.id} />}
      <h2>{it ? 'Измена: ' + it.name : 'Нов артикл / услуга'}</h2>
      {st.error && <div className="callout bad" role="alert">{st.error}</div>}
      <div className="form">
        {T('code', 'Шифра', { ph: it ? '' : 'автоматски' })}
        <label className="f">Баркод (повеќе: одвоени со запирка)<input name="barcodes" defaultValue={barcodes.join(', ')} /></label>
        <label className="f wide">Назив<input name="name" defaultValue={it?.name ?? ''} required autoFocus /></label>
        <label className="chk"><input type="checkbox" name="madeInMk" defaultChecked={it?.madeInMk ?? false} /> Македонски производ</label>
        <label className="f">Вид
          <select name="type" value={type} onChange={(e) => { const t = e.target.value as ItemType; setType(t); setRev(REV_K[t]); }}>
            {Object.entries(TYPES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        {T('unit', 'Ед. мерка')}
        {T('price', 'Продажна цена без ДДВ', { num: true })}
        <label className="f">ДДВ %
          <select name="vatRate" defaultValue={String(it?.vatRate ?? 18)}>{[18, 10, 5, 0].map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <label className="f">Конто за приход
          <input name="revenueAccount" list="revK" value={rev} onChange={(e) => setRev(e.target.value)} />
          <datalist id="revK">{revAccounts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</datalist>
        </label>
        {T('minStock', 'Минимална залиха', { num: true })}
        {T('weight', 'Тежина по единица (кг) – за товар на возило', { num: true })}
        {T('oe', 'OE броеви (авто делови, одвоени со запирка)')}
        {T('crossRefs', 'Замени / еквивалентни броеви')}
        {T('fits', 'Возила (на пр. VW Golf 5 2004-2008; Škoda Octavia 2)')}
        {T('rawAccount', 'Сопствено производство: раздолжи од конто (на пр. 3100)')}
        {T('costPrice', 'Себечена цена по единица (за раздолжување)', { num: true })}
        {T('costPct', 'или себечена цена како % од продажната', { num: true })}
        <label className="chk"><input type="checkbox" name="active" defaultChecked={it?.active ?? true} /> Активен</label>
      </div>
      {supplierCodes.length > 0 && (
        <p className="note">Шифри кај добавувачи: {supplierCodes.map((s) => `${s.code}${s.partner ? ' (' + s.partner + ')' : ''}`).join(', ')}</p>
      )}
      <div className="row">
        <Link className="btn" href="/artikli">Откажи</Link>
        <button className="btn pri" disabled={pending}>Зачувај</button>
      </div>
    </form>
  );
}
