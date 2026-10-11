/** Legacy `tbVouHTML` 11924 / `ACT.tbVou`: ВАУЧЕР of a travel booking (handed to the service provider). */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { firmTravelConfig, travelArrangements, travelBookings } from '@wise/db';
import { db } from '@/lib/db';
import { dmy } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function TravelVoucher({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('tura', 'Ваучер');
  if (g.blocked || !id || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [b] = await db().select().from(travelBookings).where(and(eq(travelBookings.id, id), eq(travelBookings.firmId, g.firm.id))).limit(1);
  if (!b) notFound();
  const [A] = await db().select().from(travelArrangements).where(and(eq(travelArrangements.id, b.arrangementId), eq(travelArrangements.firmId, g.firm.id))).limit(1);
  if (!A) notFound();
  const C = firmTravelConfig(g.firm);
  const f = g.firm;
  return (
    <>
      <DocHead firm={f} title="ВАУЧЕР" sub={`бр. ${b.number} · ${A.code}`} />
      <p><b>{f.name}</b>, {f.address ?? ''}{f.city ? ', ' + f.city : ''} · ЕДБ {f.edb ?? ''}{f.phone ? ' · тел. ' + f.phone : ''}{C.lic ? ' · Лиценца за туристичка агенција бр. ' + C.lic : ''}</p>
      <table><tbody>
        <tr><td style={{ width: '28%' }}>Аранжман / услуга</td><td><b>{A.name}</b></td></tr>
        <tr><td>Дестинација</td><td>{A.dest}</td></tr>
        <tr><td>Датум</td><td><b>{dmy(A.from)} – {dmy(A.to)}</b></td></tr>
        {(b.room || b.note) && <tr><td>Сместување</td><td>{[b.room, b.note].filter(Boolean).join(' · ')}</td></tr>}
        <tr><td>Патници</td><td>{b.pax.filter((p) => p.name).map((p, i) => <div key={i}>{p.name}</div>)}</td></tr>
        <tr><td>Возрасни / деца</td><td>{b.adults} / {b.children}</td></tr>
        {A.incl && <tr><td>Услуги</td><td>{A.incl}</td></tr>}
        <tr><td>Контакт на патникот</td><td>{b.client.phone}</td></tr>
      </tbody></table>
      <p className="note">Ваучерот се предава на давателот на услугата. Услугите се платени преку агенцијата.</p>
      <Signs L={['Агенција']} />
    </>
  );
}
