/** Legacy `VIEWS.frDok` 14603 → 14667 — лиценци и документи на возила и возачи, со истекувања (30 дена). */
import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { FR_DOC_DRIVER, FR_DOC_VEHICLE } from '@wise/core/industry';
import { employees, fleetVehicles, listDocs, type FreightDoc } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { deleteFreightDocAction, saveFreightDocAction } from '../pnalozi/actions';

export default async function FrDok({ searchParams }: { searchParams: Promise<{ ed?: string; who?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('frDok', 'Лиценци и документи');
  if (g.blocked) return g.blocked;
  const V = await db().select({ id: fleetVehicles.id, n: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.firmId, g.firm.id)).orderBy(asc(fleetVehicles.plate));
  const Dr = await db().select({ id: employees.id, n: employees.name }).from(employees).where(eq(employees.firmId, g.firm.id)).orderBy(asc(employees.name));
  const D = (await listDocs<FreightDoc>(db(), g.firm.id, 'frdoc')).sort((a, b) => String(a.data.validTo ?? '9').localeCompare(String(b.data.validTo ?? '9')));
  const days = (d: string | null | undefined) => (d ? Math.round((Date.parse(d) - Date.now()) / 864e5) : null);
  const E = sp.ed === 'new' ? { id: '', data: { who: (sp.who === 'drv' ? 'drv' : 'veh') as 'veh' | 'drv', ref: '', kind: '', no: '', validFrom: '', validTo: '', note: '' } } : D.find((x) => x.id === sp.ed);
  const name = (x: FreightDoc) => (x.who === 'drv' ? Dr : V).find((y) => y.id === x.ref)?.n ?? '';
  return (
    <>
      <Hd t="Лиценци и документи" sub="возила и возачи">
        <Link className="btn" href="/frTuri">🚛 Тури</Link>
        {g.write && <><Link className="btn" href="/frDok?ed=new&who=veh">+ Документ за возило</Link><Link className="btn pri" href="/frDok?ed=new&who=drv">+ Документ за возач</Link></>}
      </Hd>
      {E && g.write && <BankForm action={saveFreightDocAction} className="card">
        <input type="hidden" name="id" value={E.id} /><input type="hidden" name="who" value={E.data.who} />
        <div className="form">
          <label className="f">{E.data.who === 'drv' ? 'Возач' : 'Возило'}<select name="ref" defaultValue={E.data.ref}><option value="">—</option>{(E.data.who === 'drv' ? Dr : V).map((x) => <option key={x.id} value={x.id}>{x.n}</option>)}</select></label>
          <label className="f">Документ<select name="kind" defaultValue={E.data.kind}>{(E.data.who === 'drv' ? FR_DOC_DRIVER : FR_DOC_VEHICLE).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="f">Број<input name="no" defaultValue={E.data.no ?? ''} /></label>
          <label className="f">Важи од<input name="validFrom" type="date" defaultValue={E.data.validFrom ?? ''} /></label>
          <label className="f">Важи до<input name="validTo" type="date" defaultValue={E.data.validTo ?? ''} /></label>
          <label className="f wide">Забелешка<input name="note" defaultValue={E.data.note ?? ''} /></label>
        </div>
        <div className="row" style={{ gap: 8 }}><span style={{ flex: 1 }} />{E.id && <RowAction className="btn ghost" action={deleteFreightDocAction.bind(null, E.id)} confirm="Да се избрише документот?" label="Избриши" />}<Link className="btn" href="/frDok">Откажи</Link><button className="btn pri">Зачувај</button></div>
      </BankForm>}
      <div className="tw"><table><thead><tr><th>За</th><th>Возило / возач</th><th>Документ</th><th>Број</th><th>Важи од</th><th>Важи до</th><th /></tr></thead>
        <tbody>{D.map((x) => { const n = days(x.data.validTo); return (
          <tr key={x.id}><td>{x.data.who === 'drv' ? 'возач' : 'возило'}</td><td><b>{name(x.data)}</b></td><td>{x.data.kind}</td><td>{x.data.no}</td><td>{dmy(x.data.validFrom)}</td>
            <td>{x.data.validTo ? <span className={`pill ${n! < 0 ? 'bad' : n! <= 30 ? 'warn' : 'good'}`}>{dmy(x.data.validTo)}{n! < 0 ? ' истечено' : n! <= 30 ? ` за ${n} дена` : ''}</span> : ''}</td>
            <td>{g.write && <Link className="btn sm" href={`/frDok?ed=${x.id}`}>Измени</Link>}</td></tr>); })}
          {!D.length && <tr><td colSpan={7} className="note">Нема внесени документи.</td></tr>}</tbody></table></div>
    </>
  );
}
