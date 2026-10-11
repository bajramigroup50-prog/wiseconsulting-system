/**
 * Legacy `VIEWS.rentIzv` 9844 → 11778 / 11805 — Rent-a-car – извештаи: tabs 🚗 По возило (rentals, days, utilisation,
 * revenue, km, service and deadlines), 📅 По месец (utilisation of the fleet, revenue, of which not invoiced, average
 * per day, km, bar), 👤 Клиенти и држави (clients, countries of travel, nationalities), ⚠ Отворени ставки (late returns,
 * vehicles abroad, returned without invoice, unpaid invoices, open deposits, documents expiring before the return).
 */
import Link from 'next/link';
import { rentByMonth, rentClients, rentCountryName, rentInPeriod, rentOpenItems, rentServiceText } from '@wise/core/industry';
import { rentReport, rentReportRows } from '@wise/db';
import { inYearOr } from '@/lib/books';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { industryPage, nowLocal, today } from '@/lib/industry';
import { Hd } from '@/components/hd';

const TABS = [['veh', '🚗 По возило'], ['mon', '📅 По месец'], ['cli', '👤 Клиенти и држави'], ['open', '⚠ Отворени ставки']] as const;
const mo = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function RentIzv({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; t?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('rentIzv', 'Rent-a-car – извештаи');
  if (g.blocked) return g.blocked;
  const T = TABS.some((x) => x[0] === sp.t) ? sp.t! : 'veh';
  const a = inYearOr(sp.a, g.year, `${g.year}-01-01`);
  const b = inYearOr(sp.b, g.year, String(g.year) === today().slice(0, 4) ? today() : `${g.year}-12-31`);
  const q = (t: string) => `/rentIzv?t=${t}&a=${a}&b=${b}`;
  let body: React.ReactNode;
  if (T === 'veh') {
    const R = await db().transaction((tx) => rentReport(tx, g.firm.id, a, b));
    const nd = Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
    const tot = R.reduce((s, x) => ({ n: s.n + x.n, days: s.days + x.days, rev: s.rev + x.rev, km: s.km + x.km }), { n: 0, days: 0, rev: 0, km: 0 });
    body = <><div className="tw"><table><thead><tr><th>Возило</th><th className="n">Изнајмувања</th><th className="n">Изнајмени денови</th><th className="n">Искористеност</th><th className="n">Приход без ДДВ</th><th className="n">Приход / ден</th><th className="n">Км</th><th>Сервис и рокови</th></tr></thead>
      <tbody>{R.map((x) => { const sv = rentServiceText(x.v, today()); return (
        <tr key={x.v.id}><td><b>{x.v.plate}</b> <span className="mini">{x.v.name}</span></td><td className="n">{x.n}</td><td className="n">{x.days}</td>
          <td className="n"><span className={`pill ${x.util >= 60 ? 'good' : x.util >= 30 ? 'warn' : 'bad'}`}>{x.util}%</span></td><td className="n">{fmt(x.rev)}</td><td className="n">{x.days ? fmt(x.rev / x.days) : ''}</td><td className="n">{x.km ? fq(x.km) : ''}</td>
          <td className="mini">{sv.length ? sv.join(' · ') : <span className="pill good">во ред</span>}</td></tr>); })}
        <tr><td><b>Вкупно</b></td><td className="n">{tot.n}</td><td className="n">{tot.days}</td><td className="n">{R.length && nd ? Math.round((tot.days / (nd * R.length)) * 100) + '%' : ''}</td><td className="n"><b>{fmt(tot.rev)}</b></td><td className="n">{tot.days ? fmt(tot.rev / tot.days) : ''}</td><td className="n">{fq(tot.km)}</td><td /></tr>
      </tbody></table></div>
      <p className="note">Искористеност = изнајмени денови / денови во периодот. Приходот е од фактурите издадени од договорите.</p></>;
  } else {
    const all = await db().transaction((tx) => rentReportRows(tx, g.firm.id));
    const L = rentInPeriod(all, a, b);
    if (T === 'mon') {
      const nV = new Set(all.map((r) => r.plate)).size;
      const M = rentByMonth(L, nV);
      body = <><div className="tw"><table><thead><tr><th>Месец</th><th className="n">Изнајмувања</th><th className="n">Денови</th><th className="n">Искористеност на флотата</th><th className="n">Приход без ДДВ</th><th className="n">од тоа нефактурирано</th><th className="n">Просек / ден</th><th className="n">Км</th><th style={{ width: '22%' }} /></tr></thead>
        <tbody>{M.map((o) => <tr key={o.mo}><td><b>{mo(o.mo)}</b></td><td className="n">{o.n}</td><td className="n">{o.days}</td><td className="n">{o.util != null ? o.util + '%' : ''}</td><td className="n"><b>{fmt(o.net)}</b></td><td className="n">{o.est ? fmt(o.est) : ''}</td><td className="n">{o.perDay != null ? fmt(o.perDay) : ''}</td><td className="n">{o.km ? fq(o.km) : ''}</td>
          <td><div style={{ height: 10, borderRadius: '0 4px 4px 0', background: 'var(--accent)', width: `${o.bar}%` }} /></td></tr>)}
          {!M.length && <tr><td colSpan={9} className="note">Нема изнајмувања во периодот.</td></tr>}
          {M.length > 0 && <tr><td><b>Вкупно</b></td><td className="n">{M.reduce((s, o) => s + o.n, 0)}</td><td className="n">{M.reduce((s, o) => s + o.days, 0)}</td><td /><td className="n"><b>{fmt(M.reduce((s, o) => s + o.net, 0))}</b></td><td className="n">{fmt(M.reduce((s, o) => s + o.est, 0))}</td><td /><td className="n">{fq(M.reduce((s, o) => s + o.km, 0))}</td><td /></tr>}
        </tbody></table></div>
        <p className="note">Месецот е според датумот на преземање. „Нефактурирано“ = вратени или тековни договори без издадена фактура (пресметано од договорот).</p></>;
    } else if (T === 'cli') {
      const X = rentClients(L);
      body = <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 2, minWidth: 420 }}><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Клиенти ({X.clients.length})</h2>
          <div className="tw"><table className="dense"><thead><tr><th>Клиент</th><th>Телефон</th><th className="n">Изнајмувања</th><th className="n">Денови</th><th className="n">Приход без ДДВ</th></tr></thead>
            <tbody>{X.clients.map((o, i) => <tr key={i}><td>{o.firm ? '🏢 ' : ''}{o.name || '—'}{o.n > 1 && <> <span className="pill good">постојан</span></>}</td><td>{o.ph}</td><td className="n">{o.n}</td><td className="n">{o.days}</td><td className="n">{fmt(o.net)}</td></tr>)}
              {!X.clients.length && <tr><td colSpan={5} className="note">Нема податоци.</td></tr>}</tbody></table></div></div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>🌍 Државите на патување</h2><table className="dense"><tbody>{X.countries.map(([c, n]) => <tr key={c}><td>{rentCountryName(c)}</td><td className="n">{n}</td></tr>)}{!X.countries.length && <tr><td className="note">—</td></tr>}</tbody></table></div>
          <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>Државјанство на корисниците</h2><table className="dense"><tbody>{X.nationalities.map(([c, x]) => <tr key={c}><td>{c}</td><td className="n">{x.n}</td><td className="n">{fmt(x.net)}</td></tr>)}</tbody></table></div>
        </div></div>;
    } else {
      const O = rentOpenItems(all, nowLocal());
      const op = (id: string) => <td><Link className="btn sm" href={`/rent?id=${id}`}>Отвори</Link></td>;
      const sec = (t: string, cls: string, n: number, head: string[], rows: React.ReactNode) => (
        <div className="card"><h2 style={{ fontSize: 15, margin: '0 0 6px' }}>{t} <span className={`pill ${n ? cls : 'good'}`}>{n}</span></h2>
          {n ? <div className="tw"><table className="dense"><thead><tr>{head.map((x) => <th key={x}>{x}</th>)}<th /></tr></thead><tbody>{rows}</tbody></table></div> : <p className="note">Нема.</p>}</div>);
      body = <>
        {sec('⏰ Задоцнети враќања', 'bad', O.late.length, ['Договор', 'Возило', 'Корисник', 'Телефон', 'Требаше', 'Доцни'], O.late.map(({ r, hours }) => <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td>{r.driver.phone}</td><td>{dmy(r.to.slice(0, 10))} {r.to.slice(11, 16)}</td><td><b>{hours} ч.</b></td>{op(r.id)}</tr>))}
        {sec('🌍 Возила моментално во странство', 'warn', O.abroad.length, ['Договор', 'Возило', 'Корисник', 'Држави', 'Зелен картон', 'Враќање'], O.abroad.map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td>{r.countries.filter((c) => c !== 'MK').map(rentCountryName).join(', ')}</td><td>{r.green ? <span className="pill good">да</span> : <span className="pill bad">не</span>}</td><td>{dmy(r.to.slice(0, 10))}</td>{op(r.id)}</tr>))}
        {sec('🧾 Вратени возила без фактура', 'warn', O.noInv.length, ['Договор', 'Возило', 'Корисник', 'Вратено', 'Износ'], O.noInv.map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td>{dmy(String(r.retAt || r.to).slice(0, 10))}</td><td className="n">{fmt(r.tot)}</td>{op(r.id)}</tr>))}
        {sec('💳 Неплатени фактури', 'warn', O.unpaid.length, ['Договор', 'Фактура', 'Корисник', 'Телефон', 'Износ', 'Платено', 'Долг'], O.unpaid.map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.invNumber}</td><td>{r.driver.name}</td><td>{r.driver.phone}</td><td className="n">{fmt(r.gross)}</td><td className="n">{fmt(r.paid)}</td><td className="n"><b>{fmt(r.gross - r.paid)}</b></td>{op(r.id)}</tr>))}
        {sec('💰 Примени кауции – непорамнети', 'warn', O.deposits.length, ['Договор', 'Возило', 'Корисник', 'Кауција', 'Статус'], O.deposits.map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.plate}</td><td>{r.driver.name}</td><td className="n">{fmt(r.deposit)}</td><td>{r.status}</td>{op(r.id)}</tr>))}
        {sec('🪪 Документ / возачка истекува пред враќањето', 'bad', O.docs.length, ['Договор', 'Корисник', 'Документ до', 'Возачка до', 'Враќање'], O.docs.map((r) => <tr key={r.id}><td>{r.number}</td><td>{r.driver.name}</td><td>{dmy(r.driver.docExp ?? '')}</td><td>{dmy(r.driver.licExp ?? '')}</td><td>{dmy(r.to.slice(0, 10))}</td>{op(r.id)}</tr>))}
      </>;
    }
  }
  return (
    <>
      <Hd t="Rent-a-car – извештаи" sub={T === 'open' ? `состојба ${dmy(today())}` : `${dmy(a)} – ${dmy(b)}`}><Link className="btn" href="/rent">🚗 Резервации</Link></Hd>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>{TABS.map(([k, n]) => <Link key={k} className={`btn ${T === k ? 'pri' : ''}`} href={q(k)}>{n}</Link>)}</div>
      {T !== 'open' && <form className="row" style={{ gap: 8, marginBottom: 8 }} action="/rentIzv">
        <input type="hidden" name="t" value={T} />
        <label className="mini">од <input name="a" type="date" defaultValue={a} style={{ width: 'auto' }} /></label>
        <label className="mini">до <input name="b" type="date" defaultValue={b} style={{ width: 'auto' }} /></label><button className="btn sm">Прикажи</button>
      </form>}
      {body}
    </>
  );
}
