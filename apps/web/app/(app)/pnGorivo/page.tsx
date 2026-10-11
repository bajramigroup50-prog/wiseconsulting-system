/**
 * Legacy `VIEWS.pnGorivo` 9464 + patch 14654 — Гориво, сервис и дневници: fuel consumption per vehicle (click → per
 * month, ⚠ months over the norm), service intervals with „✓ Направен сега“ and document deadlines, domestic per diems
 * of finished orders with the per-driver / month summary and the PDF, and the fleet itself (with Excel import).
 * When the freight module is on, the patch adds the buttons to it and the „сопствена дистрибуција“ hint.
 */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { daysTo, fuelRows, hoursMinutes, moduleOn, perDiemByDriverMonth, perDiemRows, serviceLeftText, skDateTime, transportConfig, vehicleOdo, vehicleService } from '@wise/core/industry';
import { eventsOf, fleetVehicles, industryConfigOf, TRAVEL_VEHICLE_COLUMNS, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { industryPage, today } from '@/lib/industry';
import { FleetSection } from '@/components/fleet';
import { Hd } from '@/components/hd';
import { BankForm } from '@/components/bank-form';
import { XlsxImport } from '@/components/list-tools';
import { importVehiclesAction, serviceDoneAction } from './actions';

const TABS = [['fuel', '⛽ Гориво'], ['svc', '🔧 Сервис и рокови'], ['dnev', '🧾 Дневници'], ['veh', '🚚 Возила']] as const;

export default async function PnGorivo({ searchParams }: { searchParams: Promise<{ t?: string; ed?: string; v?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('pnGorivo', 'Гориво, сервис и дневници');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : sp.ed ? 'veh' : 'fuel';
  const TD = today();
  const V = await db().select().from(fleetVehicles).where(eq(fleetVehicles.firmId, g.firm.id)).orderBy(asc(fleetVehicles.plate));
  const Oall = await db().select().from(travelOrders).where(eq(travelOrders.firmId, g.firm.id)).orderBy(asc(travelOrders.date));
  const O = Oall.filter((o) => o.date.slice(0, 4) === String(g.year));
  const cfg = transportConfig(industryConfigOf(g.firm, 'transport'));
  let body: React.ReactNode;
  if (T === 'fuel') {
    const R = fuelRows(O, V);
    const sel = R.find((r) => (r.vehicleId || r.plate) === sp.v) ?? R[0];
    body = <>{R.length ? <>
      <div className="tw"><table><thead><tr><th>Возило</th><th className="n">Налози</th><th className="n">Км</th><th className="n">Гориво л</th><th className="n">л/100 км</th><th className="n">Норма</th><th className="n">Отстапување</th><th className="n">Гориво ден.</th><th className="n">ден./км</th></tr></thead>
        <tbody>{R.map((r) => (
          <tr key={r.plate} style={r === sel ? { background: 'var(--accent-soft)' } : undefined}><td><Link href={`/pnGorivo?t=fuel&v=${encodeURIComponent(r.vehicleId || r.plate)}`}><b>{r.plate}</b></Link> <span className="mini">{r.name}</span></td><td className="n">{r.n}</td><td className="n">{fq(r.km)}</td><td className="n">{fq(r.l)}</td><td className="n"><b>{r.avg ? fq(r.avg) : '—'}</b></td>
            <td className="n">{r.norm ? fq(r.norm) : <span className="mini">внесете кај возилото</span>}</td><td className="n">{r.dev == null ? '' : <span className={`pill ${r.dev > 15 ? 'bad' : r.dev > 5 ? 'warn' : 'good'}`}>{r.dev > 0 ? '+' : ''}{fq(r.dev)}%</span>}</td><td className="n">{fmt(r.amt)}</td><td className="n">{r.ckm ? fmt(r.ckm) : ''}</td></tr>))}</tbody></table></div>
      {sel && <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{sel.plate} – по месеци</h2><div className="tw"><table className="dense"><thead><tr><th>Месец</th><th className="n">Налози</th><th className="n">Км</th><th className="n">Гориво л</th><th className="n">л/100 км</th><th className="n">Гориво ден.</th><th className="n">ден./км</th></tr></thead>
        <tbody>{sel.months.map((m) => <tr key={m.mo}><td>{m.mo.slice(5)}/{m.mo.slice(0, 4)}</td><td className="n">{m.n}</td><td className="n">{fq(m.km)}</td><td className="n">{fq(m.l)}</td><td className="n" style={m.bad ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{m.avg ? fq(m.avg) : '—'}{m.bad ? ' ⚠' : ''}</td><td className="n">{fmt(m.amt)}</td><td className="n">{m.ckm ? fmt(m.ckm) : ''}</td></tr>)}</tbody></table></div></div>}
    </> : <div className="card empty">Нема завршени патни налози со километри и гориво за {g.year}.</div>}
      <p className="note">Потрошувачката се пресметува од завршените патни налози (км при тргнување/враќање и наточено гориво). Наточеното гориво не е секогаш потрошено на истото патување, затоа споредбата е по месец и вкупно. ⚠ = над 15% од нормата (норма се внесува кај возилото во „🚚 Возила“) при најмалку 200 км во месецот.</p></>;
  } else if (T === 'svc') {
    const dd = (d: string | null) => { if (!d) return <span className="mini">—</span>; const n = daysTo(d, TD)!; return <><span className={`pill ${n < 0 ? 'bad' : n <= 30 ? 'warn' : 'good'}`}>{dmy(d)}</span>{n <= 30 && <div className="mini">{n < 0 ? 'истечено' : `за ${n} дена`}</div>}</>; };
    body = V.length ? <><div className="tw"><table><thead><tr><th>Возило</th><th className="n">Километража</th><th>Сервис (масло)</th><th>Гуми</th><th>Регистрација</th><th>Осигурување</th><th>Технички</th></tr></thead>
      <tbody>{V.filter((v) => !v.trailer).map((v) => {
        const odo = vehicleOdo(v.id, Oall, v.odo);
        const sv = vehicleService(v, odo);
        const cell = (t: 'oil' | 'tyre') => {
          const s = sv.find((z) => z.t === t);
          if (!s) return <span className="mini">внесете интервал кај возилото</span>;
          return <><span className={`pill ${s.st}`}>{serviceLeftText(s.left, fq, false)}</span><div className="mini">следен на {fq(s.due)} км</div>
            {g.write && <BankForm action={serviceDoneAction} className="row" style={{ gap: 4, alignItems: 'center' }}><input type="hidden" name="veh" value={v.id} /><input type="hidden" name="t" value={t} />
              <input name="km" type="number" defaultValue={odo || ''} title={`Километража при ${t === 'oil' ? 'сервисот' : 'замената на гумите'}`} style={{ width: 90 }} /><button className="btn sm">✓ Направен сега</button></BankForm>}</>;
        };
        return <tr key={v.id}><td><b>{v.plate}</b> <span className="mini">{v.name}</span>{v.capKg ? <div className="mini">носивост {fq(v.capKg)} кг</div> : null}</td><td className="n">{odo ? `${fq(odo)} км` : '—'}</td><td>{cell('oil')}</td><td>{cell('tyre')}</td><td>{dd(v.regExp)}</td><td>{dd(v.insExp)}</td><td>{dd(v.techExp)}</td></tr>;
      })}</tbody></table></div>
      <p className="note">Километражата е најголемата од патните налози (км при враќање). Интервалите (на пр. масло на секои 15.000 км, гуми на 40.000 км) и километражата при последниот сервис се внесуваат кај возилото („🚚 Возила“); „✓ Направен сега“ ја запишува тековната километража како последен сервис. Предупредување се прикажува 1.000 км порано и во „Патни налози“.</p></>
      : <div className="card empty">Нема возила. Внесете ги во „🚚 Возила“.</div>;
  } else if (T === 'dnev') {
    const R = perDiemRows(O.map((x) => ({ ...x, events: eventsOf(x) })), cfg);
    const by = perDiemByDriverMonth(R);
    body = <>{!Number(cfg.dnevAmt) && <div className="callout warn">Не е внесен износот на полна дневница – „Патни налози → ⚙ Стандардно“.</div>}
      {R.length ? <><div className="tw"><table className="dense"><thead><tr><th>Датум</th><th>Налог</th><th>Возач</th><th>Тргнување</th><th>Враќање</th><th className="n">Траење</th><th className="n">%</th><th className="n">Износ</th></tr></thead>
        <tbody>{R.map(({ x, d, dep, ret }) => <tr key={x.id}><td>{dmy(x.date)}</td><td><Link href={`/pnalozi?id=${x.id}`}>{x.number}</Link></td><td>{x.driver}</td><td>{skDateTime(dep).slice(11)}</td><td>{skDateTime(ret).slice(11)}</td><td className="n">{hoursMinutes(d.hrs)}</td><td className="n">{d.pct}%</td><td className="n">{fmt(d.amt)}</td></tr>)}
          <tr><td colSpan={7}><b>Вкупно</b></td><td className="n"><b>{fmt(R.reduce((s, r) => s + r.d.amt, 0))}</b></td></tr></tbody></table></div>
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Збир по возач и месец (за пресметка на плата)</h2><table className="dense"><thead><tr><th>Возач</th><th>Месец</th><th className="n">Патувања</th><th className="n">Дневници ден.</th></tr></thead>
          <tbody>{by.map((r) => <tr key={r.dr + r.mo}><td>{r.dr}</td><td>{r.mo.slice(5)}/{r.mo.slice(0, 4)}</td><td className="n">{r.n}</td><td className="n"><b>{fmt(r.amt)}</b></td></tr>)}</tbody></table></div></>
        : <div className="card empty">Нема завршени налози означени како службено патување.</div>}
      <p className="note">Пресметка: време од „Тргнав“ до „Вратен“ (GPS-потврдено на телефонот на возачот); 8–12 часа = 50%, над 12 часа = 100% од полната дневница ({fmt(Number(cfg.dnevAmt) || 0)} ден.). Дневницата се исплаќа со налог за службено патување и се книжи при исплата како трошок за службено патување (конто според вашиот контен план) – проверете ги износот и правилата со вашиот акт и важечките прописи.</p></>;
  } else body = <>
    {g.write && <div className="row" style={{ gap: 8, marginBottom: 8 }}><XlsxImport action={importVehiclesAction} template={[[...TRAVEL_VEHICLE_COLUMNS], ['SK-1234-AB', 'Iveco Daily', 125000, 11.5, 1500, 15000, 120000, 40000, 100000, '31.12.2026', '31.12.2026', '30.06.2026']]} templateName="Vozila_obrazec.xlsx" label="📥 Увоз на возила од Excel" /></div>}
    <FleetSection V={V} ed={sp.ed} base="/pnGorivo" write={g.write} rent={false} /></>;
  const frt = moduleOn(g.firm.mods, 'frt');
  return (
    <>
      <Hd t="Гориво, сервис и дневници" sub={String(g.year)}>
        {frt && <><Link className="btn" href="/frTuri" title="Превоз за трети лица">🚛 Тури</Link><Link className="btn" href="/frDnev">🌍 Дневници во странство</Link><Link className="btn" href="/frGor">⛽ Картички за гориво</Link></>}
        <Link className="btn" href="/pnalozi">🚚 Патни налози</Link>
        {T === 'dnev' && <Link className="btn" href={`/pnGorivo/dnevnici?y=${g.year}`} target="_blank">PDF</Link>}
      </Hd>
      {frt && <div className="callout frHint" style={{ marginBottom: 10 }}>Оваа страница е за <b>сопствена дистрибуција</b> (патни налози). За <b>превоз за трети лица</b> – тури, CMR, дневници во странство и картички за гориво – користете ги копчињата горе.</div>}
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={`/pnGorivo?t=${k}`}>{n}</Link>)}</div>
      {body}
    </>
  );
}
