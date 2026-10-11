'use client';
/**
 * Legacy `woEditor` (9650): work order with parts (search by code, name, OE / cross number or barcode — Enter adds,
 * stock shown, short stock in red) and labour (norm hours), live totals, next-service reminder. The state is posted
 * as JSON to `saveWorkOrderAction` / `invoiceWorkOrderAction`.
 *
 * Like legacy `S.woEd`, the unsaved order survives a trip to „+ Ново возило…“ (vehicles) or „🔩 Пребарување по
 * возило“ (parts search): it is kept in `sessionStorage` and restored on return (`?r=1`), where the new vehicle
 * (`veh`) or the part chosen with „+ во налог“ (`add`, legacy `dlToWo`) is applied.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { findPartItem, LABOUR_PRESETS, partLineBase, vehicleLabel, woCalc, woShortParts, WO_STATUS, type WoState } from '@wise/core/industry';
import { invoiceWorkOrderAction, saveWorkOrderAction, type WorkOrderPayload } from '@/app/(app)/servis/actions';
import type { FormState } from './bank-form';

export interface WoItem { id: string; code: string | null; name: string; type: string; price: number; rate: number; oe: string | null; crossRefs: string | null; barcodes: string[]; stock: number }
export interface WoVehicle { id: string; plate: string | null; make: string | null; model: string | null; year: number | null; vin: string | null; engine: string | null; km: number | null; partnerId: string | null }

const f2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fq = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 3 });

const draftKey = (id: string) => 'wo-draft:' + (id || 'new');

export function WorkOrderEditor({ init, state, vehicles, partners, mechanics, goods, services, hourPrice, intervalKm, histories, readOnly, invoice, restore, vehParam, addItem }: {
  init: WorkOrderPayload; state: WoState; vehicles: WoVehicle[]; partners: { id: string; name: string }[]; mechanics: { id: string; name: string }[];
  goods: WoItem[]; services: WoItem[]; hourPrice: number; intervalKm: number; histories: Record<string, { date: string; text: string }[]>; readOnly: boolean;
  invoice: { id: string; number: string; draft: boolean } | null; restore?: boolean; vehParam?: string; addItem?: string;
}) {
  const router = useRouter();
  const [E, setE] = useState<WorkOrderPayload>(init);
  const [note, setNote] = useState('');
  const [pq, setPq] = useState('');
  const [pQty, setPQty] = useState('1');
  const [ln, setLn] = useState('');
  const [lh, setLh] = useState('1');
  const [lp, setLp] = useState(String(hourPrice));
  const [msg, setMsg] = useState('');
  const [saveSt, save, saving] = useActionState<FormState, FormData>(saveWorkOrderAction, {});
  const [invSt, inv, invoicing] = useActionState<FormState, FormData>(invoiceWorkOrderAction, {});
  const partRef = useRef<HTMLInputElement>(null);
  const forceRef = useRef<HTMLInputElement>(null);
  const v = vehicles.find((x) => x.id === E.vehicleId);
  const history = (v && histories[v.id]) || [];

  /* Return from „+ Ново возило…“ / the parts search: restore the unsaved order, then apply the new vehicle / part. */
  useEffect(() => {
    if (!restore && !vehParam && !addItem) return;
    let x: WorkOrderPayload = init;
    if (restore) {
      try {
        const raw = sessionStorage.getItem(draftKey(init.id));
        if (raw) x = { ...init, ...(JSON.parse(raw) as WorkOrderPayload), id: init.id };
        sessionStorage.removeItem(draftKey(init.id));
      } catch { /* no storage */ }
    }
    const nv = vehParam ? vehicles.find((y) => y.id === vehParam) : undefined;
    if (nv) x = { ...x, vehicleId: nv.id, partnerId: nv.partnerId || x.partnerId };
    const it = addItem ? goods.find((g) => g.id === addItem) : undefined;
    if (it) {
      const parts = [...x.parts];
      const i = parts.findIndex((p) => p.itemId === it.id);
      if (i >= 0) parts[i] = { ...parts[i]!, qty: Number(parts[i]!.qty) + 1 };
      else parts.push({ itemId: it.id, name: it.name, qty: 1, price: it.price, disc: 0, rate: it.rate || 18 });
      x = { ...x, parts };
      setNote(`Додадено во ${x.number}.`);
    }
    setE(x);
    try { window.history.replaceState(null, '', `/servis?id=${init.id || 'new'}`); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Keep the unsaved order and leave for another screen (legacy keeps `S.woEd` in memory). */
  const leave = (href: string) => {
    try { sessionStorage.setItem(draftKey(E.id), JSON.stringify(E)); } catch { /* no storage */ }
    router.push(href);
  };
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
    if (id === '__new') { leave(`/vozila?ed=new&back=servis&wo=${E.id || 'new'}`); return; }
    const nv = vehicles.find((x) => x.id === id);
    set({ vehicleId: id, partnerId: nv?.partnerId || E.partnerId });
  };
  const payload = JSON.stringify(E);
  const st = WO_STATUS[state];

  return (
    <>
      {(saveSt.error || invSt.error || msg) && <div className="callout bad" role="alert">{saveSt.error || invSt.error || msg}</div>}
      {saveSt.ok && <div className="callout good" role="status">{saveSt.ok}</div>}
      {note && <div className="callout good" role="status">{note}</div>}
      {invoice?.draft && <div className="callout warn">Фактурата {invoice.number} е нацрт – <Link href={`/izlez?edit=${invoice.id}`}>проверете ја и зачувајте</Link>; деловите се раздолжуваат од залиха кога фактурата ќе се зачува.</div>}
      <div className="card"><div className="form">
        <label className="f">Број<input value={E.number} onChange={(e) => set({ number: e.target.value })} disabled={ro} /></label>
        <label className="f">Датум<input type="date" value={E.date} onChange={(e) => set({ date: e.target.value })} disabled={ro} /></label>
        <label className="f">Возило<select value={E.vehicleId} onChange={(e) => onVehicle(e.target.value)} disabled={ro}>
          <option value="">— избери / + ново —</option>{vehicles.map((x) => <option key={x.id} value={x.id}>{vehicleLabel(x)}</option>)}<option value="__new">+ Ново возило…</option></select></label>
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
          <button type="button" className="btn sm ghost" onClick={() => leave(`/delovi?${new URLSearchParams({ ...(E.vehicleId ? { veh: E.vehicleId } : {}), wo: E.id || 'new', won: E.number }).toString()}`)}>🔩 Пребарување по возило</button>
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
        {invoice && !invoice.draft ? <Link className="pill good" href={`/print/doc/${invoice.id}`} target="_blank">Фактура {invoice.number}</Link> : !ro && <>
          {invoice?.draft && <Link className="pill warn" href={`/izlez?edit=${invoice.id}`}>Нацрт фактура {invoice.number}</Link>}
          <form action={save}><input type="hidden" name="payload" value={payload} /><input type="hidden" name="then" value="stay" /><button className="btn" disabled={busy}>Зачувај и остани</button></form>
          <form action={save}><input type="hidden" name="payload" value={payload} /><button className="btn pri" disabled={busy}>Зачувај</button></form>
          <form action={inv} onSubmit={(e) => {
            if (!E.parts.length && !E.labour.length) { e.preventDefault(); setMsg('Нема делови ни работа.'); return; }
            const short = woShortParts(E.parts, (id) => { const it = goods.find((g) => g.id === id); return it && it.type !== 'service' ? it.stock : null; });
            if (forceRef.current) forceRef.current.value = '';
            if (short.length) {
              if (!window.confirm('Нема доволно залиха за: ' + short.map((p) => p.name).join(', ') + '. Сепак да се фактурира?')) { e.preventDefault(); return; }
              if (forceRef.current) forceRef.current.value = 'on';
            }
          }}>
            <input type="hidden" name="payload" value={payload} /><input type="hidden" name="force" ref={forceRef} defaultValue="" />
            <button className="btn pri" disabled={busy}>🧾 Фактура (раздолжи делови)</button>
          </form>
        </>}
      </div>
    </>
  );
}
