/**
 * Legacy `VIEWS.pnalozi` 9259 / `pnEditor` — Патни налози: orders of the year, documents of a day without an order
 * (→ one order with all of them), editor (vehicle, driver, stops, km, fuel, per diem), trip flow, cash collected by
 * the driver → cash receipts (customer konto), returned goods → return credit note, print.
 */
import Link from 'next/link';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { TRAVEL_ORDER_STATUS, transportConfig } from '@wise/core/industry';
import {
  employees, fleetVehicles, industryConfigOf, stopsOf, travelOrders, unassignedDocs, userFirms, users,
} from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { TravelOrderFlow } from '@/components/travel-order-flow';
import { saveTransportConfigAction, saveTravelOrderAction, travelOrderFromDayAction, travelOrderStepAction } from './actions';

export default async function Pnalozi({ searchParams }: { searchParams: Promise<{ id?: string; nov?: string; d?: string; cfg?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('pnalozi', 'Патни налози');
  if (g.blocked) return g.blocked;
  const { firm, write, year } = g;
  const cfg = transportConfig(industryConfigOf(firm, 'transport'));
  const [V, Dr, Tu] = await Promise.all([
    db().select().from(fleetVehicles).where(and(eq(fleetVehicles.firmId, firm.id), eq(fleetVehicles.active, true), eq(fleetVehicles.trailer, false))).orderBy(asc(fleetVehicles.plate)),
    db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
    db().select({ id: users.id, name: users.name }).from(users).innerJoin(userFirms, eq(userFirms.userId, users.id)).where(and(eq(userFirms.firmId, firm.id), eq(users.role, 'teren'))),
  ]);

  if (sp.id || sp.nov) {
    const [x] = sp.id ? await db().select().from(travelOrders).where(and(eq(travelOrders.id, sp.id), eq(travelOrders.firmId, firm.id))).limit(1) : [];
    const E = x ?? { id: '', number: '', date: today(), vehicleId: cfg.vehicleId || V[0]?.id || null, driverId: cfg.driverId || null, codriver: '', from: cfg.from || [firm.address, firm.city].filter(Boolean).join(', '), purpose: 'Превоз на стока (преземање и испорака)', stops: [], depKm: null, retKm: null, fuelL: null, fuelAmt: null, assigneeId: cfg.assignee || null, dnev: cfg.dnevOn, status: 'open' as const };
    const S = stopsOf(E);
    const cashOpen = S.some((s) => Number(s.cash) > 0 && !s.cashVoucherId);
    return (
      <>
        <Hd t={x ? `Патен налог ${x.number}` : 'Нов патен налог'} sub={TRAVEL_ORDER_STATUS[E.status][0]}>
          <Link className="btn" href="/pnalozi">← Патни налози</Link>
          {x && <Link className="btn" href={`/pnalozi/print?id=${x.id}`} target="_blank">🖨 PDF</Link>}
        </Hd>
        <BankForm action={saveTravelOrderAction}>
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="stops" value={JSON.stringify(S)} />
          <div className="card"><div className="form">
            <label className="f">Број<input name="number" defaultValue={E.number} placeholder="автоматски" /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} /></label>
            <label className="f">Возило<select name="veh" defaultValue={E.vehicleId ?? ''}><option value="">—</option>{V.map((v) => <option key={v.id} value={v.id}>{v.plate} {v.name}</option>)}</select></label>
            <label className="f">Возач<select name="drv" defaultValue={E.driverId ?? ''}><option value="">—</option>{Dr.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            <label className="f">Совозач<input name="codriver" defaultValue={E.codriver ?? ''} /></label>
            <label className="f">Возач на телефон (корисник „Терен“)<select name="assignee" defaultValue={E.assigneeId ?? ''}><option value="">—</option>{Tu.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="f wide">Поаѓа од<input name="from" defaultValue={E.from ?? ''} /></label>
            <label className="f wide">Цел на патувањето<input name="purpose" defaultValue={E.purpose ?? ''} /></label>
            <label className="f">Км тргнување<input name="depKm" type="number" defaultValue={E.depKm ?? ''} /></label>
            <label className="f">Км враќање<input name="retKm" type="number" defaultValue={E.retKm ?? ''} /></label>
            <label className="f">Гориво (л)<input name="fuelL" type="number" step="any" defaultValue={E.fuelL ?? ''} /></label>
            <label className="f">Гориво (ден.)<input name="fuelAmt" type="number" step="any" defaultValue={E.fuelAmt ?? ''} /></label>
            <label className="chk"><input type="checkbox" name="dnev" defaultChecked={E.dnev} /> Дневница</label>
          </div></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Застанувања ({S.length})</h2>
            <table className="dense"><thead><tr><th>Отстрани</th><th>Вид</th><th>Документ</th><th>Комитент</th><th>Адреса</th><th>Стока</th><th className="n">Готовина</th><th>Статус</th><th /></tr></thead>
              <tbody>{S.map((s, i) => (
                <tr key={i}><td>{s.status === 'open' && <input type="checkbox" name="rm" value={i} style={{ width: 'auto' }} />}</td><td>{s.kind === 'pick' ? 'преземање' : 'испорака'}</td><td>{s.doc}</td><td>{s.partner}</td><td className="mini">{s.addr}</td>
                  <td className="mini">{s.goods.map((g) => `${g.name} ${g.qty}`).join(', ')}</td><td className="n">{s.cash ? fmt(s.cash) + (s.cashVoucherId ? ' ✓' : '') : ''}</td>
                  <td>{s.status === 'done' ? <span className="pill good">{s.recv || 'завршено'}</span> : <span className="pill">отворено</span>}{s.ret?.length ? <span className="pill warn"> ↩ поврат</span> : null}</td>
                  <td>{write && x && s.ret?.length && s.ref?.type === 'invoice' && !s.returnCreditId ? <RowAction className="btn sm" action={travelOrderStepAction.bind(null, x.id, `ret${i}`)} label="↩ Повратница" /> : s.returnCreditId ? <span className="pill good">повратница</span> : null}</td></tr>
              ))}</tbody></table>
            <div className="form" style={{ marginTop: 8 }}>
              <label className="f">Рачно застанување<select name="mKind"><option value="pick">преземање кај добавувач</option><option value="deliv">испорака кај купувач</option></select></label>
              <label className="f">Назив<input name="mPartner" /></label><label className="f">Адреса<input name="mAddr" /></label><label className="f">Стока<input name="mGoods" placeholder="Брашно 30 вреќи" /></label>
            </div>
          </div>
          {write && <div className="row" style={{ marginBottom: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>}
        </BankForm>
        {x && write && <TravelOrderFlow x={x} />}
        {x && write && <div className="row" style={{ gap: 8 }}><span style={{ flex: 1 }} />
          {cashOpen && <RowAction className="btn pri" action={travelOrderStepAction.bind(null, x.id, 'cash')} confirm="Да се прокнижат уплатници во благајна за готовината предадена од возачот?" label="💰 Прокнижи во благајна" />}
          <RowAction className="btn ghost" action={travelOrderStepAction.bind(null, x.id, 'del')} confirm={`Да се избрише патниот налог ${x.number}?`} label="🗑 Избриши" />
        </div>}
      </>
    );
  }

  const D = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today();
  const L = await db().select().from(travelOrders).where(and(eq(travelOrders.firmId, firm.id), sql`extract(year from ${travelOrders.date}) = ${year}`)).orderBy(desc(travelOrders.date), desc(travelOrders.number));
  const un = await db().transaction((tx) => unassignedDocs(tx, firm.id, D));
  const cash: Record<string, { amt: number; n: number }> = {};
  for (const x of L) for (const s of stopsOf(x)) if (Number(s.cash) > 0 && !s.cashVoucherId) { const k = x.driver ?? '—'; (cash[k] ??= { amt: 0, n: 0 }).amt += Number(s.cash); cash[k].n++; }
  return (
    <>
      <Hd t="Патни налози" sub={`возила, возачи и испорака · ${year}`}>
        <Link className="btn" href="/pnGorivo">⛽ Гориво, сервис, дневници</Link>
        <Link className="btn" href={sp.cfg ? '/pnalozi' : '/pnalozi?cfg=1'}>⚙ Стандардно</Link>
        {write && <Link className="btn pri" href="/pnalozi?nov=1">+ Нов патен налог</Link>}
      </Hd>
      {sp.cfg && <BankForm action={saveTransportConfigAction} className="card"><div className="form">
        <label className="f">Стандардно возило<select name="veh" defaultValue={cfg.vehicleId}><option value="">—</option>{V.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}</select></label>
        <label className="f">Стандарден возач<select name="drv" defaultValue={cfg.driverId}><option value="">—</option>{Dr.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="f">Возач на телефон<select name="assignee" defaultValue={cfg.assignee}><option value="">—</option>{Tu.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label className="f wide">Поаѓа од<input name="from" defaultValue={cfg.from} /></label>
        <label className="f">Дневница (ден., домашна)<input name="dnevAmt" type="number" step="any" defaultValue={cfg.dnevAmt} /></label>
        <label className="chk"><input type="checkbox" name="dnevOn" defaultChecked={cfg.dnevOn} /> Пресметувај дневница</label>
      </div><div className="row"><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div></BankForm>}
      {Object.keys(cash).length > 0 && <div className="callout">💰 <b>Готовина собрана од возачи, непрокнижена во благајна:</b> {Object.entries(cash).map(([k, v]) => `${k} – ${fmt(v.amt)} ден. (${v.n})`).join(' · ')} <span className="mini">– отворете го налогот → „Прокнижи во благајна“.</span></div>}
      <BankForm action={travelOrderFromDayAction} className="card">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Документи за превоз на {dmy(D)}</b> <Link className="mini" href="#pn_d">другиот ден ↓</Link>
          <input type="hidden" name="date" value={D} />
          <span className="mini">{un.length} документи со стока без патен налог (излезни, испратници, влезни) за {dmy(D)}</span>
          {write && un.length > 0 && <button className="btn sm pri">🚚 Креирај патен налог за сите ({un.length})</button>}
        </div>
        {un.length > 0 && <div className="mini" style={{ marginTop: 6 }}>{un.slice(0, 12).map((x) => `${x.no} · ${x.p}${x.addr ? ' (' + x.addr + ')' : ''}`).join(' · ')}</div>}
      </BankForm>
      <form id="pn_d" action="/pnalozi" className="row" style={{ gap: 6, marginBottom: 8 }}><input name="d" type="date" defaultValue={D} style={{ width: 'auto' }} /><button className="btn sm">Документи за денот</button></form>
      {L.length ? <div className="tw"><table><thead><tr><th>Број</th><th>Датум</th><th>Возило</th><th>Возач</th><th>Релација</th><th className="n">Застанувања</th><th className="n">Км</th><th className="n">Готовина</th><th>Статус</th><th /></tr></thead>
        <tbody>{L.map((x) => { const S = stopsOf(x); const c = S.reduce((a, s) => a + (Number(s.cash) || 0), 0); const st = TRAVEL_ORDER_STATUS[x.status]; return (
          <tr key={x.id}><td><b>{x.number}</b></td><td>{dmy(x.date)}</td><td>{x.plate}</td><td>{x.driver}</td><td className="mini">{x.from} → {S.map((s) => s.partner).join(' → ')}</td>
            <td className="n">{S.filter((s) => s.status === 'done').length}/{S.length}</td><td className="n">{x.retKm && x.depKm ? x.retKm - x.depKm : ''}</td>
            <td className="n">{c ? fmt(c) + (S.some((s) => Number(s.cash) > 0 && !s.cashVoucherId) ? ' ⚠' : '') : ''}</td><td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/pnalozi?id=${x.id}`}>Отвори</Link> <Link className="btn sm" href={`/pnalozi/print?id=${x.id}`} target="_blank">PDF</Link></td></tr>); })}</tbody></table></div>
        : <div className="card empty">Нема патни налози за {year}.</div>}
      <p className="note">Возилата се од флотата („⛽ Гориво, сервис, дневници“ → возила), возачите од вработените. Патниот налог се пополнува автоматски од фактурите / испратниците / влезните на денот. Возачот (улога „Терен“ → „Мои патни налози“) бележи тргнување, испорака, готовина, поврат и враќање. Ништо од возачот не се книжи само: готовината и повратниците ги прокнижувате вие од налогот.</p>
    </>
  );
}
