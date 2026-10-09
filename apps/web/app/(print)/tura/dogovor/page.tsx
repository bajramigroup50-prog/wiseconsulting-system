/**
 * Legacy `tbPdfHTML` (travel contract of a booking) and `taProgHTML` + `taPaxHTML` (programme and passenger list of
 * an arrangement): `?id=<booking>` or `?arr=<arrangement>`.
 */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { bookingPax, bookingTotal, nationalityName } from '@wise/core/industry';
import { firmTravelConfig, travelArrangements, travelBookings } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function TravelPrint({ searchParams }: { searchParams: Promise<{ id?: string; arr?: string }> }) {
  const sp = await searchParams;
  const g = await industryPage('tura', 'Договор за патување');
  if (g.blocked) notFound();
  const C = firmTravelConfig(g.firm);
  const [b] = sp.id ? await db().select().from(travelBookings).where(and(eq(travelBookings.id, sp.id), eq(travelBookings.firmId, g.firm.id))).limit(1) : [];
  const aid = b?.arrangementId ?? sp.arr;
  if (!aid) notFound();
  const [A] = await db().select().from(travelArrangements).where(and(eq(travelArrangements.id, aid), eq(travelArrangements.firmId, g.firm.id))).limit(1);
  if (!A) notFound();
  const prog = (
    <>
      <table><tbody><tr><td style={{ width: '30%' }}>Аранжман</td><td><b>{A.code} {A.name}</b></td></tr><tr><td>Дестинација</td><td>{A.dest}</td></tr><tr><td>Период</td><td>{dmy(A.from)} – {dmy(A.to)}</td></tr></tbody></table>
      {A.prog && <><h2>Програма</h2><div style={{ whiteSpace: 'pre-line' }}>{A.prog}</div></>}
      {A.incl && <><h2>Цената вклучува</h2><div style={{ whiteSpace: 'pre-line' }}>{A.incl}</div></>}
      {A.excl && <><h2>Цената не вклучува</h2><div style={{ whiteSpace: 'pre-line' }}>{A.excl}</div></>}
    </>
  );
  if (!b) {
    const B = (await db().select().from(travelBookings).where(eq(travelBookings.arrangementId, A.id))).filter((x) => x.status !== 'cancel');
    const pax = B.flatMap((x) => (x.pax.length ? x.pax : [{ name: x.client.name }]).map((p) => ({ ...p, bk: x.number, phone: x.client.phone })));
    return (
      <>
        <DocHead firm={g.firm} title="ПРОГРАМА НА ПАТУВАЊЕ" sub={A.code} />
        {prog}
        <h2>Листа на патници ({pax.length})</h2>
        <table><thead><tr><th>Р.бр</th><th>Име и презиме</th><th>Датум на раѓање</th><th>Државјанство</th><th>Пасош</th><th>Важи до</th><th>Пријава</th><th>Телефон</th></tr></thead>
          <tbody>{pax.map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td>{dmy((p as { birth?: string }).birth)}</td><td>{nationalityName((p as { nat?: string }).nat)}</td><td>{(p as { doc?: string }).doc}</td><td>{dmy((p as { docExp?: string }).docExp)}</td><td>{p.bk}</td><td>{p.phone}</td></tr>)}</tbody></table>
      </>
    );
  }
  return (
    <>
      <DocHead firm={g.firm} title="ДОГОВОР ЗА ПАТУВАЊЕ" sub={`бр. ${b.number} од ${dmy(b.date)}${C.lic ? ' · лиценца ' + C.lic : ''}`} />
      <table><tbody>
        <tr><td style={{ width: '30%' }}>Патник (носител)</td><td><b>{b.client.name}</b> {b.client.addr} {b.client.phone ? '· ' + b.client.phone : ''}</td></tr>
        <tr><td>Број на патници</td><td>{bookingPax(b)} ({b.adults} возрасни, {b.children} деца)</td></tr>
        <tr><td>Цена</td><td><b>{fmt(bookingTotal(b, A))} ден.</b> · уплатено {fmt(b.pays.reduce((s, p) => s + p.amt, 0))}</td></tr>
      </tbody></table>
      {prog}
      {b.pax.length > 0 && <><h2>Патници</h2><table><tbody>{b.pax.map((p, i) => <tr key={i}><td>{p.name}</td><td>{dmy(p.birth)}</td><td>{p.doc}</td></tr>)}</tbody></table></>}
      {C.guar && <p><b>Гаранција / осигурување:</b> {C.guar}</p>}
      <h2>Општи услови</h2><div style={{ fontSize: '8.5pt', whiteSpace: 'pre-line' }}>{C.terms}</div>
      <Signs L={['Агенција', 'Патник']} />
    </>
  );
}
