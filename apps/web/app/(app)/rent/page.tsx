/**
 * Legacy `VIEWS.rent` 9766 + editor 9777 → 11664 — Rent-a-car: 21-day fleet calendar, active and future rentals,
 * contract editor (driver, documents, countries, extras, agreed price), handover / return, deposit, invoice.
 */
import Link from 'next/link';
import { and, asc, eq, ne } from 'drizzle-orm';
import { addDays, NATIONALITIES, rcCalc, RENT_STATUS, rentalsOverlap } from '@wise/core/industry';
import { firmRentConfig, fleetVehicles, invoices, rentRentals, vehicleRates, type RentRental } from '@wise/db';
import { partnerOptions } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, nowLocal, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { handoverAction, rentalStepAction, saveRentalAction, settleDepositAction } from './actions';

type SP = { id?: string; nov?: string; veh?: string; d?: string; from?: string };
const st = (r: Pick<RentRental, 'status' | 'invoiceId'>) => (r.status === 'ret' && r.invoiceId ? 'closed' : r.status);
const dt = (s: string) => s.replace('T', ' ');

export default async function RentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('rent', 'Rent-a-car – резервации');
  if (g.blocked) return g.blocked;
  const { firm, write } = g;
  const C = firmRentConfig(firm);
  const F = await db().select().from(fleetVehicles).where(and(eq(fleetVehicles.firmId, firm.id), eq(fleetVehicles.rent, true), eq(fleetVehicles.active, true))).orderBy(asc(fleetVehicles.plate));
  const T = today();

  if (sp.id || sp.nov) {
    const [E0] = sp.id ? await db().select().from(rentRentals).where(and(eq(rentRentals.id, sp.id), eq(rentRentals.firmId, firm.id))).limit(1) : [];
    const v0 = F.find((v) => v.id === (sp.veh ?? E0?.vehicleId)) ?? F[0];
    const from = (sp.d ?? T) + 'T09:00';
    const E = E0 ?? { id: '', number: '', vehicleId: v0?.id ?? '', plate: v0?.plate ?? '', from, to: addDays(from.slice(0, 10), 3) + 'T09:00', driver: { name: '' } as RentRental['driver'], driver2: '', partnerId: null,
      deposit: v0?.rDep ?? null, extras: [], status: 'resv' as const, note: '', out: { fuel: 8 }, ret: {}, pDay: null, priceTot: null, countries: ['MK'], green: false, invoiceId: null, depositVoucherId: null, depositKept: null, depositClosed: false };
    const v = F.find((x) => x.id === E.vehicleId) ?? (await db().select().from(fleetVehicles).where(eq(fleetVehicles.id, E.vehicleId)).limit(1))[0];
    const k = v ? rcCalc(E, vehicleRates(v), C) : null;
    const P = await partnerOptions(firm.id);
    const inv = E.invoiceId ? (await db().select({ n: invoices.number, t: invoices.total }).from(invoices).where(eq(invoices.id, E.invoiceId)))[0] : null;
    const d = E.driver;
    const ro = !write || !!E.invoiceId || E.status === 'cancel';
    const s = RENT_STATUS[st(E)];
    return (
      <>
        <Hd t={E.id ? `Договор ${E.number}` : 'Нова резервација'} sub={s[0]}>
          <Link className="btn" href="/rent">← Резервации</Link>
          {E.id && <Link className="btn" href={`/rent/dogovor?id=${E.id}`} target="_blank">🖨 Договор</Link>}
        </Hd>
        <BankForm action={saveRentalAction}>
          <input type="hidden" name="id" value={E.id} />
          <div className="card"><div className="form">
            <label className="f">Возило<select name="veh" defaultValue={E.vehicleId}>{F.map((x) => <option key={x.id} value={x.id}>{x.plate} · {x.name} · {fmt(x.rDay)}/ден</option>)}</select></label>
            <label className="f">Преземање<input name="from" type="datetime-local" defaultValue={E.from} /></label>
            <label className="f">Враќање<input name="to" type="datetime-local" defaultValue={E.to} /></label>
            <label className="f">Договорена цена по ден (со ДДВ)<input name="pDay" type="number" step="any" defaultValue={E.pDay ? Number(E.pDay) : ''} placeholder="од ценовникот" /></label>
            <label className="f">Кауција<input name="deposit" type="number" step="any" defaultValue={E.deposit ? Number(E.deposit) : ''} /></label>
            <label className="f">Фактура на фирма<select name="partner" defaultValue={E.partnerId ?? ''}><option value="">— корисникот —</option>{P.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="f">Земји (MK, AL, …)<input name="countries" defaultValue={E.countries.join(', ')} /></label>
            <label className="chk"><input type="checkbox" name="green" defaultChecked={E.green} /> Зелен картон</label>
            <label className="f wide">Забелешка<input name="note" defaultValue={E.note ?? ''} /></label>
          </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Корисник / возач</h2><div className="form">
            <label className="f">Име и презиме<input name="d_name" defaultValue={d.name} /></label>
            <label className="f">Датум на раѓање<input name="d_birth" type="date" defaultValue={d.birth ?? ''} /></label>
            <label className="f">Државјанство<select name="d_nat" defaultValue={d.nat ?? 'MK'}>{NATIONALITIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
            <label className="f">ЕМБГ<input name="d_embg" defaultValue={d.embg ?? ''} /></label>
            <label className="f wide">Адреса<input name="d_addr" defaultValue={d.addr ?? ''} /></label>
            <label className="f">Документ (лк / пасош) бр.<input name="d_doc" defaultValue={d.doc ?? ''} /></label>
            <label className="f">Документот важи до<input name="d_docExp" type="date" defaultValue={d.docExp ?? ''} /></label>
            <label className="f">Возачка дозвола бр.<input name="d_lic" defaultValue={d.lic ?? ''} /></label>
            <label className="f">Возачка од<input name="d_licFrom" type="date" defaultValue={d.licFrom ?? ''} /></label>
            <label className="f">Возачка важи до<input name="d_licExp" type="date" defaultValue={d.licExp ?? ''} /></label>
            <label className="f">Категорија<input name="d_licCat" defaultValue={d.licCat ?? ''} /></label>
            <label className="f">Телефон<input name="d_phone" defaultValue={d.phone ?? ''} /></label>
            <label className="f">Е-пошта<input name="d_email" defaultValue={d.email ?? ''} /></label>
            <label className="f">Контакт за итни случаи<input name="d_emerg" defaultValue={d.emerg ?? ''} /></label>
            <label className="f">Втор возач<input name="driver2" defaultValue={E.driver2 ?? ''} /></label>
          </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дополнително (детско седиште, GPS, …)</h2>
            <table className="dense"><tbody>{[...E.extras, ...Array(2).fill({ name: '', qty: 1, price: '' })].map((x, i) => (
              <tr key={i}><td><input name={`x.name.${i}`} defaultValue={x.name} /></td><td><input name={`x.qty.${i}`} type="number" defaultValue={x.qty} style={{ width: 70 }} /></td><td><input name={`x.price.${i}`} type="number" step="any" defaultValue={x.price} style={{ width: 100 }} placeholder="цена со ДДВ" /></td></tr>
            ))}</tbody></table>
          </div>
          {!ro && <div className="row" style={{ marginBottom: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </BankForm>
        {E.id && k && (
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Пресметка</h2>
            <table className="dense" style={{ maxWidth: 560 }}><tbody>
              <tr><td>Изнајмување: {k.days} ден.{k.pDayAgreed ? ` × ${fmt(k.pDayAgreed)} (договорено)` : ''}</td><td className="n">{fmt(k.rent)}</td></tr>
              {k.ex.map((x, i) => <tr key={i}><td>{x.name} ({x.qty} × {fmt(x.price)})</td><td className="n">{fmt(x.qty * x.price)}</td></tr>)}
              <tr><td><b>Вкупно (со ДДВ {C.rate}%)</b></td><td className="n"><b>{fmt(k.tot)}</b></td></tr>
              {k.dep > 0 && <tr><td>Кауција {E.depositVoucherId ? '(примена)' : ''}{E.depositClosed ? ` · задржано ${fmt(E.depositKept)}` : ''}</td><td className="n">{fmt(k.dep)}</td></tr>}
            </tbody></table>
          </div>
        )}
        {E.id && write && (E.status === 'resv' || E.status === 'out') && (
          <BankForm action={handoverAction} className="card">
            <input type="hidden" name="id" value={E.id} /><input type="hidden" name="kind" value={E.status === 'resv' ? 'out' : 'ret'} />
            <h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{E.status === 'resv' ? 'Предавање на возилото' : `Враќање (предадено ${dt(E.out.at ?? '')}, км ${E.out.km ?? ''}, гориво ${E.out.fuel ?? ''}/8)`}</h2>
            <div className="form">
              <label className="f">Км<input name="km" type="number" defaultValue={E.status === 'resv' ? v?.odo ?? '' : ''} /></label>
              <label className="f">Гориво (0–8 / 8)<input name="fuel" type="number" min={0} max={8} defaultValue={E.status === 'resv' ? 8 : ''} /></label>
              <label className="f wide">Оштетувања<input name="dmg" /></label>
            </div>
            <div className="row"><span style={{ flex: 1 }} /><button className="btn pri">{E.status === 'resv' ? '🔑 Предај возило' : '↩ Прими возило'}</button></div>
          </BankForm>
        )}
        {E.id && write && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }} />
            {E.status === 'resv' && <RowAction className="btn ghost" action={rentalStepAction.bind(null, E.id, 'cancel')} confirm={`Да се откаже резервацијата ${E.number}?`} label="Откажи" />}
            {Number(E.deposit) > 0 && !E.depositVoucherId && E.status !== 'cancel' && <RowAction className="btn" action={rentalStepAction.bind(null, E.id, 'dep')} confirm={`Уплатница за кауција ${fmt(E.deposit)} ден. (Должи благајна / Побарува ${C.depK})?`} label="💰 Прими кауција" />}
            {E.status === 'ret' && !E.invoiceId && <RowAction className="btn pri" action={rentalStepAction.bind(null, E.id, 'inv')} label="🧾 Фактура" />}
            {inv && <span className="pill good">Фактура {inv.n}</span>}
          </div>
        )}
        {E.id && write && E.depositVoucherId && !E.depositClosed && E.status !== 'resv' && (
          <BankForm action={settleDepositAction} className="card row" style={{ gap: 8, alignItems: 'end' }} confirm="Да се порамни кауцијата (пребивање со фактурата и исплатница за остатокот)?">
            <input type="hidden" name="id" value={E.id} />
            <label className="f">Колку да се задржи (пребие со фактурата)<input name="keep" type="number" step="any" defaultValue={inv ? Math.min(Number(E.deposit), Number(inv.t)) : 0} /></label>
            <button className="btn">↔ Порамни кауција</button>
          </BankForm>
        )}
      </>
    );
  }

  const F0 = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(T, -2);
  const days = [...Array(21)].map((_, i) => addDays(F0, i));
  const A = await db().select().from(rentRentals).where(and(eq(rentRentals.firmId, firm.id), ne(rentRentals.status, 'cancel'))).orderBy(asc(rentRentals.from));
  const occ = (vid: string, d: string) => A.find((r) => r.vehicleId === vid && r.from.slice(0, 10) <= d && d <= String(r.ret.at || r.to).slice(0, 10));
  const now = nowLocal();
  const dueT = A.filter((r) => r.status === 'out' && r.to.slice(0, 10) <= T);
  const free = F.filter((x) => !occ(x.id, T)).length;
  const list = A.filter((r) => ['resv', 'out', 'ret'].includes(st(r)));
  void rentalsOverlap;
  return (
    <>
      <Hd t="Rent-a-car – резервации" sub={dmy(T)}>
        <Link className="btn" href="/flota">🚙 Флота и цени</Link>
        <Link className="btn" href="/rentIzv">📈 Извештаи</Link>
        {write && <Link className="btn pri" href="/rent?nov=1">+ Нова резервација</Link>}
      </Hd>
      {!F.length && <div className="callout warn">Нема возила за изнајмување: во „🚙 Флота и цени“ внесете ги возилата и цените.</div>}
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {([['Слободни денес', `${free} / ${F.length}`], ['Кај клиенти', A.filter((r) => r.status === 'out').length], ['Преземања денес', A.filter((r) => r.status === 'resv' && r.from.slice(0, 10) === T).length], ['Враќања денес / доцнат', dueT.length]] as const).map(([t, v]) => (
          <div key={t} className="card" style={{ flex: 1, minWidth: 160, margin: 0 }}><div className="mini">{t}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      {dueT.some((r) => r.to < now) && <div className="callout warn">⏰ Требаше да се вратат: {dueT.filter((r) => r.to < now).map((r) => `${r.plate} – ${r.driver.name} (${dt(r.to)})`).join(', ')}</div>}
      <div className="card" style={{ padding: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <Link className="btn sm" href={`/rent?from=${addDays(F0, -7)}`}>◀</Link><Link className="btn sm" href={`/rent?from=${addDays(F0, 7)}`}>▶</Link><Link className="btn sm ghost" href="/rent">Денес</Link>
          <span className="mini">Клик на празно поле = нова резервација</span>
        </div>
        <div className="tw"><table className="dense" style={{ tableLayout: 'fixed', minWidth: 1000 }}>
          <thead><tr><th style={{ width: 130 }}>Возило</th>{days.map((d) => <th key={d} style={{ textAlign: 'center', background: d === T ? 'var(--accent-soft)' : undefined }}>{d.slice(8)}.{d.slice(5, 7)}</th>)}</tr></thead>
          <tbody>{F.map((x) => (
            <tr key={x.id}><td><b>{x.plate}</b><div className="mini">{x.name}</div></td>
              {days.map((d) => {
                const r = occ(x.id, d);
                if (!r) return <td key={d} style={{ background: d === T ? 'var(--accent-soft)' : undefined }}>{write && <Link href={`/rent?nov=1&veh=${x.id}&d=${d}`} style={{ display: 'block', height: 18 }} aria-label="нова резервација" />}</td>;
                const first = r.from.slice(0, 10) === d || d === days[0];
                return <td key={d} title={`${r.driver.name} · ${dt(r.from)} – ${dt(r.to)}`} style={{ background: RENT_STATUS[st(r)][2], fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', borderLeft: first ? '3px solid #555' : undefined }}>
                  <Link href={`/rent?id=${r.id}`} style={{ color: 'inherit', display: 'block' }}>{first ? r.driver.name : ' '}</Link></td>;
              })}</tr>
          ))}</tbody></table></div>
      </div>
      <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Активни и идни</h2>
        <div className="tw"><table className="dense"><thead><tr><th>Број</th><th>Возило</th><th>Корисник</th><th>Од</th><th>До</th><th className="n">Денови</th><th className="n">Износ</th><th className="n">Кауција</th><th>Статус</th><th /></tr></thead>
          <tbody>{list.map((r) => { const v = F.find((x) => x.id === r.vehicleId); const k = v ? rcCalc(r, vehicleRates(v), C) : null; const s = RENT_STATUS[st(r)]; return (
            <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td>{dt(r.from)}</td><td>{dt(r.to)}</td><td className="n">{k?.days}</td><td className="n">{k ? fmt(k.tot) : ''}</td>
              <td className="n">{Number(r.deposit) ? fmt(r.deposit) + (r.depositVoucherId ? ' ✓' : '') : ''}</td><td><span className={`pill ${s[1]}`}>{s[0]}</span></td><td><Link className="btn sm" href={`/rent?id=${r.id}`}>Отвори</Link></td></tr>); })}
            {!list.length && <tr><td colSpan={10} className="note">Нема.</td></tr>}</tbody></table></div>
      </div>
    </>
  );
}
