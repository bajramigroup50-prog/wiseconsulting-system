/**
 * „📦 Пакет за приговор“ download: `?id=<kontrola>` → one ZIP with the submission (Word + PDF) and every attachment
 * („Прилог 01 – …“), built from the files the worker rendered (`kontrola.pkg`) and the archive. Same guard as the
 * Word export (office staff of the firm): a client (portal) never gets it. Audited (`kontrolaPkgZip`).
 */
import { can } from '@wise/core';
import { audit } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { kontrolaPkgZip } from '@/lib/kontrola';
import { getObjectBytes } from '@/lib/storage';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  if (u.role === 'klient') return new Response('Forbidden', { status: 403 });
  const firm = await currentFirm(u, { check: false });
  if (!firm || !can(u.principal, 'office', firm.id)) return new Response('Forbidden', { status: 403 });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const z = await kontrolaPkgZip(firm.id, id, getObjectBytes);
  if (!z) return new Response('Пакетот не е подготвен – кликнете „📦 Пакет за приговор“.', { status: 404 });
  await db().transaction((tx) => audit(tx, { userId: u.id, firmId: firm.id, action: 'kontrolaPkgZip', entityType: 'kontrola', entityId: id, data: { files: z.entries.length, stale: z.stale } }));
  return new Response(new Uint8Array(z.zip), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(z.name)}`,
      'cache-control': 'private, no-store',
    },
  });
}
