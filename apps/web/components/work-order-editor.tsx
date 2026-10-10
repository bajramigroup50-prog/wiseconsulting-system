'use client';
/**
 * Legacy `woEditor` (9650): work order with parts (search by code, name, OE / cross number or barcode — Enter adds,
 * stock shown, short stock in red) and labour (norm hours), live totals, next-service reminder. The state is posted
 * as JSON to `saveWorkOrderAction` / `invoiceWorkOrderAction`.
 */
import Link from 'next/link';
import { useActionState, useMemo, useRef, useState } from 'react';
import { findPartItem, LABOUR_PRESETS, partLineBase, vehicleLabel, woCalc, WO_STATUS, type WoState } from '@wise/core/industry';
import { invoiceWorkOrderAction, saveWorkOrderAction, type WorkOrderPayload } from '@/app/(app)/servis/actions';
import type { FormState } from './bank-form';

export interface WoItem { id: string; code: string | null; name: string; type: string; price: number; rate: number; oe: string | null; crossRefs: string | null; barcodes: string[]; stock: number }
export interface WoVehicle { id: string; plate: string | null; make: string | null; model: string | null; year: number | null; vin: string | null; engine: string | null; km: number | null; partnerId: string | null }

const f2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

export function WorkOrderEditor({ init, state, vehicles, partners, mechanics, goods, services, hourPrice, intervalKm, history, readOnly, invoice }: {
  init: WorkOrderPayload; state: WoState; vehicles: WoVehicle[]; partners: { id: string; name: string }[]; mechanics: { id: string; name: string }[];
  goods: WoItem[]; services: WoItem[]; hourPrice: number; intervalKm: number; history: { date: string; text: string }[]; readOnly: boolean;
  invoice: { id: string; number: string } | null;
}) {
  const [E, setE] = useState<WorkOrderPayload>(init);
  const [pq, setPq] = useState('');
  const [pQty, setPQty] = useState('1');
  const [ln, setLn] = useState('');
  const [lh, setLh] = useState('1');
  const [lp, setLp] = useState(String(hourPrice));
  const [msg, setMsg] = useState('');
  const [saveSt, save, saving] = useActionState<FormState, FormData>(saveWorkOrderAction, {});
  const [invSt, inv, invoicing] = useActionState<FormState, FormData>(invoiceWorkOrderAction, {});
  const partRef = useRef<HTMLInputElement>(null);
  const v = vehicles.find((x) => x.id === E.vehicleId);
  const c = useMemo(() => woCalc(E), [E]);
  const set = (p: Partial<WorkOrderPayload>) => setE((x) => ({ ...x, ...p }));
  const ro = readOnly;
  const busy = saving || invoicing;

  const addPart = () => {
    const it = findPartItem(goods, pq);
    if (!it) { setMsg('Делот не е најден – внесете го во артикли или пребарајте во „🔩 Делови“.'); return; }
    const q = Number(pQty.replace(',', '.')) || 1;
    setE((x) => {
      const parts = [...x.parts];
      const i = parts.findIndex((p) => p.itemId === it.id);
      if (i >= 0) parts[i] = { ...parts[i]!, qty: Number(parts[i]!.qty) + q };
      else parts.push({ itemId: it.id, name: it.name, qty: q, price: it.price, disc: 0, rate: it.rate || 18 });
      return { ...x, parts };
    });
    setPq(''); setMsg('');
    setTimeout(() => partRef.current?.focus(), 30);
  };
  const addLabour = () => {
    const n = ln.trim();
    if (!n) { setMsg('Внесете опис на работата.'); return; }
    const sv = services.find((i) => i.name === n);
    set({ labour: [...E.labour, { name: n, itemId: sv?.id ?? null, hrs: Number(lh.replace(',', '.')) || 1, price: sv ? sv.price : Number(lp.replace(',', '.')) || 0, rate: sv ? sv.rate || 18 : 18 }] });
    setLn(''); setMsg('');
  };
  const setPart = (i: number, k: 'qty' | 'price' | 'disc', val: string) => set({ parts: E.parts.map((p, j) => (j === i ? { ...p, [k]: Number(val.replace(',', '.')) || 0 } : p)) });
  const setLab = (i: number, k: 'name' | 'hrs' | 'price', val: string) => set({ labour: E.labour.map((l, j) => (j === i ? { ...l, [k]: k === 'name' ? val : Number(val.replace(',', '.')) || 0 } : l)) });
  const onVehicle = (id: string) => {
    const nv = vehicles.find((x) => x.id === id);
    set({ vehicleId: id, partnerId: nv?.partnerId || E.partnerId });
  };
  const payload = JSON.stringify(E);
  const st = WO_STATUS[state];

  return (
    <>
      {(saveSt.error || invSt.error || msg) && <div className="callout bad" role="alert">{saveSt.error || invSt.error || msg}</div>}
      {saveSt.ok && <div className="callout good" role="status">{saveSt.ok}</div>}
      <div className="card"><div className="form">
        <label className="f">Број<input value={E.number} onChange={(e) => set({ number: e.target.value })} disabled={ro} /></label>
        <label className="f">Датум<input type="date" value={E.date} onChange={(e) => set({ date: e.target.value })} disabled={ro} /></label>
        <label className="f">Возило<select value={E.vehicleId} onChange={(e) => onVehicle(e.target.value)} disabled={ro}>
          <option value="">— избери —</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}</select></label>
        <label className="f">Сопственик / плаќа<select value={E.partnerId} onChange={(e) => set({ partnerId: e.target.value })} disabled={ro}>
          <option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="f">Км на возилото<input type="number" value={E.km} placeholder={v?.km ? String(v.km) : ''} disabled={ro}
          onChange={(e) => set({ km: e.target.value })}
          onBlur={(e) => { if (!E.nextKm && Number(e.target.value)) set({ nextKm: String(Number(e.target.value) + intervalKm) }); }} /></label>
        <label className="f">Механичар<select value={E.mechanicId} onChange={(e) => set({ mechanicId: e.target.value })} disabled={ro}>
          <option value="">—</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="f">Статус<select value={E.status} onChange={(e) => set({ status: e.target.value as WorkOrderPayload['status'] })} disabled={ro}>
          <option value="open">примен</option><option value="work">во работа</option><option value="done">завршен</option></select></label>
        <label className="f wide">Опис на дефект / барање на клиентот<input value={E.complaint} onChange={(e) => set({ complaint: e.target.value })} disabled={ro} /></label>
        <label className="f wide">Извршена работа / дијагноза<input value={E.work} onChange={(e) => set({ work: e.target.value })} disabled={ro} /></label>
      </div>
      {!ro && <div className="mini" style={{ marginTop: 6 }}><Link href="/vozila?ed=new&back=servis">+ Ново возило…</Link></div>}
      {v && <div className="mini" style={{ marginTop: 6 }}>🚘 {vehicleLabel(v)}{v.vin ? ' · VIN ' + v.vin : ''}{v.engine ? ' · ' + v.engine : ''}{v.km ? ` · последно ${fq(v.km)} км` : ''}
        {history.length > 0 && <> · <b>претходни:</b> {history.map((x) => `${x.date.split('-').reverse().join('.')} ${x.text}`).join('; ')}</>}</div>}
      </div>

      <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Делови и материјал</h2>
        {E.parts.length > 0 && <table className="dense"><thead><tr><th>Шифра</th><th>Дел</th><th className="n">Кол.</th><th className="n">Цена без ДДВ</th><th className="n">Рабат %</th><th className="n">ДДВ</th><th className="n">Залиха</th><th className="n">Износ</th><th /></tr></thead>
          <tbody>{E.parts.map((p, i) => {
            const it = p.itemId ? goods.find((g) => g.id === p.itemId) : null;
            const sq = it ? it.stock : null;
            return (
              <tr key={i}><td>{it?.code ?? ''}</td><td>{p.name}</td>
                <td className="n"><input type="number" step="any" value={p.qty} style={{ width: 70 }} disabled={ro} onChange={(e) => setPart(i, 'qty', e.target.value)} /></td>
                <td className="n"><input type="number" step="any" value={p.price} style={{ width: 100 }} disabled={ro} onChange={(e) => setPart(i, 'price', e.target.value)} /></td>
                <td className="n"><input type="number" step="any" value={p.disc ?? ''} style={{ width: 60 }} disabled={ro} onChange={(e) => setPart(i, 'disc', e.target.value)} /></td>
                <td className="n">{p.rate}%</td>
                <td className="n" style={sq != null && sq < Number(p.qty) ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{sq != null ? fq(sq) : ''}</td>
                <td className="n">{f2(partLineBase(p))}</td>
                <td>{!ro && <button type="button" className="btn sm ghost" onClick={() => set({ parts: E.parts.filter((_, j) => j !== i) })}>✕</button>}</td></tr>);
          })}</tbody></table>}
        {!ro && <div className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6, flexWrap: 'wrap' }}>
          <label className="f">Дел (шифра, назив, OE, баркод)<input ref={partRef} list="wp_l" style={{ width: 320 }} placeholder="🔍 скенирај или пребарај" value={pq}
            onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPart(); } }} /></label>
          <datalist id="wp_l">{goods.slice(0, 3000).map((i) => <option key={i.id} value={(i.code ? i.code + ' · ' : '') + i.name}>{(i.oe ? 'OE ' + i.oe + ' · ' : '') + 'залиха ' + fq(i.stock)}</option>)}</datalist>
          <label className="f">Кол.<input type="number" value={pQty} onChange={(e) => setPQty(e.target.value)} style={{ width: 70 }} /></label>
          <button type="button" className="btn sm" onClick={addPart}>+ Додај дел</button>
          <Link className="btn sm ghost" href={`/delovi?veh=${E.vehicleId}${E.id ? '&wo=' + E.id : ''}`}>🔩 Пребарување по возило</Link>
        </div>}
      </div>

      <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Работа (норма-часови)</h2>
        {E.labour.length > 0 && <table className="dense"><thead><tr><th>Опис</th><th className="n">Часови</th><th className="n">Цена/час без ДДВ</th><th className="n">ДДВ</th><th className="n">Износ</th><th /></tr></thead>
          <tbody>{E.labour.map((l, i) => (
            <tr key={i}><td><input value={l.name} disabled={ro} onChange={(e) => setLab(i, 'name', e.target.value)} /></td>
              <td className="n"><input type="number" step="any" value={l.hrs} style={{ width: 70 }} disabled={ro} onChange={(e) => setLab(i, 'hrs', e.target.value)} /></td>
              <td className="n"><input type="number" step="any" value={l.price} style={{ width: 100 }} disabled={ro} onChange={(e) => setLab(i, 'price', e.target.value)} /></td>
              <td className="n">{l.rate}%</td><td className="n">{f2(Number(l.hrs) * Number(l.price))}</td>
              <td>{!ro && <button type="button" className="btn sm ghost" onClick={() => set({ labour: E.labour.filter((_, j) => j !== i) })}>✕</button>}</td></tr>))}</tbody></table>}
        {!ro && <div className="row" style={{ gap: 6, alignItems: 'end', marginTop: 6, flexWrap: 'wrap' }}>
          <label className="f">Опис на работа<input list="wl_l" style={{ width: 280 }} placeholder="Замена масло и филтри" value={ln} onChange={(e) => setLn(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabour(); } }} /></label>
          <datalist id="wl_l">{services.map((i) => <option key={i.id} value={i.name} />)}{LABOUR_PRESETS.map((x) => <option key={x} value={x} />)}</datalist>
          <label className="f">Часови<input type="number" step="any" value={lh} onChange={(e) => setLh(e.target.value)} style={{ width: 70 }} /></label>
          <label className="f">Цена/час<input type="number" step="any" value={lp} onChange={(e) => setLp(e.target.value)} style={{ width: 100 }} /></label>
          <button type="button" className="btn sm" onClick={addLabour}>+ Додај работа</button>
        </div>}
      </div>

      <div className="card"><div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <table className="dense" style={{ maxWidth: 380 }}><tbody>
          <tr><td>Делови без ДДВ</td><td className="n">{f2(c.pb)}</td></tr><tr><td>Работа без ДДВ</td><td className="n">{f2(c.lb)}</td></tr>
          <tr><td>ДДВ</td><td className="n">{f2(c.vat)}</td></tr><tr><td><b>Вкупно</b></td><td className="n"><b>{f2(c.tot)}</b></td></tr></tbody></table>
        <div><b className="mini">Следен сервис (потсетник)</b><div className="form">
          <label className="f">На км<input type="number" value={E.nextKm} placeholder={Number(E.km) ? String(Number(E.km) + intervalKm) : ''} disabled={ro} onChange={(e) => set({ nextKm: e.target.value })} /></label>
          <label className="f">Или датум<input type="date" value={E.nextDate} disabled={ro} onChange={(e) => set({ nextDate: e.target.value })} /></label>
          <label className="f">Што<input value={E.nextNote} disabled={ro} onChange={(e) => set({ nextNote: e.target.value })} /></label>
        </div></div>
      </div></div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`pill ${st[1]}`}>{st[0]}</span><span style={{ flex: 1 }} />
        <Link className="btn" href="/servis">Затвори</Link>
        {invoice ? <Link className="pill good" href={`/print/doc/${invoice.id}`} target="_blank">Фактура {invoice.number}</Link> : !ro && <>
          <form action={save}><input type="hidden" name="payload" value={payload} /><input type="hidden" name="then" value="stay" /><button className="btn" disabled={busy}>Зачувај и остани</button></form>
          <form action={save}><input type="hidden" name="payload" value={payload} /><button className="btn pri" disabled={busy}>Зачувај</button></form>
          <form action={inv} onSubmit={(e) => { if (!E.parts.length && !E.labour.length) { e.preventDefault(); setMsg('Нема делови ни работа.'); } }} className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="hidden" name="payload" value={payload} />
            {E.parts.some((p) => { const it = goods.find((g) => g.id === p.itemId); return it && it.type !== 'service' && it.stock < Number(p.qty); }) &&
              <label className="chk" style={{ margin: 0 }}><input type="checkbox" name="force" /> Нема доволно залиха – сепак фактурирај</label>}
            <button className="btn pri" disabled={busy}>🧾 Фактура (раздолжи делови)</button>
          </form>
        </>}
      </div>
    </>
  );
}
