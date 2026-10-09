/** Legacy `roPre` (9985): bill preview of a table (not a fiscal receipt). */
import { notFound } from 'next/navigation';
import { orderTotal } from '@wise/core/industry';
import { listDocs, type RestaurantOrder, type RestaurantTable } from '@wise/db';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { industryPage } from '@/lib/industry';
import { DocHead } from '@/components/industry-print';

export default async function BillPrint({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const g = await industryPage('restoran', 'Сметка');
  if (g.blocked || !id) notFound();
  const o = (await listDocs<RestaurantOrder>(db(), g.firm.id, 'rord')).find((x) => x.id === id);
  if (!o) notFound();
  const t = (await listDocs<RestaurantTable>(db(), g.firm.id, 'rtable')).find((x) => x.id === o.data.tableId);
  return (
    <>
      <DocHead firm={g.firm} title={`СМЕТКА – МАСА ${t?.data.no ?? ''}`} sub={o.data.opened.replace('T', ' ')} />
      <table><tbody>{o.data.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td className="n">{l.qty} × {fmt(l.price)}</td><td className="n">{fmt(l.qty * l.price)}</td></tr>)}
        <tr><td colSpan={2}><b>Вкупно</b></td><td className="n"><b>{fmt(orderTotal(o.data.lines))}</b></td></tr></tbody></table>
      <p style={{ fontSize: '9pt' }}>Ова не е фискална сметка.</p>
    </>
  );
}
