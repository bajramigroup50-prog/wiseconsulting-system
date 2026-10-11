/**
 * Legacy `VIEWS.pnalozi` 9259 / `pnDefsHTML` 9273 / `pnEditor` 9290 / `pnStopOfficeHTML` 9283 — Патни налози: orders of
 * the year with the service / document / fuel warnings and the cash collected by drivers, documents of a day without an
 * order (→ one order with all of them), defaults, the editor (vehicle, driver, stops from the day's documents or
 * manual, loaded ☑, km, fuel, per diem, load vs capacity, route), the trip flow, cash → receipts, returns → credit
 * note, delivery confirmations (print + e-mail to the buyer) and the order print.
 */
import Link from 'next/link';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  fuelAlerts, fuelRows, hoursMinutes, mailableStops, newTravelOrderDefaults, orderKm, orderL100, serviceDue, serviceLeftText, TRAVEL_ORDER_STATUS,
  transportConfig, travelDuration, travelLoad, travelPerDiem, travelRoute, vehicleDocAlerts, vehicleExpired, vehicleOdo,
} from '@wise/core/industry';
import {
  employees, eventsOf, fleetVehicles, industryConfigOf, lastTravelOrder, partners, stopsOf, travelItemInfo, travelOrders, unassignedDocs, userFirms, users,
} from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { BankForm } from '@/components/bank-form';
import { Hd } from '@/components/hd';
import { RowAction } from '@/components/row-action';
import { TravelOrderFlow } from '@/components/travel-order-flow';
import { DateJump } from '@/components/hotel-rent';
import { saveTransportConfigAction, saveTravelOrderAction, travelMailAction, travelOrderFromDayAction, travelOrderStepAction } from './actions';

type SP = { id?: string; nov?: string; d?: string; cfg?: string };
const mapUrl = (g: { lat: number; lon: number }) => `https://maps.google.com/?q=${g.lat},${g.lon}`;

export default async function Pnalozi({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const g = await industryPage('pnalozi', 'Патни налози');
  if (g.blocked) return g.blocked;
  const { firm, write, del, year } = g;
  const T = today();
  const cfg = transportConfig(industryConfigOf(firm, 'transport'));
  const [V, Dr, Tu, Oall] = await Promise.all([
    db().select().from(fleetVehicles).where(and(eq(fleetVehicles.firmId, firm.id), eq(fleetVehicles.active, true), eq(fleetVehicles.trailer, false))).orderBy(asc(fleetVehicles.plate)),
    db().select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.firmId, firm.id)).orderBy(asc(employees.name)),
    db().select({ id: users.id, name: users.name }).from(users).innerJoin(userFirms, eq(userFirms.userId, users.id)).where(and(eq(userFirms.firmId, firm.id), eq(users.active, true), sql`${users.role} <> 'klient'`)).orderBy(asc(users.name)),
    db().select({ id: travelOrders.id, vehicleId: travelOrders.vehicleId, plate: travelOrders.plate, depKm: travelOrders.depKm, retKm: travelOrders.retKm, status: travelOrders.status, date: travelOrders.date, fuelL: travelOrders.fuelL, fuelAmt: travelOrders.fuelAmt }).from(travelOrders).where(eq(travelOrders.firmId, firm.id)),
  ]);
  const odo = (vid: string) => vehicleOdo(vid, Oall, V.find((v) => v.id === vid)?.odo);

  if (sp.id || sp.nov) {
    const [x] = sp.id ? await db().select().from(travelOrders).where(and(eq(travelOrders.id, sp.id), eq(travelOrders.firmId, firm.id))).limit(1) : [];
    const last = x ? null : await lastTravelOrder(db(), firm.id);
    const d0 = newTravelOrderDefaults({ cfg, last, vehicles: V, drivers: Dr, odoOf: odo });
    const E = x ?? { id: '', number: '', date: T, vehicleId: d0.vehicleId || null, driverId: d0.driverId || null, codriver: '', from: cfg.from || [firm.address, firm.city].filter(Boolean).join(', '), purpose: 'Превоз на стока (преземање и испорака)', stops: [], depKm: d0.depKm, retKm: null, fuelL: null, fuelAmt: null, assigneeId: d0.assigneeId || null, dnev: d0.dnev, status: 'open' as const, events: [] };
    const S = stopsOf(E), EV = eventsOf(E);
    const v = V.find((y) => y.id === E.vehicleId);
    const info = await travelItemInfo(db(), firm.id, S.flatMap((s) => s.goods.map((g2) => g2.itemId)));
    const ld = travelLoad(S, (g2) => ((g2.itemId ? info.get(g2.itemId)?.kg : 0) || Number(g2.kg) || 0) * (Number(g2.qty) || 0));
    const over = !!(v?.capKg && ld.peak > v.capKg);
    const expired = v ? vehicleExpired(v, T) : [];
    const svc = v ? serviceDue(v, odo(v.id)) : [];
    const km = orderKm(E), l100 = orderL100(E);
    const dur = travelDuration(EV);
    const dn = travelPerDiem({ dnev: E.dnev, events: EV }, cfg);
    const un = (await db().transaction((tx) => unassignedDocs(tx, firm.id, E.date))).filter((u) => !S.some((s) => s.ref?.id === u.id));
    const cashS = S.map((s, i) => ({ s, i })).filter((o) => Number(o.s.cash) > 0);
    const cashUn = cashS.filter((o) => !o.s.cashVoucherId);
    const pids = [...new Set(S.map((s) => s.partnerId).filter((p): p is string => !!p))];
    const PE = pids.length ? await db().select({ id: partners.id, email: partners.email }).from(partners).where(and(eq(partners.firmId, firm.id), inArray(partners.id, pids))) : [];
    const emailOf = (s: (typeof S)[number]) => s.email || PE.find((p) => p.id === s.partnerId)?.email || '';
    const mailN = x ? mailableStops(S, emailOf).length : 0;
    const route = travelRoute({ from: E.from, stops: S });
    const ro = !write;
    return (
      <>
        <Hd t={x ? `Патен налог ${x.number}` : 'Нов патен налог'} sub={TRAVEL_ORDER_STATUS[E.status][0]}>
          <Link className="btn" href="/pnalozi">← Листа</Link>
          {x && <Link className="btn" href={`/pnalozi/print?id=${x.id}`} target="_blank">PDF</Link>}
        </Hd>
        {expired.length > 0 && <div className="callout warn">⚠ Возилото има истечен документ (регистрација / осигурување / технички): {expired.map(dmy).join(', ')} – не треба да тргне на пат.</div>}
        {over && <div className="callout warn">⚠ Товарот (до {fq(ld.peak)} кг) ја надминува носивоста на возилото ({fq(v!.capKg!)} кг). Поделете ги испораките на два налога или друго возило.</div>}
        {svc.length > 0 && <div className="callout warn">{svc.map((s) => `🔧 ${s.n}: ${serviceLeftText(s.left, fq)}`).join(' · ')}</div>}
        <BankForm action={saveTravelOrderAction}>
          <input type="hidden" name="id" value={E.id} /><input type="hidden" name="ldf" value="1" />
          <div className="card"><div className="form">
            <label className="f">Број<input name="number" defaultValue={E.number} placeholder="автоматски" /></label>
            <label className="f">Датум<input name="date" type="date" defaultValue={E.date} /></label>
            <label className="f">Возило<select name="veh" defaultValue={E.vehicleId ?? ''}><option value="">—</option>{V.map((y) => <option key={y.id} value={y.id}>{y.plate} · {y.name ?? ''}</option>)}</select></label>
            <label className="f">Возач<select name="drv" defaultValue={E.driverId ?? ''}><option value="">—</option>{Dr.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
            <label className="f">Сопатник / помошник<input name="codriver" defaultValue={E.codriver ?? ''} /></label>
            <label className="f">На телефон кај (терен)<select name="assignee" defaultValue={E.assigneeId ?? ''}><option value="">—</option>{Tu.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            <label className="f wide">Тргнување од<input name="from" defaultValue={E.from ?? ''} /></label>
            <label className="f wide">Цел на патувањето<input name="purpose" defaultValue={E.purpose ?? ''} /></label>
            <label className="f">Км при тргнување<input name="depKm" type="number" defaultValue={E.depKm ?? ''} /></label>
            <label className="f">Км при враќање<input name="retKm" type="number" defaultValue={E.retKm ?? ''} /></label>
            <label className="f">Гориво (л)<input name="fuelL" type="number" step="any" defaultValue={E.fuelL ?? ''} /></label>
            <label className="f">Гориво (ден.)<input name="fuelAmt" type="number" step="any" defaultValue={E.fuelAmt ?? ''} /></label>
          </div>
            <label className="chk" style={{ margin: '8px 0 0' }}><input type="checkbox" name="dnev" defaultChecked={E.dnev} /> Службено патување надвор од седиштето – пресметај дневница</label>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <span className="mini">⚖ Товар: <b>{fq(ld.peak)} кг</b>{v?.capKg ? ` од ${fq(v.capKg)} кг носивост (${Math.round((ld.peak / v.capKg) * 100)}%)` : ''}{ld.miss ? ` · ${ld.miss} ставки без тежина (Артикли → Тежина)` : ''}</span>
              {km > 0 && <span className="mini">🛣 {fq(km)} км{l100 ? ` · ⛽ ${fq(l100)} л/100 км${v?.fuelNorm ? ` (норма ${fq(Number(v.fuelNorm))})` : ''}` : ''}{Number(E.fuelAmt) && km ? ` · ${fmt(Number(E.fuelAmt) / km)} ден./км` : ''}</span>}
              {dur != null && <span className="mini">⏱ {hoursMinutes(dur)}{dn ? <> · дневница {dn.pct}% = <b>{fmt(dn.amt)}</b> ден.</> : null}</span>}
            </div>
            {route.length > 0 && <div className="row" style={{ gap: 6, marginTop: 8 }}>{route.map((u, i) => <a key={i} className="btn sm" href={u} target="_blank" rel="noopener noreferrer">🗺 Рута во Google Maps{route.length > 1 ? ` (дел ${i + 1}/${route.length})` : ''}</a>)}</div>}
          </div>
          {cashS.length > 0 && (
            <div className="card" style={{ borderLeft: '4px solid #1f8a4c' }}>
              <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>💰 Готовина наплатена од возачот: {fmt(cashS.reduce((a, o) => a + Number(o.s.cash), 0))} ден.</h2>
                {cashUn.length && x && write ? <RowAction className="btn sm pri" action={travelOrderStepAction.bind(null, x.id, 'cash')} confirm={`Да се прокнижат ${cashUn.length} уплатници во благајна вкупно ${fmt(cashUn.reduce((a, o) => a + Number(o.s.cash), 0))} ден. (готовина предадена од возачот ${x.driver ?? ''})?`} label={`Прокнижи во благајна (${cashUn.length} уплатници)`} /> : !cashUn.length ? <span className="pill good">сè е прокнижено</span> : null}</div>
              <p className="note" style={{ margin: '4px 0 0' }}>Секоја наплата станува уплатница во благајна (Должи благајна / Побарува купувач) поврзана со фактурата – фактурата се затвора. Пред книжење пребројте ја готовината што ја предава возачот.</p>
            </div>
          )}
          <div className="card">
            <div className="hd"><h2 style={{ fontSize: 15, margin: 0 }}>Застанувања и стока ({S.length})</h2>
              <div className="row" style={{ gap: 6 }}>{mailN > 0 && x && write && <RowAction className="btn sm" action={travelMailAction.bind(null, x.id, 'all')} confirm={`Да се испрати известување „Испорачано“ со потврда (PDF: потпис, време, GPS) на ${mailN} купувачи?`} label={`✉ Извести ги купувачите (${mailN})`} />}</div></div>
            {S.map((s, i) => {
              const done = s.status === 'done';
              const ret = (s.ret ?? []).filter((r) => Number(r.qty) > 0);
              return (
                <div key={i} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div><b>{i + 1}. {s.kind === 'pick' ? '📦 Преземање: ' : '🚚 Испорака: '}{s.partner}</b> <span className="mini">· {s.doc}{s.addr ? ' · ' + s.addr : ''}{s.kind !== 'pick' && Number(s.open) > 0 ? ` · за наплата ${fmt(s.open)} ден.` : ''}</span></div>
                    <div>{done ? <><span className="pill good">{s.kind === 'pick' ? 'преземено' : 'испорачано'} {s.at ? new Date(s.at).toLocaleTimeString('mk-MK', { timeZone: 'Europe/Skopje', hour: '2-digit', minute: '2-digit' }) : ''}</span>{s.geo && <> <a className="mini" href={mapUrl(s.geo)} target="_blank" rel="noopener noreferrer">📍 мапа</a></>}{s.recv && <span className="mini"> · примил: {s.recv}</span>}</> : <span className="pill">неиспорачано</span>}
                      {!ro && !s.cashVoucherId && !s.returnCreditId && <label className="mini" style={{ marginLeft: 6 }} title="Отстрани"><input type="checkbox" name="rm" value={i} style={{ width: 'auto' }} /> ✕</label>}</div>
                  </div>
                  <div className="mini" style={{ marginTop: 4 }}>{s.goods.map((g2, k) => (
                    <label key={k} style={{ marginRight: 14, display: 'inline-flex', gap: 5, alignItems: 'center', width: 'auto' }}>
                      <input type="checkbox" name="ld" value={`${i}:${k}`} defaultChecked={!!g2.loaded} disabled={ro} style={{ width: 'auto', margin: 0 }} /> {g2.name} – {fq(Number(g2.qty) || 0)} {g2.unit ?? ''}
                      {Number(g2.lq) > 0 && !g2.loaded && <span className="pill warn">скенирано {fq(Number(g2.lq))}</span>}
                    </label>))}</div>
                  {done && (s.sig || s.photo || Number(s.cash) || ret.length) ? (
                    <div className="row" style={{ gap: 10, marginTop: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {s.sig && <div className="mini">Потпис<br /><img src={`/api/files/${s.sig}`} alt="" style={{ height: 54, border: '1px solid var(--line)', borderRadius: 4, background: '#fff' }} /></div>}
                      {s.photo && <div className="mini">Слика<br /><a href={`/api/files/${s.photo}`} target="_blank" rel="noopener noreferrer"><img src={`/api/files/${s.photo}`} alt="" style={{ height: 54, border: '1px solid var(--line)', borderRadius: 4 }} /></a></div>}
                      {Number(s.cash) > 0 && <div className="mini">💰 Наплатено во готово: <b>{fmt(s.cash)}</b> ден.<br />{s.cashVoucherId ? <span className="pill good">прокнижено во благајна</span> : <span className="pill warn">не е прокнижено</span>}</div>}
                      {ret.length > 0 && <div className="mini">↩ Вратено: {ret.map((r) => `${s.goods[r.k]?.name ?? ''} – ${fq(r.qty)}`).join(', ')}<br />
                        {s.ref?.type === 'invoice' ? (s.returnCreditId ? <span className="pill good">повратница креирана</span> : x && write ? <RowAction className="btn sm" action={travelOrderStepAction.bind(null, x.id, `ret${i}`)} confirm="Да се креира повратница (одобрение) за вратените количини? Стоката се враќа на залиха." label="↩ Креирај повратница (одобрение)" /> : null) : <span className="mini">(испратница – коригирајте ја рачно)</span>}</div>}
                    </div>) : null}
                  {done && s.kind !== 'pick' && x && (
                    <div className="row" style={{ gap: 6, marginTop: 6 }}>
                      <Link className="btn sm" href={`/pnalozi/pod?id=${x.id}&i=${i}`} target="_blank">📄 Потврда за испорака</Link>
                      {write && <RowAction className="btn sm" action={travelMailAction.bind(null, x.id, i)} confirm={`Да се испрати известување „Испорачано“ со потврда (PDF) на ${emailOf(s) || 'купувачот'}?`} label={s.mailed ? `✉ Испратено ${dmy(String(s.mailed).slice(0, 10))} – пак` : '✉ Извести го купувачот'} />}
                    </div>)}
                </div>);
            })}
            {!S.length && <p className="note">Додајте фактури или испратници.</p>}
            {!ro && <div className="form" style={{ marginTop: 8 }}>
              <label className="f wide">+ Додај фактура / испратница / влезна фактура…<select name="add" multiple size={Math.min(6, Math.max(2, un.length))}>{un.map((u) => <option key={u.type + u.id} value={`${u.type}:${u.id}`}>{u.no} · {u.p}</option>)}</select></label>
              <label className="f">+ Рачно застанување<select name="mKind" defaultValue="pick"><option value="deliv">1 = Испорака кај купувач</option><option value="pick">2 = Преземање кај добавувач</option></select></label>
              <label className="f">Назив (добавувач / купувач)<input name="mPartner" /></label><label className="f">Адреса<input name="mAddr" /></label><label className="f">Стока (опис, на пр. „Брашно 30 вреќи“)<input name="mGoods" /></label>
            </div>}
            {!ro && !un.length && <p className="mini">Нема документи со стока без патен налог на {dmy(E.date)}.</p>}
            <p className="mini" style={{ margin: '6px 0 0' }}>☑ = натоварено (проверка при товарење; возачот може да товари со скенирање баркод на телефон).</p>
          </div>
          {EV.length > 0 && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Дневник на патувањето</h2>
            {EV.map((e, i) => <div key={i} className="mini">{new Date(e.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })} – {e.txt}{e.geo ? <> · <a href={mapUrl(e.geo)} target="_blank" rel="noopener noreferrer">📍 {e.geo.lat}, {e.geo.lon}{e.geo.acc != null ? ` (±${e.geo.acc} м)` : ''}</a></> : ' · без GPS'}</div>)}</div>}
          {write && <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}><span style={{ flex: 1 }} />
            {v?.capKg ? <label className="chk"><input type="checkbox" name="overOk" style={{ width: 'auto' }} /> Сепак зачувај (товар над носивоста)</label> : null}
            <Link className="btn" href="/pnalozi">Откажи</Link><button className="btn pri">Зачувај</button></div>}
        </BankForm>
        {x && write && <TravelOrderFlow x={x} />}
        {x && write && <div className="row" style={{ gap: 8 }}><span style={{ flex: 1 }} />
          {(x.status === 'open' || del) && <RowAction className="btn ghost" style={{ color: 'var(--bad)' }} action={travelOrderStepAction.bind(null, x.id, 'del')} confirm={`Да се избрише патниот налог ${x.number}?`} label="🗑 Избриши" />}
        </div>}
      </>
    );
  }

  const D = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : T;
  const L = await db().select().from(travelOrders).where(and(eq(travelOrders.firmId, firm.id), sql`extract(year from ${travelOrders.date}) = ${year}`)).orderBy(desc(travelOrders.date), desc(travelOrders.number));
  const un = await db().transaction((tx) => unassignedDocs(tx, firm.id, D));
  const cash: Record<string, { amt: number; n: number }> = {};
  for (const x of L) for (const s of stopsOf(x)) if (Number(s.cash) > 0 && !s.cashVoucherId) { const k = x.driver ?? '—'; (cash[k] ??= { amt: 0, n: 0 }).amt += Number(s.cash); cash[k].n++; }
  const svc = V.flatMap((v) => serviceDue(v, odo(v.id)).map((s) => ({ s, v })));
  const exp = V.flatMap((v) => vehicleDocAlerts(v, T).map((e) => ({ e, v })));
  const fa = fuelAlerts(fuelRows(Oall.filter((o) => o.date.slice(0, 4) === String(year)), V));
  return (
    <>
      <Hd t="Патни налози" sub={`возила, возачи и испорака · ${year}`}>
        <Link className="btn" href="/pnLive">🛰 Возила во живо</Link>
        <Link className="btn" href="/pnGorivo">⛽ Гориво, сервис, дневници</Link>
        <Link className="btn" href={sp.cfg ? '/pnalozi' : '/pnalozi?cfg=1'}>⚙ Стандардно</Link>
        {write && <Link className="btn pri" href="/pnalozi?nov=1">+ Нов патен налог</Link>}
      </Hd>
      {sp.cfg && <BankForm action={saveTransportConfigAction} className="card">
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Стандардни податоци за нов патен налог</h2>
        <div className="form">
          <label className="f">Возило<select name="veh" defaultValue={cfg.vehicleId}><option value="">—</option>{V.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.name ?? ''}</option>)}</select></label>
          <label className="f">Возач<select name="drv" defaultValue={cfg.driverId}><option value="">—</option>{Dr.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="f">Корисник на телефон (терен)<select name="assignee" defaultValue={cfg.assignee}><option value="">—</option>{Tu.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="f wide">Тргнување од (магацин)<input name="from" defaultValue={cfg.from || [firm.address, firm.city].filter(Boolean).join(', ')} /></label>
          <label className="f">Дневница – полн износ (ден.)<input name="dnevAmt" type="number" step="any" defaultValue={cfg.dnevAmt} placeholder="проверете го износот" /></label>
        </div>
        <label className="chk" style={{ margin: '8px 0' }}><input type="checkbox" name="dnevOn" defaultChecked={cfg.dnevOn} /> Новите налози се службено патување надвор од седиштето (се пресметува дневница)</label>
        <p className="note" style={{ margin: '4px 0 0' }}>Дневницата се пресметува од времето „Тргнав“ → „Вратен“: 8–12 часа = 50%, над 12 часа = 100% (за патување во земјата). Износот на полна дневница внесете го според вашиот акт / важечките прописи (неоданочив дел за службено патување во земјата е до 8% од просечната нето плата) – проверете со сметководителот пред исплата.</p>
        {!V.length && <p className="note">Нема возила: во „⛽ Гориво, сервис, дневници → 🚚 Возила“ внесете го возилото (таблица, регистрација, осигурување).</p>}
        <div className="row" style={{ gap: 8, marginTop: 8 }}><span style={{ flex: 1 }} /><button className="btn pri">Зачувај</button></div>
      </BankForm>}
      {(svc.length > 0 || exp.length > 0 || fa.length > 0) && <div className="callout warn">
        {svc.map(({ s, v }, i) => <div key={'s' + i}>🔧 <b>{v.plate}</b>: {s.n} {s.left < 0 ? <b>поминат пред {fq(-s.left)} км</b> : `за ${fq(s.left)} км`}</div>)}
        {exp.map(({ e, v }, i) => <div key={'e' + i}>📄 <b>{v.plate}</b>: {e.n} {e.days < 0 ? <b>истечено {dmy(e.d)}</b> : `истекува ${dmy(e.d)}`}</div>)}
        {fa.map((a, i) => <div key={'f' + i}>⛽ <b>{a.plate}</b>: потрошувачка {fq(a.avg)} л/100 км во {a.mo} (норма {fq(a.norm)}, +{fq(a.dev)}%)</div>)}
      </div>}
      {Object.keys(cash).length > 0 && <div className="callout">💰 <b>Готовина собрана од возачи, непрокнижена во благајна:</b> {Object.entries(cash).map(([k, v]) => `${k} – ${fmt(v.amt)} ден. (${v.n})`).join(' · ')} <span className="mini">– отворете го налогот → „Прокнижи во благајна“.</span></div>}
      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Документи за превоз на</b><DateJump base="/pnalozi" value={D} param="d" />
          <span className="mini">{un.length} документи со стока без патен налог (излезни, испратници, влезни)</span>
          {write && un.length > 0 && <BankForm action={travelOrderFromDayAction} className="row"><input type="hidden" name="date" value={D} /><button className="btn sm pri">🚚 Креирај патен налог за сите ({un.length})</button></BankForm>}
        </div>
        {un.length > 0 && <div className="mini" style={{ marginTop: 6 }}>{un.slice(0, 12).map((x) => `${x.no} · ${x.p}${x.addr ? ' (' + x.addr + ')' : ''}`).join(' · ')}</div>}
      </div>
      {L.length ? <div className="tw"><table><thead><tr><th>Број</th><th>Датум</th><th>Возило</th><th>Возач</th><th>Релација</th><th className="n">Застанувања</th><th className="n">Км</th><th className="n">Готовина</th><th>Статус</th><th /></tr></thead>
        <tbody>{L.map((x) => { const S = stopsOf(x); const c = S.reduce((a, s) => a + (Number(s.cash) || 0), 0); const unp = S.some((s) => Number(s.cash) > 0 && !s.cashVoucherId); const rt = S.some((s) => (s.ret ?? []).length); const st = TRAVEL_ORDER_STATUS[x.status]; return (
          <tr key={x.id}><td><b>{x.number}</b></td><td>{dmy(x.date)}</td><td>{x.plate}</td><td>{x.driver}</td><td className="mini">{x.from} → {S.map((s) => s.partner).join(' → ')}</td>
            <td className="n">{S.filter((s) => s.status === 'done').length}/{S.length}{rt && <> <span className="pill warn" title="Има поврат на стока">↩</span></>}</td><td className="n">{x.retKm && x.depKm ? fq(x.retKm - x.depKm) : ''}</td>
            <td className="n">{c ? <>{fmt(c)}{unp && <> <span className="pill warn">непрокнижено</span></>}</> : ''}</td><td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}><Link className="btn sm" href={`/pnalozi?id=${x.id}`}>Отвори</Link><Link className="btn sm" href={`/pnalozi/print?id=${x.id}`} target="_blank">PDF</Link>
              {write && (x.status === 'open' || del) && <RowAction className="btn sm ghost" style={{ color: 'var(--bad)' }} action={travelOrderStepAction.bind(null, x.id, 'del')} confirm={`Да се избрише патниот налог ${x.number}?`} label="🗑" />}</td></tr>); })}</tbody></table></div>
        : <div className="card empty">Нема патни налози за {year}.</div>}
      <p className="note">Возилата се од флотата („⛽ Гориво, сервис, дневници → 🚚 Возила“: таблица, рокови, норма на гориво, носивост, сервисни интервали), возачите од вработените. Патниот налог се пополнува автоматски од фактурите/испратниците/влезните на денот. Возачот на телефон (улога „Терен“ → „Мои патни налози“) товари со скенирање, тргнува, при испорака зема потпис, слика и готовина, бележи поврат – сè со време и GPS. Ништо од возачот не се книжи само: готовината и повратниците ги прокнижувате вие од налогот.</p>
    </>
  );
}
