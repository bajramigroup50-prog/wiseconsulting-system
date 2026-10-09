/**
 * Legacy `VIEWS.pnGorivo` 9464 → 14654 — Гориво, сервис, дневници: fuel consumption per vehicle and month vs the norm,
 * service intervals and document deadlines, domestic per diems of finished orders, and the fleet itself.
 */
import Link from 'next/link';
import { and, asc, eq, sql } from 'drizzle-orm';
import { fuelByVehicle, transportConfig, travelPerDiem } from '@wise/core/industry';
import { eventsOf, fleetVehicles, industryConfigOf, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { FleetSection } from '@/components/fleet';
import { Hd } from '@/components/hd';

const TABS = [['fuel', '⛽ Гориво'], ['svc', '🔧 Сервис и рокови'], ['dnev', '🧾 Дневници'], ['veh', '🚚 Возила']] as const;

export default async function PnGorivo({ searchParams }: { searchParams: Promise<{ t?: string; ed?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('pnGorivo', 'Гориво, сервис, дневници');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : sp.ed ? 'veh' : 'fuel';
  const V = await db().select().from(fleetVehicles).where(eq(fleetVehicles.firmId, g.firm.id)).orderBy(asc(fleetVehicles.plate));
  const O = await db().select().from(travelOrders).where(and(eq(travelOrders.firmId, g.firm.id), sql`extract(year from ${travelOrders.date}) = ${g.year}`)).orderBy(asc(travelOrders.date));
  let body: React.ReactNode;
  if (T === 'fuel') {
    const R = fuelByVehicle(O);
    body = <><div className="tw"><table><thead><tr><th>Возило</th><th className="n">Налози</th><th className="n">Км</th><th className="n">Гориво л</th><th className="n">л/100 км</th><th className="n">Норма</th><th className="n">Отстапување</th><th className="n">Гориво ден.</th><th className="n">ден./км</th></tr></thead>
      <tbody>{R.map((r) => { const v = V.find((x) => x.id === r.vehicleId); const norm = Number(v?.fuelNorm ?? 0); const dev = norm && r.avg ? Math.round((r.avg / norm - 1) * 1000) / 10 : null; return (
        <tr key={r.plate}><td><b>{r.plate}</b></td><td className="n">{r.n}</td><td className="n">{r.km}</td><td className="n">{r.l}</td><td className="n"><b>{r.avg || '—'}</b></td><td className="n">{norm || <span className="mini">внесете кај возилото</span>}</td>
          <td className="n">{dev == null ? '' : <span className={`pill ${dev > 15 ? 'bad' : dev > 5 ? 'warn' : 'good'}`}>{dev > 0 ? '+' : ''}{dev}%</span>}</td><td className="n">{fmt(r.amt)}</td><td className="n">{r.ckm ? fmt(r.ckm) : ''}</td></tr>); })}
        {!R.length && <tr><td colSpan={9} className="note">Нема завршени патни налози со километри и гориво за {g.year}.</td></tr>}</tbody></table></div>
      <p className="note">Потрошувачката се пресметува од завршените патни налози (км при тргнување/враќање и наточено гориво). ⚠ над 15% од нормата.</p></>;
  } else if (T === 'svc') {
    const odo = (id: string) => Math.max(Number(V.find((v) => v.id === id)?.odo ?? 0), ...O.filter((o) => o.vehicleId === id).map((o) => Math.max(o.retKm ?? 0, o.depKm ?? 0)));
    const dd = (d: string | null) => { if (!d) return <span className="mini">—</span>; const n = Math.round((Date.parse(d) - Date.now()) / 864e5); return <span className={`pill ${n < 0 ? 'bad' : n <= 30 ? 'warn' : 'good'}`}>{dmy(d)}</span>; };
    const iv = (every: number | null, last: number | null, km: number) => { if (!every) return <span className="mini">внесете интервал</span>; const left = (last ?? 0) + every - km; return <span className={`pill ${left < 0 ? 'bad' : left < 1000 ? 'warn' : 'good'}`}>{left < 0 ? `поминат ${-left} км` : `за ${left} км`}</span>; };
    body = <div className="tw"><table><thead><tr><th>Возило</th><th className="n">Километража</th><th>Сервис (масло)</th><th>Гуми</th><th>Регистрација</th><th>Осигурување</th><th>Технички</th></tr></thead>
      <tbody>{V.map((v) => { const km = odo(v.id); return <tr key={v.id}><td><b>{v.plate}</b> <span className="mini">{v.name}</span></td><td className="n">{km}</td><td>{iv(v.oilEvery, v.oilLastKm, km)}</td><td>{iv(v.tyreEvery, v.tyreLastKm, km)}</td><td>{dd(v.regExp)}</td><td>{dd(v.insExp)}</td><td>{dd(v.techExp)}</td></tr>; })}</tbody></table></div>;
  } else if (T === 'dnev') {
    const cfg = transportConfig(industryConfigOf(g.firm, 'transport'));
    const R = O.filter((x) => x.status === 'done' && x.dnev).map((x) => ({ x, d: travelPerDiem({ dnev: true, events: eventsOf(x) }, cfg)! }));
    body = <><div className="tw"><table><thead><tr><th>Налог</th><th>Датум</th><th>Возач</th><th className="n">Часови</th><th className="n">%</th><th className="n">Износ</th></tr></thead>
      <tbody>{R.map(({ x, d }) => <tr key={x.id}><td><Link href={`/pnalozi?id=${x.id}`}>{x.number}</Link></td><td>{dmy(x.date)}</td><td>{x.driver}</td><td className="n">{d.hrs != null ? Math.round(d.hrs * 10) / 10 : '—'}</td><td className="n">{d.pct}%</td><td className="n">{fmt(d.amt)}</td></tr>)}
        <tr><td colSpan={5}><b>Вкупно</b></td><td className="n"><b>{fmt(R.reduce((s, r) => s + r.d.amt, 0))}</b></td></tr></tbody></table></div>
      <p className="note">Домашна дневница: 100% над 12 часа, 50% од 8 до 12 часа (износ во „⚙ Стандардно“ кај патните налози: {fmt(cfg.dnevAmt || 0)} ден.).</p></>;
  } else body = <FleetSection V={V} ed={sp.ed} base="/pnGorivo" write={g.write} rent={false} />;
  return (
    <>
      <Hd t="Гориво, сервис, дневници" sub={String(g.year)}><Link className="btn" href="/pnalozi">🚚 Патни налози</Link></Hd>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={`/pnGorivo?t=${k}`}>{n}</Link>)}</div>
      {body}
    </>
  );
}
