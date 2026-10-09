/** Fleet list + editor shared by rent-a-car (`flota`) and transport (`pnGorivo`): one fleet for all modules. */
import Link from 'next/link';
import type { FleetVehicle } from '@wise/db';
import { dmy, fmt } from '@/lib/fmt';
import { BankForm } from './bank-form';
import { RowAction } from './row-action';
import { importFleetAction, saveVehicleAction } from '@/app/(app)/rent/actions';

export function FleetSection({ V, ed, base, write, rent }: { V: FleetVehicle[]; ed?: string; base: string; write: boolean; rent: boolean }) {
  const E = ed === 'new' ? ({ id: '', plate: '', name: '', rent, active: true, trailer: false } as Partial<FleetVehicle>) : V.find((v) => v.id === ed);
  const val = (v: unknown) => (v == null ? '' : String(v));
  return (
    <>
      {write && <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Link className="btn pri" href={`${base}?ed=new`}>+ Возило</Link>
        <RowAction className="btn" action={importFleetAction} label="⇩ Од основни средства (ОС)" />
      </div>}
      {E && write && (
        <BankForm action={saveVehicleAction} className="card">
          <input type="hidden" name="id" value={E.id} />
          <div className="form">
            <label className="f">Регистарска ознака<input name="plate" defaultValue={E.plate} /></label>
            <label className="f">Назив / модел<input name="name" defaultValue={val(E.name)} /></label>
            <label className="f">Километража<input name="odo" type="number" defaultValue={val(E.odo)} /></label>
            <label className="f">Норма гориво л/100км<input name="fuelNorm" type="number" step="any" defaultValue={val(E.fuelNorm)} /></label>
            <label className="f">Носивост кг<input name="capKg" type="number" defaultValue={val(E.capKg)} /></label>
            <label className="f">Сервис на секои км<input name="oilEvery" type="number" defaultValue={val(E.oilEvery)} /></label>
            <label className="f">Последен сервис на км<input name="oilLastKm" type="number" defaultValue={val(E.oilLastKm)} /></label>
            <label className="f">Гуми на секои км<input name="tyreEvery" type="number" defaultValue={val(E.tyreEvery)} /></label>
            <label className="f">Последни гуми на км<input name="tyreLastKm" type="number" defaultValue={val(E.tyreLastKm)} /></label>
            <label className="f">Регистрација до<input name="regExp" type="date" defaultValue={val(E.regExp)} /></label>
            <label className="f">Осигурување до<input name="insExp" type="date" defaultValue={val(E.insExp)} /></label>
            <label className="f">Технички до<input name="techExp" type="date" defaultValue={val(E.techExp)} /></label>
            <label className="chk"><input type="checkbox" name="trailer" defaultChecked={!!E.trailer} /> Приколка</label>
            <label className="chk"><input type="checkbox" name="rent" defaultChecked={!!E.rent} /> Се изнајмува (rent-a-car)</label>
            <label className="f">Класа<input name="rClass" defaultValue={val(E.rClass)} placeholder="B, C, SUV" /></label>
            <label className="f">Цена/ден со ДДВ<input name="rDay" type="number" step="any" defaultValue={val(E.rDay)} /></label>
            <label className="f">Цена/ден 7+ дена<input name="rWeek" type="number" step="any" defaultValue={val(E.rWeek)} /></label>
            <label className="f">Кауција<input name="rDep" type="number" step="any" defaultValue={val(E.rDep)} /></label>
            <label className="f">Вклучени км/ден (0 = неограничено)<input name="rKm" type="number" defaultValue={val(E.rKm)} /></label>
            <label className="f">Доп. км (ден.)<input name="rKmX" type="number" step="any" defaultValue={val(E.rKmX)} /></label>
            <label className="f">Состојба<select name="active" defaultValue={E.active === false ? 'off' : 'on'}><option value="on">активно</option><option value="off">неактивно</option></select></label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><Link className="btn" href={base}>Откажи</Link><button className="btn pri">Зачувај</button></div>
        </BankForm>
      )}
      <div className="tw"><table className="dense"><thead><tr><th>Возило</th><th>Изнајмува</th><th>Класа</th><th className="n">Цена/ден</th><th className="n">7+ дена</th><th className="n">Кауција</th><th className="n">км/ден</th><th className="n">Км</th><th>Рокови</th><th /></tr></thead>
        <tbody>{V.map((v) => (
          <tr key={v.id} style={{ opacity: v.active ? 1 : 0.55 }}><td><b>{v.plate}</b> <span className="mini">{v.name}{v.trailer ? ' · приколка' : ''}</span></td><td>{v.rent ? 'да' : ''}</td><td>{v.rClass}</td>
            <td className="n">{v.rDay ? fmt(v.rDay) : ''}</td><td className="n">{v.rWeek ? fmt(v.rWeek) : ''}</td><td className="n">{v.rDep ? fmt(v.rDep) : ''}</td><td className="n">{v.rKm ?? ''}</td><td className="n">{v.odo ?? ''}</td>
            <td className="mini">{[['рег.', v.regExp], ['осиг.', v.insExp], ['техн.', v.techExp]].filter(([, d]) => d).map(([n, d]) => `${n} ${dmy(d)}`).join(' · ')}</td>
            <td>{write && <Link className="btn sm" href={`${base}?ed=${v.id}`}>Измени</Link>}</td></tr>
        ))}{!V.length && <tr><td colSpan={10} className="note">Нема возила.</td></tr>}</tbody></table></div>
    </>
  );
}
