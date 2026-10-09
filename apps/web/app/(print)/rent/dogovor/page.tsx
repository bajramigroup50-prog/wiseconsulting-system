/** Legacy `rcPdfHTML` (11727): договор за изнајмување возило. */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { nationalityName, rcCalc } from '@wise/core/industry';
import { firmRentConfig, fleetVehicles, rentRentals, vehicleRates } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function RentContract({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('rent', 'Договор');
  if (g.blocked || !id) notFound();
  const [r] = await db().select().from(rentRentals).where(and(eq(rentRentals.id, id), eq(rentRentals.firmId, g.firm.id))).limit(1);
  if (!r) notFound();
  const [v] = await db().select().from(fleetVehicles).where(eq(fleetVehicles.id, r.vehicleId));
  const C = firmRentConfig(g.firm);
  const k = rcCalc(r, vehicleRates(v!), C);
  const d = r.driver;
  const ho = (lab: string, h: typeof r.out) => <tr><td>{lab}</td><td>{(h.at ?? '').replace('T', ' ')}</td><td>{h.km ?? ''}</td><td>{h.fuel != null && h.fuel !== '' ? `${h.fuel}/8` : ''}</td><td>{h.dmg ?? ''}</td><td /></tr>;
  return (
    <>
      <DocHead firm={g.firm} title="ДОГОВОР ЗА ИЗНАЈМУВАЊЕ ВОЗИЛО" sub={`бр. ${r.number} од ${dmy(r.date)}`} />
      <table><tbody>
        <tr><td style={{ width: '30%' }}>Корисник</td><td><b>{d.name}</b>{d.birth ? `, роден/а ${dmy(d.birth)}` : ''}{d.nat ? `, ${nationalityName(d.nat)}` : ''}{d.embg ? `, ЕМБГ ${d.embg}` : ''}</td></tr>
        <tr><td>Адреса / телефон</td><td>{d.addr} {d.phone ? '· ' + d.phone : ''} {d.email ? '· ' + d.email : ''}</td></tr>
        <tr><td>Документ / возачка</td><td>{d.doc}{d.docExp ? ` (важи до ${dmy(d.docExp)})` : ''} · возачка {d.lic}{d.licCat ? ` кат. ${d.licCat}` : ''}{d.licFrom ? ` од ${dmy(d.licFrom)}` : ''}</td></tr>
        {r.driver2 && <tr><td>Втор возач</td><td>{r.driver2}</td></tr>}
        <tr><td>Возило</td><td><b>{r.plate}</b> {v?.name}</td></tr>
        <tr><td>Период</td><td>{r.from.replace('T', ' ')} – {r.to.replace('T', ' ')} ({k.days} ден.)</td></tr>
        <tr><td>Земји</td><td>{r.countries.join(', ')}{r.green ? ' · зелен картон' : ''}</td></tr>
        <tr><td>Цена</td><td>{fmt(k.rent)} ден. со ДДВ{k.pDayAgreed ? ` (договорено ${fmt(k.pDayAgreed)} ден./ден)` : ''} · кауција {fmt(k.dep)} ден.</td></tr>
      </tbody></table>
      <h2>Примопредавање</h2>
      <table><thead><tr><th /><th>Време</th><th>Км</th><th>Гориво</th><th>Оштетувања</th><th>Потпис корисник</th></tr></thead><tbody>{ho('Предавање', r.out)}{ho('Враќање', r.ret)}</tbody></table>
      {k.ex.length > 0 && <><h2>Дополнителни трошоци</h2><table><tbody>{k.ex.map((x, i) => <tr key={i}><td>{x.name}</td><td className="n">{x.qty}</td><td className="n">{fmt(x.qty * x.price)}</td></tr>)}<tr><td colSpan={2}><b>Вкупно за плаќање</b></td><td className="n"><b>{fmt(k.tot)}</b></td></tr></tbody></table></>}
      <h2>Услови</h2><div style={{ fontSize: '8.5pt', whiteSpace: 'pre-line' }}>{C.terms}</div>
      <Signs L={['Изнајмувач', 'Корисник']} />
    </>
  );
}
