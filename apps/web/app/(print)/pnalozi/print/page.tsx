/**
 * Legacy `pnPdfHTML` 9319: ПАТЕН НАЛОГ ЗА ТОВАРНО ВОЗИЛО — firm, vehicle, driver / co-driver, route, purpose, departure
 * and return (time + km), km / duration, fuel (l/100 km), peak load, per diem, the stops with goods, time + GPS,
 * cash / returns and the receiver's signature; signatures „Издал налогот“ / „Возач“.
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { hoursMinutes, orderKm, skDateTime, transportConfig, travelDuration, travelLoad, travelPerDiem } from '@wise/core/industry';
import { eventsOf, industryConfigOf, stopsOf, travelItemInfo, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt, fq } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function TravelOrderPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('pnalozi', 'Патен налог');
  if (g.blocked || !id || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [x] = await db().select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, g.firm.id))).limit(1);
  if (!x) notFound();
  const S = stopsOf(x), E = eventsOf(x);
  const dn = travelPerDiem({ dnev: x.dnev, events: E }, transportConfig(industryConfigOf(g.firm, 'transport')));
  const info = await travelItemInfo(db(), g.firm.id, S.flatMap((s) => s.goods.map((g2) => g2.itemId)));
  const ld = travelLoad(S, (g2) => ((g2.itemId ? info.get(g2.itemId)?.kg : 0) || Number(g2.kg) || 0) * (Number(g2.qty) || 0));
  const km = orderKm(x);
  const dur = travelDuration(E);
  const dep = E.find((e) => e.k === 'dep'), ret = [...E].reverse().find((e) => e.k === 'ret');
  return (
    <>
      <DocHead firm={g.firm} title="ПАТЕН НАЛОГ ЗА ТОВАРНО ВОЗИЛО" sub={`бр. ${x.number} од ${dmy(x.date)}`} />
      <table><tbody>
        <tr><td style={{ width: '28%' }}>Возило / регистарска таблица</td><td><b>{x.plate}</b> {x.vname}</td></tr>
        <tr><td>Возач</td><td><b>{x.driver}</b>{x.codriver ? ` · сопатник: ${x.codriver}` : ''}</td></tr>
        <tr><td>Релација</td><td>{x.from} → {S.map((s) => s.partner + (s.addr ? ` (${s.addr})` : '')).join(' → ')} → {x.from}</td></tr>
        <tr><td>Цел на патувањето</td><td>{x.purpose}</td></tr>
        <tr><td>Тргнување</td><td>{dep ? skDateTime(dep.at) : '_____________'} · км {x.depKm ?? '_______'}</td></tr>
        <tr><td>Враќање</td><td>{ret ? skDateTime(ret.at) : '_____________'} · км {x.retKm ?? '_______'}</td></tr>
        <tr><td>Изминати км / траење</td><td>{km ? fq(km) : '_______'}{dur != null ? ` · ${hoursMinutes(dur)}` : ''}</td></tr>
        <tr><td>Гориво</td><td>{x.fuelL ? `${fq(Number(x.fuelL))} л` : '_______ л'}{x.fuelAmt ? ` · ${fmt(x.fuelAmt)} ден.` : ''}{km && Number(x.fuelL) ? ` · ${fq(Math.round((Number(x.fuelL) / km) * 10000) / 100)} л/100 км` : ''}</td></tr>
        {ld.peak > 0 && <tr><td>Товар (најмногу)</td><td>{fq(ld.peak)} кг</td></tr>}
        {dn && <tr><td>Дневница</td><td>{dn.pct}% · {fmt(dn.amt)} ден.</td></tr>}
      </tbody></table>
      <h2>Застанувања (преземање / испорака)</h2>
      <table><thead><tr><th>Р.бр</th><th>Вид</th><th>Комитент / адреса</th><th>Документ</th><th>Стока</th><th>Време</th><th>Наплата / поврат</th><th>Предал / примил (потпис)</th></tr></thead>
        <tbody>{S.map((s, i) => (
          <tr key={i}><td>{i + 1}</td><td>{s.kind === 'pick' ? 'Преземање' : 'Испорака'}</td><td>{s.partner}<br /><small>{s.addr}</small></td><td>{s.doc}</td>
            <td style={{ fontSize: '8pt' }}>{s.goods.map((g2, k) => <div key={k}>{g2.name}{g2.qty !== '' ? ` – ${fq(Number(g2.qty))} ${g2.unit ?? ''}` : ''}</div>)}</td>
            <td>{s.status === 'done' ? <>{skDateTime(s.at).slice(11)}{s.geo && <><br /><small>{s.geo.lat}, {s.geo.lon}</small></>}</> : ''}</td>
            <td style={{ fontSize: '8pt' }}>{Number(s.cash) ? `готовина ${fmt(s.cash)}` : ''}{(s.ret ?? []).filter((r) => Number(r.qty)).map((r, k) => <div key={k}>↩ {s.goods[r.k]?.name ?? ''} {fq(r.qty)}</div>)}</td>
            <td style={{ minWidth: '30mm' }}>{s.recv}{s.sig && <><br /><img src={`/api/files/${s.sig}`} alt="" style={{ height: 28 }} /></>}</td></tr>))}</tbody></table>
      <Signs L={['Издал налогот', 'Возач']} />
    </>
  );
}
