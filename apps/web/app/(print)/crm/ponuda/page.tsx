/** „Понуда за сметководствени услуги“ of the CRM (`/crm`) for print / PDF — office OWNER only. */
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { crmLeads, crmOffers } from '@wise/db';
import { db } from '@/lib/db';
import { crmUser, offerHtml, rowToOffer } from '../../../(app)/crm/lib';

export default async function CrmOfferPrint({ searchParams }: { searchParams: Promise<{ id?: string; nosig?: string }> }) {
  const sp = await searchParams;
  const u = await crmUser();
  if (!u || !sp.id || !/^[0-9a-f-]{36}$/i.test(sp.id)) notFound();
  const [o] = await db().select().from(crmOffers).where(eq(crmOffers.id, sp.id)).limit(1);
  if (!o) notFound();
  const [l] = await db().select().from(crmLeads).where(eq(crmLeads.id, o.leadId)).limit(1);
  if (!l) notFound();
  return <div dangerouslySetInnerHTML={{ __html: await offerHtml(u, rowToOffer(o), l, !sp.nosig) }} />;
}
