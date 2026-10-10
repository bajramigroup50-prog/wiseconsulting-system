/**
 * Legacy `VIEWS.vozila` 9696 — Возила на клиенти: search by plate / VIN / make / owner, editor (plate, VIN, make,
 * model, year, engine, fuel, owner, km), service history of the selected vehicle.
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { foldText, partNorm, plateNorm, VEHICLE_FUELS, VEHICLE_MAKES, vehicleLabel, woCalc } from '@wise/core/industry';
import { workOrders } from '@wise/db';
import { customerVehicleList } from '@/lib/auto';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { saveCustomerVehicleAction } from '../servis/actions';

const fq = (v: number) => v.toLocaleString('de-DE');

export default async function Vozila({ searchParams }: { searchParams: Promise<{ q?: string; ed?: string; sel?: string; back?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('vozila', 'Возила на клиенти');
  if (g.blocked) return g.blocked;
  const { firm } = g;
  const [V, P, W] = await Promise.all([
    customerVehicleList(firm.id), partnerOptions(firm.id),
    db().select().from(workOrders).where(eq(workOrders.firmId, firm.id)).orderBy(desc(workOrders.date)),
  ]);
  const pn = (id: string | null) => P.find((p) => p.id === id)?.name ?? '';
  const q = (sp.q ?? '').trim();
  let L = V;
  if (q) {
    const n = plateNorm(q), fq0 = foldText(q);
    L = L.filter((v) => (n && plateNorm(v.plate).includes(n)) || (partNorm(q) && partNorm(v.vin).includes(partNorm(q))) || foldText([v.make, v.model, pn(v.partnerId)].join(' ')).includes(fq0));
  }
  const E = sp.ed === 'new' ? { id: '', plate: '', vin: '', make: '', model: '', year: null, engine: '', fuel: '', partnerId: null, km: null, note: '' } : V.find((v) => v.id === sp.ed);
  const sel = V.find((v) => v.id === sp.sel);
  const s = (x: unknown) => (x == null ? '' : String(x));
  const back = sp.back === 'servis' ? 'servis' : '';
  return (
    <>
      <Hd t="Возила на клиенти" sub={`${V.length} возила`}>
        <Link className="btn" href="/servis">🔧 Работни налози</Link>
        {g.write && <Link className="btn pri" href="/vozila?ed=new">+ Возило</Link>}
      </Hd>
      {E && g.write && (
        <BankForm action={saveCustomerVehicleAction} className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{E.id ? 'Измени возило' : 'Ново возило'}</h2>
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="back" value={back} />
          <div className="form">
            <label className="f">Регистарска таблица<input name="plate" defaultValue={s(E.plate)} placeholder="SK-1234-AB" /></label>
            <label className="f">VIN (број на шасија)<input name="vin" defaultValue={s(E.vin)} maxLength={17} /></label>
            <label className="f">Марка<input name="make" defaultValue={s(E.make)} list="cv_mkl" /></label>
            <datalist id="cv_mkl">{VEHICLE_MAKES.map((x) => <option key={x} value={x} />)}</datalist>
            <label className="f">Модел<input name="model" defaultValue={s(E.model)} /></label>
            <label className="f">Година<input name="year" type="number" defaultValue={s(E.year)} /></label>
            <label className="f">Мотор<input name="engine" defaultValue={s(E.engine)} placeholder="1.9 TDI 77kW" /></label>
            <label className="f">Гориво<select name="fuel" defaultValue={s(E.fuel)}>{VEHICLE_FUELS.map((x) => <option key={x} value={x}>{x || '—'}</option>)}</select></label>
            <label className="f">Сопственик<select name="partner" defaultValue={s(E.partnerId)}><option value="">—</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Км<input name="km" type="number" defaultValue={s(E.km)} /></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={s(E.note)} /></label>
          </div>
          <p className="note">VIN обично има 17 знаци.</p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href={back ? '/servis?id=new' : '/vozila'}>Откажи</Link><button className="btn pri">Зачувај</button></div>
        </BankForm>
      )}
      <form style={{ marginBottom: 8 }}><input name="q" placeholder="🔍 Таблица, VIN, марка, сопственик…" defaultValue={q} style={{ width: 320 }} /></form>
      <div className="tw"><table><thead><tr><th>Таблица</th><th>Возило</th><th>VIN</th><th>Сопственик</th><th className="n">Км</th><th className="n">Сервиси</th><th>Последен</th><th /></tr></thead>
        <tbody>{L.slice(0, 400).map((v) => { const H = W.filter((w) => w.vehicleId === v.id); return (
          <tr key={v.id} style={sel?.id === v.id ? { background: 'var(--accent-soft)' } : undefined}>
            <td><Link href={`/vozila?sel=${v.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}><b>{v.plate}</b></Link></td><td>{[v.make, v.model, v.year].filter(Boolean).join(' ')}</td><td className="mini">{v.vin}</td>
            <td>{pn(v.partnerId)}</td><td className="n">{v.km ? fq(v.km) : ''}</td><td className="n">{H.length}</td><td>{H[0] ? dmy(H[0].date) : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{g.write && <><Link className="btn sm" href={`/vozila?ed=${v.id}`}>Измени</Link><Link className="btn sm pri" href={`/servis?id=new&veh=${v.id}`}>+ Налог</Link></>}</td></tr>); })}
          {!L.length && <tr><td colSpan={8} className="note">Нема возила.</td></tr>}</tbody></table></div>
      {sel && (
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Историја: {vehicleLabel(sel)}{sel.vin ? ' · VIN ' + sel.vin : ''}</h2>
          {W.filter((w) => w.vehicleId === sel.id).map((w) => (
            <div key={w.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{dmy(w.date)} · {w.km ? fq(w.km) + ' км' : ''} · {w.number}</b><span>{fmt(woCalc(w).tot)} ден. <Link className="btn sm" href={`/servis?id=${w.id}`}>Отвори</Link></span></div>
              <div className="mini">{w.complaint}{w.work ? ' → ' + w.work : ''}</div>
              <div className="mini">{w.parts.map((p) => `${p.name} ×${fq(Number(p.qty))}`).join(' · ')}{w.labour.length ? ' · работа: ' + w.labour.map((l) => l.name).join(', ') : ''}</div>
            </div>))}
          {!W.some((w) => w.vehicleId === sel.id) && <p className="note">Нема сервиси.</p>}
        </div>
      )}
    </>
  );
}
