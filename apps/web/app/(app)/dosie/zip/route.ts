/** Legacy `dosDown`: „⬇ Преземи“ the selected dossier documents — one ZIP, a folder per document. */
import { and, eq, inArray } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { dossierDocs, fileLinks, files, OFFICE_FILE_ENTITY } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { zipFiles } from '@/lib/docx';
import { getObjectBytes } from '@/lib/storage';

export async function GET(req: Request) {
  const u = await getUser();
  const firm = u ? await currentFirm(u) : null;
  if (!u || !firm || !firmAllowed(u.principal, firm.id, firm.ownerId)) return new Response('Forbidden', { status: 403 });
  const ids = new URL(req.url).searchParams.getAll('id').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (!ids.length) return new Response('Изберете документи.', { status: 400 });
  const D = await db().select().from(dossierDocs).where(and(eq(dossierDocs.firmId, firm.id), inArray(dossierDocs.id, ids)));
  const F = D.length ? await db().select({ e: fileLinks.entityId, name: files.name, key: files.bucketKey }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), inArray(fileLinks.entityId, D.map((d) => d.id)))) : [];
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const f of F) {
    const d = D.find((x) => x.id === f.e)!;
    entries.push({ name: `${safe(`${d.title || d.category}${d.date ? ' ' + d.date : ''}`)}/${safe(f.name)}`, data: await getObjectBytes(f.key) });
  }
  const zip = zipFiles(entries);
  return new Response(new Uint8Array(zip), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="Dokumenti_${new Date().toISOString().slice(0, 10)}.zip"` },
  });
}
