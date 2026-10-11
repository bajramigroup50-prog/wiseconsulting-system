/** Legacy `ACT.pnDnevPdf` 9483: ПРЕСМЕТКА НА ДНЕВНИЦИ – ВОЗАЧИ of the year (finished business-trip orders). */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { hoursMinutes, perDiemRows, transportConfig } from '@wise/core/industry';
import { eventsOf, industryConfigOf, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { dmy, fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead, Signs } from '@/components/industry-print';

export default async function PerDiemPrint({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const { y } = await searchParams;
  const g = await industryPage('pnGorivo', 'Дневници');
  if (g.blocked) notFound();
  const year = /^\d{4}$/.test(y ?? '') ? y! : String(g.year);
  const O = (await db().select().from(travelOrders).where(eq(travelOrders.firmId, g.firm.id))).filter((o) => o.date.slice(0, 4) === year);
  const R = perDiemRows(O.map((x) => ({ ...x, events: eventsOf(x) })), transportConfig(industryConfigOf(g.firm, 'transport')));
  return (
    <>
      <DocHead firm={g.firm} title="ПРЕСМЕТКА НА ДНЕВНИЦИ – ВОЗАЧИ" sub={year} />
      <table><thead><tr><th>Датум</th><th>Налог</th><th>Возач</th><th>Возило</th><th className="n">Траење</th><th className="n">%</th><th className="n">Износ</th></tr></thead>
        <tbody>{R.map(({ x, d }) => <tr key={x.id}><td>{dmy(x.date)}</td><td>{x.number}</td><td>{x.driver}</td><td>{x.plate}</td><td className="n">{hoursMinutes(d.hrs)}</td><td className="n">{d.pct}%</td><td className="n">{fmt(d.amt)}</td></tr>)}
          <tr><td colSpan={6}><b>Вкупно</b></td><td className="n"><b>{fmt(R.reduce((a, o) => a + o.d.amt, 0))}</b></td></tr></tbody></table>
      <Signs L={['Составил', 'Одобрил']} />
    </>
  );
}
