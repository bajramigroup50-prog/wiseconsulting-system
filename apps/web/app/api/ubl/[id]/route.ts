/** UBL 2.1 e-invoice download of an invoice / credit note (legacy `ublDl` 7366 → `ublXml` 5117). */
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { audit, firms, invoices } from '@wise/db';
import { getUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { buildUbl, ublFileName } from '@/lib/ubl';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('not found', { status: 404 });
  const [inv] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  // Reading needs firm access only (the `view` role may download, like printing).
  if (!inv || !firmAllowed(u.principal, inv.firmId)) return new Response('not found', { status: 404 });
  if (inv.kind !== 'invoice' && inv.kind !== 'credit') return new Response('not an invoice', { status: 400 });
  const [f] = await db().select().from(firms).where(eq(firms.id, inv.firmId)).limit(1);
  if (!f) return new Response('not found', { status: 404 });
  const [d] = await buildUbl(f, [inv]);
  await audit(db(), { userId: u.id, firmId: inv.firmId, action: 'ublDl', entityType: 'invoice', entityId: id });
  return new Response(d!.xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ublFileName(inv.number))}`,
    },
  });
}
