'use client';
/** Editor of a патен налог: header, departure / return, vehicle, countries with border crossings (abroad), costs, advance. */
import { useState } from 'react';
import { ActionForm, Submit } from '@/components/action-form';
import { BT_COST_KINDS, BT_REDUCTIONS, BT_STATUS, BT_VEHICLES, type BtCost, type BusinessTrip } from '@wise/core/btrip';
import { saveBtripAction } from './actions';

type Seg = { c: string; in: string; out: string; units?: number | string | null };
const CUR = ['MKD', 'EUR', 'USD', 'CHF', 'GBP'];

export function TripForm({ id, t, employees, countries, ed }: {
  id: string;
  t: BusinessTrip;
  employees: { id: string; name: string; position: string | null }[];
  countries: { c: string; n: string; amt: number; cur: string }[];
  ed: boolean;
}) {
  const [abroad, setAbroad] = useState(t.abroad);
  const [vehicle, setVehicle] = useState(t.vehicle);
  const [segs, setSegs] = useState<Seg[]>(t.segs ?? []);
  const [costs, setCosts] = useState<BtCost[]>(t.costs?.length ? t.costs : []);
  const setSeg = (i: number, k: keyof Seg, v: string) => setSegs(segs.map((g, j) => (j === i ? { ...g, [k]: v } : g)));
  const setCost = (i: number, k: keyof BtCost, v: string) => setCosts(costs.map((c, j) => (j === i ? { ...c, [k]: v } as BtCost : c)));
  const done = t.status === 'done';
  return (
    <ActionForm action={saveBtripAction} reset={false}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="segs" value={JSON.stringify(abroad ? segs : [])} />
      <input type="hidden" name="costs" value={JSON.stringify(costs)} />
      <fieldset disabled={!ed || done} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="f">Број<input name="number" defaultValue={t.number} placeholder="автоматски" style={{ width: 100 }} /></label>
          <label className="f">Датум на налогот<input type="date" name="date" defaultValue={t.date} required /></label>
          <label className="f">Вработен<select name="employeeId" defaultValue={t.employeeId} required>
            <option value="">— изберете —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.position ? ` · ${e.position}` : ''}</option>)}
          </select></label>
          <label className="f">Вид<select name="abroad" value={abroad ? '1' : '0'} onChange={(e) => setAbroad(e.target.value === '1')}>
            <option value="0">🇲🇰 Во земјата</option><option value="1">🌍 Во странство</option>
          </select></label>
          {abroad && <label className="f">Држава<select name="country" defaultValue={t.country}>
            <option value="">—</option>{countries.map((c) => <option key={c.c} value={c.c}>{c.n} ({c.amt} {c.cur})</option>)}
          </select></label>}
          <label className="f">Дестинација (место)<input name="dest" defaultValue={t.dest} required style={{ width: 180 }} /></label>
        </div>
        <label className="f">Цел на патувањето<input name="purpose" defaultValue={t.purpose} required style={{ width: '100%' }} /></label>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="f">Поаѓање<input type="datetime-local" name="dep" defaultValue={t.dep} required /></label>
          <label className="f">Враќање<input type="datetime-local" name="ret" defaultValue={t.ret} required /></label>
          <label className="f">Превоз<select name="vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value as BusinessTrip['vehicle'])}>
            {BT_VEHICLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
          {(vehicle === 'own' || vehicle === 'company') && <label className="f">Регистрација<input name="plate" defaultValue={t.plate ?? ''} style={{ width: 120 }} /></label>}
          {(vehicle === 'own' || vehicle === 'company') && <label className="f">Километри<input name="km" inputMode="decimal" defaultValue={t.km ?? ''} style={{ width: 90 }} /></label>}
          <label className="f">Дневница<select name="red" defaultValue={String(t.red ?? 100)}>
            {BT_REDUCTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
        </div>
        {abroad && (
          <div style={{ margin: '8px 0' }}>
            <b>Држави и премини на граница</b> <small className="note">(празно = целото време во избраната држава; „Македонија“ = време во земјата по домашна дневница)</small>
            <table className="dense"><thead><tr><th>Држава</th><th>Влез</th><th>Излез</th><th>Дневници (рачно)</th><th /></tr></thead>
              <tbody>{segs.map((g, i) => (
                <tr key={i}>
                  <td><select value={g.c} onChange={(e) => setSeg(i, 'c', e.target.value)}><option value="MK">Македонија</option>{countries.map((c) => <option key={c.c} value={c.c}>{c.n}</option>)}</select></td>
                  <td><input type="datetime-local" value={g.in} onChange={(e) => setSeg(i, 'in', e.target.value)} /></td>
                  <td><input type="datetime-local" value={g.out} onChange={(e) => setSeg(i, 'out', e.target.value)} /></td>
                  <td><input value={g.units ?? ''} onChange={(e) => setSeg(i, 'units', e.target.value)} placeholder="авто" style={{ width: 70 }} /></td>
                  <td><button type="button" className="btn sm ghost" onClick={() => setSegs(segs.filter((_, j) => j !== i))}>✕</button></td>
                </tr>))}</tbody></table>
            <button type="button" className="btn sm" onClick={() => { const last = segs[segs.length - 1]; setSegs([...segs, { c: (document.querySelector('select[name=country]') as HTMLSelectElement | null)?.value || 'MK', in: last?.out ?? '', out: '' }]); }}>+ Држава</button>
          </div>
        )}
        <div style={{ margin: '8px 0' }}>
          <b>Трошоци</b> <small className="note">(според сметки; во девизи се пресметуваат по средниот курс на НБРМ на денот на враќање)</small>
          <table className="dense"><thead><tr><th>Вид</th><th>Опис / документ</th><th>Износ</th><th>Валута</th><th /></tr></thead>
            <tbody>{costs.map((c, i) => (
              <tr key={i}>
                <td><select value={c.k} onChange={(e) => setCost(i, 'k', e.target.value)}>{BT_COST_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                <td><input value={c.d} onChange={(e) => setCost(i, 'd', e.target.value)} style={{ width: 220 }} /></td>
                <td><input value={String(c.amt)} inputMode="decimal" onChange={(e) => setCost(i, 'amt', e.target.value)} style={{ width: 100 }} /></td>
                <td><select value={c.cur} onChange={(e) => setCost(i, 'cur', e.target.value)}>{CUR.map((x) => <option key={x}>{x}</option>)}</select></td>
                <td><button type="button" className="btn sm ghost" onClick={() => setCosts(costs.filter((_, j) => j !== i))}>✕</button></td>
              </tr>))}</tbody></table>
          <button type="button" className="btn sm" onClick={() => setCosts([...costs, { k: 'transport', d: '', amt: '', cur: abroad ? 'EUR' : 'MKD' }])}>+ Трошок</button>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="f">Аконтација<input name="advance" inputMode="decimal" defaultValue={t.advance ?? ''} style={{ width: 110 }} /></label>
          <label className="f">Валута<select name="advCur" defaultValue={t.advCur ?? 'MKD'}>{CUR.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="f">Исплатена на<input type="date" name="advDate" defaultValue={t.advDate ?? ''} /></label>
          <label className="f">Налогот го издал / одобрил<input name="approver" defaultValue={t.approver ?? ''} style={{ width: 200 }} /></label>
          <label className="f">Статус<select name="status" defaultValue={t.status === 'cancel' ? 'cancel' : 'open'}>
            <option value="open">{BT_STATUS.open[0]}</option><option value="cancel">{BT_STATUS.cancel[0]}</option>
          </select></label>
        </div>
        <label className="f">Извештај од патувањето<textarea name="report" defaultValue={t.report ?? ''} rows={2} style={{ width: '100%' }} /></label>
        <label className="f">Белешка<input name="note" defaultValue={t.note ?? ''} style={{ width: '100%' }} /></label>
        {ed && !done && <div className="row" style={{ gap: 8, marginTop: 8 }}><Submit>💾 Зачувај и пресметај</Submit></div>}
      </fieldset>
      {done && <p className="note">Налогот е книжен – за измени прво „Откнижи“.</p>}
    </ActionForm>
  );
}
