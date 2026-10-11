/**
 * Legacy `VIEWS.vozila` 9696 — Возила на клиенти: search by plate / VIN / make / owner, editor (plate, VIN, make,
 * model, year, engine, fuel, owner, km) with the VIN-length confirm and the duplicate plate / VIN check, service
 * history of the selected vehicle. Legacy `digBar` tools of this view: „⬇ Извоз“ (Excel / PDF), „🪪 Сообраќајна“
 * (AI read of the registration certificate → prefilled form) and „Возила од Excel“ (import with template).
 */
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import {
  autoImportNorm, VEHICLE_FUELS, VEHICLE_IMPORT_TEMPLATE, VEHICLE_MAKES, vehicleExportRows, vehicleHistoryRows, vehicleLabel, vehicleMatches, vregToVehicle, woCalc,
} from '@wise/core/industry';
import { workOrders } from '@wise/db';
import { loadAiResult } from '@/lib/ai';
import { customerVehicleList } from '@/lib/auto';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { Hd } from '@/components/hd';
import { ExportXlsx, ListPdf, XlsxImport } from '@/components/list-tools';
import { VehicleForm } from '@/components/vehicle-form';
import { VregScan } from '@/components/vreg-scan';
import { importCustomerVehiclesAction, saveCustomerVehicleAction } from '../servis/actions';

const fq = (v: number) => v.toLocaleString('de-DE');
const UUID = /^[0-9a-f-]{36}$/i;

export default async function Vozila({ searchParams }: { searchParams: Promise<{ q?: string; ed?: string; sel?: string; back?: string; wo?: string; vreg?: string }> }) {
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
  const L = q ? V.filter((v) => vehicleMatches(v, pn(v.partnerId), q)) : V;
  const blank = { id: '', plate: '', vin: '', make: '', model: '', year: null as number | null, engine: '', fuel: '', partnerId: null as string | null, km: null as number | null, note: '' };
  let E = sp.ed === 'new' ? blank : V.find((v) => v.id === sp.ed);
  // legacy `digApply` for `vreg`: the read certificate prefills the form; owner by name, else noted
  let vregNote = '';
  const ai = sp.ed === 'new' && sp.vreg ? await loadAiResult(firm.id, sp.vreg, 'vreg') : null;
  if (ai) {
    const r = vregToVehicle(ai.result);
    const own = r.owner ? P.find((p) => autoImportNorm(p.name) === autoImportNorm(r.owner)) : undefined;
    E = { ...blank, plate: r.plate, vin: r.vin, make: r.make, model: r.model, year: r.year, engine: r.engine, fuel: r.fuel, partnerId: own?.id ?? null, note: own || !r.owner ? '' : 'Сопственик: ' + r.owner };
    vregNote = 'Проверете ги податоците и зачувајте го возилото.';
  }
  const sel = V.find((v) => v.id === sp.sel);
  const s = (x: unknown) => (x == null ? '' : String(x));
  const back = sp.back === 'servis' ? 'servis' : '';
  const wo = sp.wo && (sp.wo === 'new' || UUID.test(sp.wo)) ? sp.wo : 'new';
  const backQs = back ? `back=servis&wo=${wo}` : '';
  const svc = (id: string) => W.filter((w) => w.vehicleId === id);
  const selW = sel ? svc(sel.id) : [];
  const fuels: readonly string[] = E?.fuel && !(VEHICLE_FUELS as readonly string[]).includes(E.fuel) ? [...VEHICLE_FUELS, E.fuel] : VEHICLE_FUELS;
  return (
    <>
      <Hd t="Возила на клиенти" sub={`${V.length} возила`}>
        <Link className="btn" href="/servis">🔧 Работни налози</Link>
        <ExportXlsx name="Vozila_na_klienti" rows={vehicleExportRows(L, (v) => pn(v.partnerId), (v) => { const H = svc(v.id); return { n: H.length, last: H[0]?.date ?? null }; })} />
        <ListPdf target="cv_list" title="Возила на клиенти" landscape />
        {g.write && <VregScan firmId={firm.id} back={backQs} />}
        {g.write && <Link className="btn pri" href={`/vozila?ed=new${backQs ? '&' + backQs : ''}`}>+ Возило</Link>}
      </Hd>
      {g.write && <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <XlsxImport action={importCustomerVehiclesAction} template={VEHICLE_IMPORT_TEMPLATE} templateName="Obrazec_Vozila.xlsx" label="📥 Возила од Excel"
          note="Колоните се препознаваат и по назив на македонски, албански или англиски – не мора да се во ист редослед." />
      </div>}
      {E && g.write && (
        <VehicleForm action={saveCustomerVehicleAction} className="card">
          <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{E.id ? 'Измени возило' : 'Ново возило'}</h2>
          {vregNote && <div className="callout warn">{vregNote}</div>}
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="back" value={back} /><input type="hidden" name="wo" value={back ? wo : ''} />
          {ai && <input type="hidden" name="vreg" value={ai.id} />}
          <div className="form">
            <label className="f">Регистарска таблица<input name="plate" defaultValue={s(E.plate)} placeholder="SK-1234-AB" /></label>
            <label className="f">VIN (број на шасија)<input name="vin" defaultValue={s(E.vin)} maxLength={17} /></label>
            <label className="f">Марка<input name="make" defaultValue={s(E.make)} list="cv_mkl" /></label>
            <datalist id="cv_mkl">{VEHICLE_MAKES.map((x) => <option key={x} value={x} />)}</datalist>
            <label className="f">Модел<input name="model" defaultValue={s(E.model)} /></label>
            <label className="f">Година<input name="year" type="number" defaultValue={s(E.year)} /></label>
            <label className="f">Мотор<input name="engine" defaultValue={s(E.engine)} placeholder="1.9 TDI 77kW" /></label>
            <label className="f">Гориво<select name="fuel" defaultValue={s(E.fuel)}>{fuels.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            <label className="f">Сопственик<select name="partner" defaultValue={s(E.partnerId)}><option value="">—</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Км<input name="km" type="number" defaultValue={s(E.km)} /></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={s(E.note)} /></label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href={back ? `/servis?id=${wo}&r=1` : '/vozila'}>Откажи</Link><button className="btn pri">Зачувај</button></div>
        </VehicleForm>
      )}
      <form style={{ marginBottom: 8 }}><input name="q" placeholder="🔍 Таблица, VIN, марка, сопственик…" defaultValue={q} style={{ width: 320 }} /></form>
      <div className="tw" id="cv_list"><table><thead><tr><th>Таблица</th><th>Возило</th><th>VIN</th><th>Сопственик</th><th className="n">Км</th><th className="n">Сервиси</th><th>Последен</th><th /></tr></thead>
        <tbody>{L.slice(0, 400).map((v) => { const H = svc(v.id); return (
          <tr key={v.id} style={sel?.id === v.id ? { background: 'var(--accent-soft)' } : undefined}>
            <td><Link href={`/vozila?sel=${v.id}${q ? '&q=' + encodeURIComponent(q) : ''}`}><b>{v.plate}</b></Link></td><td>{[v.make, v.model, v.year].filter(Boolean).join(' ')}</td><td className="mini">{v.vin}</td>
            <td>{pn(v.partnerId)}</td><td className="n">{v.km ? fq(v.km) : ''}</td><td className="n">{H.length}</td><td>{H[0] ? dmy(H[0].date) : ''}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{g.write && <><Link className="btn sm" href={`/vozila?ed=${v.id}`}>Измени</Link><Link className="btn sm pri" href={`/servis?id=new&veh=${v.id}`}>+ Налог</Link></>}</td></tr>); })}
          {!L.length && <tr><td colSpan={8} className="note">Нема возила.</td></tr>}</tbody></table></div>
      {sel && (
        <div className="card" id="cv_hist">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Историја: {vehicleLabel(sel)}{sel.vin ? ' · VIN ' + sel.vin : ''}</h2>
            <span className="row" style={{ gap: 6 }}>
              <ExportXlsx className="btn sm" name={`Istorija_${sel.plate ?? sel.vin ?? ''}`} rows={vehicleHistoryRows(selW)} />
              <ListPdf className="btn sm" target="cv_hist" title={`Историја: ${vehicleLabel(sel)}`} />
            </span>
          </div>
          {selW.map((w) => (
            <div key={w.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>{dmy(w.date)} · {w.km ? fq(w.km) + ' км' : ''} · {w.number}</b><span>{fmt(woCalc(w).tot)} ден. <Link className="btn sm" href={`/servis?id=${w.id}`}>Отвори</Link></span></div>
              <div className="mini">{w.complaint}{w.work ? ' → ' + w.work : ''}</div>
              <div className="mini">{w.parts.map((p) => `${p.name} ×${fq(Number(p.qty))}`).join(' · ')}{w.labour.length ? ' · работа: ' + w.labour.map((l) => l.name).join(', ') : ''}</div>
            </div>))}
          {!selW.length && <p className="note">Нема сервиси.</p>}
        </div>
      )}
    </>
  );
}
