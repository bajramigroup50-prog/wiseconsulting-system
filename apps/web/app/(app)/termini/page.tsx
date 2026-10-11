/**
 * Legacy `VIEWS.termini` 10118 / `apEditor` 10125 — Термини: day grid by resource and time slot, editor (client card,
 * service, price incl. VAT), clash warning, reminders (Phase 6 mail queue), pay at the till (Phase 7 POS) or invoice.
 */
import Link from 'next/link';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { addDays, APPT_STATUS, apptClash, apptReminder, apptSlots, apptWaLink, mTime, tMin } from '@wise/core/industry';
import { appointments, employees, firmApptConfig, invoices, items } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { apptStepAction, saveApptAction, saveApptConfigAction } from './actions';

const WD = ['недела', 'понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота'];

export default async function Termini({ searchParams }: { searchParams: Promise<{ d?: string; id?: string; nov?: string; r?: string; t?: string; cfg?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('termini', 'Термини');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const C = firmApptConfig(firm);
  const R = C.res.length ? C.res : (await db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)));
  const D = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today();

  if (sp.id || sp.nov) {
    const [E0] = sp.id ? await db().select().from(appointments).where(and(eq(appointments.id, sp.id), eq(appointments.firmId, firm.id))).limit(1) : [];
    const E = E0 ?? { id: '', date: D, time: sp.t ?? C.from, dur: C.step, res: sp.r ?? R[0]?.id ?? '', partnerId: null, client: '', phone: '', email: '', svc: '', itemId: null, price: null, status: 'booked' as const, note: '', invoiceId: null, salesDayId: null, remindAt: null };
    const [P, S, day] = await Promise.all([
      partnerOptions(firm.id),
      db().select({ id: items.id, name: items.name, price: items.price, rate: items.vatRate }).from(items).where(and(eq(items.firmId, firm.id), eq(items.type, 'service'))).orderBy(asc(items.name)),
      db().select().from(appointments).where(and(eq(appointments.firmId, firm.id), eq(appointments.date, E.date))),
    ]);
    const cl = apptClash(day, E);
    const hist = E.partnerId ? await db().select().from(appointments).where(and(eq(appointments.partnerId, E.partnerId), ne(appointments.id, E.id || '00000000-0000-0000-0000-000000000000'))).orderBy(desc(appointments.date)).limit(5) : [];
    const inv = E.invoiceId ? (await db().select({ n: invoices.number }).from(invoices).where(eq(invoices.id, E.invoiceId)))[0]?.n : null;
    return (
      <>
        <Hd t={E.id ? 'Термин' : 'Нов термин'} sub={APPT_STATUS[E.status][0]}><Link className="btn" href={`/termini?d=${E.date}`}>← Термини</Link></Hd>
        {cl && <div className="callout warn">⚠ Се преклопува со термин во {cl.time}.</div>}
        <BankForm action={saveApptAction} className="card">
          <input type="hidden" name="id" value={E.id} />
          <div className="form">
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} /></label>
            <label className="f">Час<input name="time" type="time" defaultValue={E.time} /></label>
            <label className="f">Траење (мин.)<input name="dur" type="number" step={5} defaultValue={E.dur} /></label>
            <label className="f">Кај<select name="res" defaultValue={E.res}>{R.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label className="f">Клиент / пациент (картон)<select name="partner" defaultValue={E.partnerId ?? ''}><option value="">—</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">или ново име<input name="client" defaultValue={E.partnerId ? '' : E.client ?? ''} /></label>
            <label className="f">Телефон<input name="phone" defaultValue={E.phone ?? ''} /></label>
            <label className="f">Е-пошта<input name="email" defaultValue={E.email ?? ''} /></label>
            <label className="f">Услуга (артикл)<select name="item" defaultValue={E.itemId ?? ''}><option value="">—</option>{S.map((s) => <option key={s.id} value={s.id}>{s.name} · {fmt(Number(s.price ?? 0) * (1 + s.rate / 100))}</option>)}</select></label>
            <label className="f">Опис на услугата<input name="svc" defaultValue={E.svc ?? ''} /></label>
            <label className="f">Цена со ДДВ<input name="price" type="number" step="any" defaultValue={E.price ? Number(E.price) : ''} /></label>
            <label className="f">Статус<select name="status" defaultValue={E.status}>{Object.entries(APPT_STATUS).filter(([k]) => k !== 'cancel').map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
            <label className="f wide">Забелешка<input name="note" defaultValue={E.note ?? ''} /></label>
          </div>
          {hist.length > 0 && <div className="mini" style={{ marginTop: 6 }}>Претходни: {hist.map((a) => `${dmy(a.date)} ${a.svc ?? ''}`).join(' · ')}</div>}
          {write && !E.invoiceId && !E.salesDayId && <div className="row" style={{ marginTop: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </BankForm>
        {E.id && write && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span style={{ flex: 1 }} />
          {E.status !== 'cancel' && !E.invoiceId && !E.salesDayId && <RowAction className="btn ghost" action={apptStepAction.bind(null, E.id, 'cancel')} confirm="Да се откаже терминот?" label="Откажи термин" />}
          {(E.phone || E.email) && <RowAction className="btn" action={apptStepAction.bind(null, E.id, 'rem')} label={E.remindAt ? '🔔 Потсетник (повторно)' : '🔔 Потсетник'} />}
          {E.phone && <><a className="btn" href={apptWaLink(E.phone, apptReminder(E, C.res.find((y) => y.id === E.res)?.name ?? '', firm))} target="_blank" rel="noopener noreferrer">WhatsApp</a><RowAction className="btn sm ghost" action={apptStepAction.bind(null, E.id, 'remwa')} label="✓ Потсетен (WhatsApp)" /></>}
          {Number(E.price) > 0 && !E.invoiceId && !E.salesDayId && <><RowAction className="btn" action={apptStepAction.bind(null, E.id, 'till')} label="💶 Наплати на каса" /><RowAction className="btn" action={apptStepAction.bind(null, E.id, 'inv')} label="🧾 Фактура" /></>}
          {inv && <span className="pill good">Фактура {inv}</span>}{E.salesDayId && <span className="pill good">наплатено на каса</span>}
        </div>}
      </>
    );
  }

  const day = (await db().select().from(appointments).where(and(eq(appointments.firmId, firm.id), eq(appointments.date, D)))).filter((a) => a.status !== 'cancel');
  const slots = apptSlots(C);
  const tom = (await db().select().from(appointments).where(and(eq(appointments.firmId, firm.id), eq(appointments.date, addDays(today(), 1)), eq(appointments.status, 'booked')))).filter((a) => !a.remindAt);
  return (
    <>
      <Hd t="Термини" sub={`${dmy(D)} · ${WD[new Date(D + 'T12:00:00Z').getUTCDay()]}`}>
        <Link className="btn" href="/kartoni">🗂 Картони</Link>
        <Link className="btn" href={sp.cfg ? `/termini?d=${D}` : `/termini?d=${D}&cfg=1`}>⚙ Ресурси и работно време</Link>
        {write && <Link className="btn pri" href={`/termini?nov=1&d=${D}`}>+ Нов термин</Link>}
      </Hd>
      {sp.cfg && <BankForm action={saveApptConfigAction} className="card"><div className="form">
        <label className="f">Од<input name="from" type="time" defaultValue={C.from} /></label><label className="f">До<input name="to" type="time" defaultValue={C.to} /></label>
        <label className="f">Чекор (мин.)<select name="step" defaultValue={String(C.step)}>{[15, 20, 30, 60].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="f">ДДВ % за услуга без артикл<select name="rate" defaultValue={String(C.rate)}><option>18</option><option>10</option><option>5</option></select></label>
        <label className="f wide">Ресурси (лекари, фризери, столици, сали – по еден во ред; празно = вработените)<textarea name="res" rows={3} defaultValue={C.res.map((r) => r.name).join('\n')} /></label>
      </div><div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div></BankForm>}
      {tom.length > 0 && <div className="callout">🔔 Утре {tom.length} термини без потсетник: {tom.map((a) => <Link key={a.id} href={`/termini?id=${a.id}`} style={{ marginRight: 6 }}>{a.time} {a.client}</Link>)}</div>}
      <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <Link className="btn sm" href={`/termini?d=${addDays(D, -1)}`}>◀</Link><Link className="btn sm" href={`/termini?d=${addDays(D, 1)}`}>▶</Link><Link className="btn sm ghost" href="/termini">Денес</Link>
        <form action="/termini"><input name="d" type="date" defaultValue={D} style={{ width: 'auto' }} /> <button className="btn sm">Оди</button></form>
        <span className="mini">{day.length} термини · клик на празно = нов термин</span>
      </div>
      <div className="tw"><table className="dense" style={{ tableLayout: 'fixed', minWidth: 160 + R.length * 170 }}>
        <thead><tr><th style={{ width: 60 }}>Час</th>{R.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
        <tbody>{slots.map((t) => (
          <tr key={t}><td className="mini">{mTime(t)}</td>{R.map((r) => {
            const a = day.find((x) => x.res === r.id && tMin(x.time) <= t && t < tMin(x.time) + (x.dur || 30));
            if (!a) return <td key={r.id} style={{ height: 26 }}>{write && <Link href={`/termini?nov=1&d=${D}&r=${r.id}&t=${mTime(t)}`} style={{ display: 'block', height: 22 }} aria-label="нов термин" />}</td>;
            const s = APPT_STATUS[a.status];
            return <td key={r.id} style={{ background: s[2], fontSize: 11.5, borderLeft: tMin(a.time) === t ? '3px solid #555' : undefined }}>
              <Link href={`/termini?id=${a.id}`} style={{ color: 'inherit', display: 'block' }}>{(tMin(a.time) === t || t === slots[0]) ? <><b>{a.time}</b> {a.client}<div className="mini">{a.svc}</div></> : ' '}</Link></td>;
          })}</tr>
        ))}</tbody></table></div>
    </>
  );
}
