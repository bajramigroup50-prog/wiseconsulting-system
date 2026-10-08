/** UBL 2.1 e-invoice download of an invoice / credit note (legacy `ublDl` 7366 → `ublXml` 5117). */
import { asc, eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { ublXml } from '@wise/core/sales';
import { audit, firms, invoiceAdvances, invoiceLines, invoices, items, loadAdvances, partners } from '@wise/db';
import { getUser } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('not found', { status: 404 });
  const [inv] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  // Reading needs firm access only (the `view` role may download, like printing).
  if (!inv || !firmAllowed(u.principal, inv.firmId)) return new Response('not found', { status: 404 });
  if (inv.kind !== 'invoice' && inv.kind !== 'credit') return new Response('not an invoice', { status: 400 });
  const [[f], [p], L, A, ref] = await Promise.all([
    db().select().from(firms).where(eq(firms.id, inv.firmId)).limit(1),
    inv.partnerId ? db().select().from(partners).where(eq(partners.id, inv.partnerId)).limit(1) : Promise.resolve([undefined]),
    db().select({ l: invoiceLines, code: items.code }).from(invoiceLines).leftJoin(items, eq(items.id, invoiceLines.itemId)).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.lineNo)),
    db().select().from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id)),
    inv.refInvoiceId ? db().select({ n: invoices.number }).from(invoices).where(eq(invoices.id, inv.refInvoiceId)).limit(1) : Promise.resolve([]),
  ]);
  if (!f) return new Response('not found', { status: 404 });
  const S = (f.settings ?? {}) as Record<string, unknown>;
  const xml = ublXml({
    number: inv.number, date: inv.date, pdate: inv.pdate, due: inv.due, credit: inv.kind === 'credit', art32: inv.art32, cur: inv.currency,
    refNumber: ref[0]?.n ?? null, advances: inv.kind === 'invoice' && !inv.advance ? await loadAdvances(db(), A) : [],
    items: L.map(({ l, code }) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), disc: Number(l.disc), rate: l.rate, unit: l.unit ?? '', code: l.code || code })),
  }, { name: f.name, address: f.address, city: f.city, edb: f.edb, embs: f.embs, vatRegistered: f.vatRegistered },
  { name: p?.name ?? '', address: p?.address, city: p?.city, edb: p?.edb, embs: p?.embs, vatRegistered: p?.vatRegistered, country: p?.country },
  { nonVat: !f.vatRegistered, bankAccount: String(S.bank ?? '') });
  await audit(db(), { userId: u.id, firmId: inv.firmId, action: 'ublDl', entityType: 'invoice', entityId: id });
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent((inv.kind === 'credit' ? 'CreditNote_' : 'Invoice_') + inv.number.replace(/[^\w-]+/g, '_') + '.xml')}`,
    },
  });
}
