/** Legacy `pnPodHTML` 9326 / `ACT.pnPod`: ПОТВРДА ЗА ИСПОРАКА of one delivered stop (also opened from the invoice). */
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { podHtml } from '@wise/core/industry';
import { stopsOf, travelOrders } from '@wise/db';
import { db } from '@/lib/db';
import { industryPage } from '@/lib/industry';

export default async function TravelPod({ searchParams }: { searchParams: Promise<{ id?: string; i?: string }> }) {
  const { id, i } = await searchParams;
  const g = await industryPage('pnalozi', 'Потврда за испорака');
  if (g.blocked || !id || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [x] = await db().select().from(travelOrders).where(and(eq(travelOrders.id, id), eq(travelOrders.firmId, g.firm.id))).limit(1);
  const s = x ? stopsOf(x)[Number(i)] : undefined;
  if (!x || !s) notFound();
  const html = podHtml({ firm: { name: g.firm.name, edb: g.firm.edb, address: g.firm.address }, order: { number: x.number, plate: x.plate, driver: x.driver }, stop: s, img: (f) => `/api/files/${f}` });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
