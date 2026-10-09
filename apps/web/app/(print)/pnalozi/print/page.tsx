/** Legacy `pnPdfHTML` (9306): патен налог with stops, km, fuel, events and the domestic per diem. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { transportConfig, travelPerDiem } from '@wise/core/industry';
import { eventsOf, industryConfigOf, stopsOf, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function TravelOrderPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('pnalozi', 'Патен налог');
  if (g.blocked || !id) notFound();
  const [x] = await db().select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, g.firm.id))).limit(1);
  if (!x) notFound();
  const S = stopsOf(x), E = eventsOf(x);
  const dn = travelPerDiem({ dnev: x.dnev, events: E }, transportConfig(industryConfigOf(g.firm, 'transport')));
  return (
    <>
      <DocHead firm={g.firm} title={`ПАТЕН НАЛОГ бр. ${x.number}`} sub={dmy(x.date)} />
      <table><tbody>
        <tr><td style={{ width: '30%' }}>Возило</td><td><b>{x.plate}</b> {x.vname}</td></tr>
        <tr><td>Возач</td><td>{x.driver}{x.codriver ? ` · совозач ${x.codriver}` : ''}</td></tr>
        <tr><td>Релација</td><td>{x.from} → {S.map((s) => s.partner).join(' → ')}</td></tr>
        <tr><td>Цел</td><td>{x.purpose}</td></tr>
        <tr><td>Км</td><td>тргнување {x.depKm ?? '—'} · враќање {x.retKm ?? '—'}{x.depKm && x.retKm ? ` · поминати ${x.retKm - x.depKm}` : ''}</td></tr>
        <tr><td>Гориво</td><td>{x.fuelL ?? '—'} л · {x.fuelAmt ? fmt(x.fuelAmt) + ' ден.' : '—'}</td></tr>
        {dn && <tr><td>Дневница</td><td>{dn.hrs != null ? `${Math.floor(dn.hrs)} ч ${Math.round((dn.hrs % 1) * 60)} мин · ${dn.pct}% · ${fmt(dn.amt)} ден.` : 'нема евидентирано тргнување/враќање'}</td></tr>}
      </tbody></table>
      <h2>Застанувања</h2>
      <table><thead><tr><th>Р.бр</th><th>Вид</th><th>Документ</th><th>Комитент / адреса</th><th>Стока</th><th>Примил / време</th><th className="n">Готовина</th></tr></thead>
        <tbody>{S.map((s, i) => <tr key={i}><td>{i + 1}</td><td>{s.kind === 'pick' ? 'преземање' : 'испорака'}</td><td>{s.doc}</td><td>{s.partner}<div className="mini">{s.addr}</div></td><td className="mini">{s.goods.map((g2) => `${g2.name} ${g2.qty}`).join(', ')}</td>
          <td>{s.recv}{s.at ? <div className="mini">{new Date(s.at).toLocaleString('mk-MK', { timeZone: 'Europe/Skopje' })}</div> : null}</td><td className="n">{s.cash ? fmt(s.cash) : ''}</td></tr>)}</tbody></table>
      <Signs L={['Издал', 'Возач']} />
    </>
  );
}
