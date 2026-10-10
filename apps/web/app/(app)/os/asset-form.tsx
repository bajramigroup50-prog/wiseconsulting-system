'use client';
/** Legacy asset editor 8631–8655: preset → konto + rate, konto from the chart (01x, not 0190), vehicle block. */
import Link from 'next/link';
import { useState } from 'react';
import { OS_VEH } from '@wise/core/yearend/assets-io';
import { ActionForm } from '@/components/yearend/action-form';
import { saveAsset } from './actions';

export interface AssetEd {
  id: string; invNo: string | null; name: string; konto: string; rate: string; date: string; cost: string; disposed: string | null;
  serial: string | null; barcode: string | null; supplier: string | null; invDoc: string | null; location: string | null; note: string | null;
  vehicleOnly: boolean; data: Record<string, unknown>;
}

export function AssetForm({ a, presets, kontos, suppliers, nextInv }: {
  a: AssetEd | null; presets: readonly (readonly [string, string, number])[]; kontos: { code: string; name: string }[]; suppliers: string[]; nextInv: string;
}) {
  const [konto, setKonto] = useState(a?.konto ?? '0120');
  const [rate, setRate] = useState(a ? String(Number(a.rate)) : '10');
  const D = (a?.data ?? {}) as Record<string, unknown>;
  const [veh, setVeh] = useState(!!(D.veh || D.plate));
  const K = kontos.some((k) => k.code === konto) ? kontos : [{ code: konto, name: '' }, ...kontos];
  return (
    <ActionForm action={saveAsset} submit="Зачувај">
      {a && <input type="hidden" name="id" value={a.id} />}
      <h2>{a ? 'Измена: ' + a.name : 'Ново основно средство'}</h2>
      <div className="form">
        <label className="f">Назив<input name="name" defaultValue={a?.name ?? ''} required autoFocus /></label>
        <label className="f">Инвентарен број<input name="invNo" defaultValue={a?.invNo ?? nextInv} /></label>
        <label className="f">Сериски број / шасија (VIN)<input name="serial" defaultValue={a?.serial ?? ''} /></label>
        <label className="f">Баркод<input name="barcode" defaultValue={a?.barcode ?? ''} /></label>
        <label className="f">Вид (предлог)
          <select value="" onChange={(e) => { const p = presets.find((x) => x[0] === e.target.value); if (p) { setKonto(p[0]); setRate(String(p[2])); } }}>
            <option value="">— избери за конто и стапка —</option>
            {presets.map(([k, n, r]) => <option key={k + n} value={k}>{n} – {r}%</option>)}
          </select>
        </label>
        <label className="f">Конто (група)<select name="konto" value={konto} onChange={(e) => setKonto(e.target.value)}>{K.map((k) => <option key={k.code} value={k.code}>{k.code} {k.name}</option>)}</select></label>
        <label className="f">Стапка на амортизација %<input name="rate" type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} required /></label>
        <label className="f">Датум на набавка<input name="date" type="date" defaultValue={a?.date ?? ''} required /></label>
        <label className="f">Набавна вредност<input name="cost" type="number" step="0.01" defaultValue={a ? Number(a.cost) : ''} required /></label>
        <label className="f">Добавувач<input name="supplier" list="osSup" defaultValue={a?.supplier ?? ''} /><datalist id="osSup">{suppliers.map((s) => <option key={s} value={s} />)}</datalist></label>
        <label className="f">Фактура за набавка<input name="invDoc" defaultValue={a?.invDoc ?? ''} /></label>
        <label className="f">Локација / задолжено лице<input name="location" defaultValue={a?.location ?? ''} /></label>
        <label className="f">Датум на отпис / продажба<input name="disposed" type="date" defaultValue={a?.disposed ?? ''} /></label>
        <label className="f">Белешка<input name="note" defaultValue={a?.note ?? ''} /></label>
        <label className="chk"><input type="checkbox" name="vehicleOnly" defaultChecked={a?.vehicleOnly ?? false} /> Само евиденција (возило од флота, не е сопствено – не се амортизира)</label>
        <label className="chk"><input type="checkbox" name="veh" checked={veh} onChange={(e) => setVeh(e.target.checked)} /> Возило (регистрација, осигурување, технички преглед)</label>
      </div>
      {veh && (
        <fieldset className="fs"><legend>Возило</legend><div className="form">
          {OS_VEH.map(([k, l, t, ph]) => <label className="f" key={k}>{l}<input name={'v_' + k} type={t} step={t === 'number' ? 'any' : undefined} placeholder={ph} defaultValue={D[k] != null ? String(D[k]) : ''} /></label>)}
        </div></fieldset>
      )}
      <p className="note">Амортизацијата почнува од следниот месец по набавката, пропорционално, до набавната вредност.</p>
      <div className="row"><Link className="btn" href="/os">Откажи</Link></div>
    </ActionForm>
  );
}
