/**
 * Legacy `VIEWS.potsetnici` 9735 — Потсетници за сервис: vehicles due within 30 days (by date or estimated km),
 * WhatsApp link, e-mail (queued through `mail_log`), „✓ Контактиран“ (hidden 30 days), new work order; service
 * settings (labour-hour price, standard intervals).
 */
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { reminderText, serviceReminders, waNumber } from '@wise/core/industry';
import { firmAutoConfig, partners, workOrders } from '@wise/db';
import { customerVehicleList } from '@/lib/auto';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { reminderDoneAction, reminderMailAction, saveAutoConfigAction } from '../servis/actions';

const fq = (v: number) => v.toLocaleString('de-DE');

export default async function Potsetnici() {
  const g = await industryPage('potsetnici', 'Потсетници за сервис');
  if (g.blocked) return g.blocked;
  const { firm } = g;
  const A = firmAutoConfig(firm);
  const [V, W, P] = await Promise.all([
    customerVehicleList(firm.id),
    db().select().from(workOrders).where(eq(workOrders.firmId, firm.id)),
    db().select({ id: partners.id, name: partners.name, phone: partners.phone, email: partners.email }).from(partners).where(eq(partners.firmId, firm.id)),
  ]);
  const R = serviceReminders(V, W, A, today());
  return (
    <>
      <Hd t="Потсетници за сервис" sub={`${R.length} возила`}><Link className="btn" href="/servis">🔧 Работни налози</Link></Hd>
      <div className="tw"><table><thead><tr><th>Возило</th><th>Сопственик</th><th>Контакт</th><th>Последен сервис</th><th>Зошто</th><th /></tr></thead>
        <tbody>{R.map((x) => {
          const p = P.find((y) => y.id === x.v.partnerId);
          const ph = waNumber(p?.phone);
          const msg = reminderText(x.v, x.last.nextNote, { name: firm.name, phone: firm.phone });
          return (
            <tr key={x.v.id}>
              <td><b>{x.v.plate}</b> <span className="mini">{[x.v.make, x.v.model].filter(Boolean).join(' ')}</span></td><td>{p?.name}</td>
              <td className="mini">{p?.phone}{p?.email && <><br />{p.email}</>}</td>
              <td>{dmy(x.last.date)}{x.last.km ? ` · ${fq(x.last.km)} км` : ''}<div className="mini">{x.last.nextNote}</div></td>
              <td>{x.late ? <span className="pill bad">поминат</span> : <span className="pill warn">наскоро</span>} <span className="mini">{x.why}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {ph && <a className="btn sm" href={`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                {g.write && p?.email && <RowAction className="btn sm" action={reminderMailAction.bind(null, x.v.id)} confirm={`Да се испрати потсетник на ${p.email}?`} label="✉ Е-пошта" />}
                {g.write && <RowAction className="btn sm" action={reminderDoneAction.bind(null, x.v.id)} label="✓ Контактиран" />}
                {g.write && <Link className="btn sm pri" href={`/servis?id=new&veh=${x.v.id}`}>+ Налог</Link>}
              </td>
            </tr>);
        })}
          {!R.length && <tr><td colSpan={6} className="note">Нема возила за потсетување во следните 30 дена.</td></tr>}</tbody></table></div>
      <BankForm action={saveAutoConfigAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Поставки за сервис</h2>
        <div className="form">
          <label className="f">Цена на норма-час без ДДВ<input name="hr" type="number" step="any" defaultValue={A.hr} /></label>
          <label className="f">Стандарден интервал (км)<input name="km" type="number" defaultValue={A.km} /></label>
          <label className="f">Стандарден интервал (месеци)<input name="mon" type="number" defaultValue={A.mon} /></label>
        </div>
        {g.write && <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        <p className="note">Потсетникот се појавува 30 дена пред рокот или кога проценетата километража (од темпото меѓу претходните сервиси) е 1.000 км пред следниот сервис. По „✓ Контактиран“ возилото се крие 30 дена.</p>
      </BankForm>
    </>
  );
}
