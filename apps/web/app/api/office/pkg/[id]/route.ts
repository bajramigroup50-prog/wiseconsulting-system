import { and, eq, inArray } from 'drizzle-orm';
import { audit, docPackages, fileLinks, files, OFFICE_FILE_ENTITY } from '@wise/db';
import { dmy, todaySkopje } from '@wise/core/office';
import { Forbidden, getUser, requireCan } from '@/lib/auth';
import { db } from '@/lib/db';
import { zipFiles } from '@/lib/docx';
import { isUuid } from '@/lib/office';
import { getObjectBytes } from '@/lib/storage';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Legacy `pkgZip` (8195+, `zipStore`): every file of the package's dossier documents + a cover letter, as one ZIP. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getUser())) return new Response('unauthorized', { status: 401 });
  if (!isUuid(id)) return new Response('not found', { status: 404 });
  const [p] = await db().select().from(docPackages).where(eq(docPackages.id, id)).limit(1);
  if (!p) return new Response('not found', { status: 404 });
  let u;
  try { u = await requireCan('office', p.firmId); } catch (e) {
    if (e instanceof Forbidden) return new Response(e.message, { status: 403 });
    throw e;
  }
  const ids = p.items.map((i) => i.dossierId).filter((x): x is string => !!x);
  const L = ids.length ? await db().select({ e: fileLinks.entityId, f: files }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), inArray(fileLinks.entityId, ids), eq(files.firmId, p.firmId))) : [];
  const entries: { name: string; data: Uint8Array | string }[] = [];
  for (const [n, it] of p.items.entries()) {
    const fs = L.filter((l) => l.e === it.dossierId);
    for (const [k, l] of fs.entries()) {
      const ext = /\.[^.]+$/.exec(l.f.name)?.[0] ?? '';
      entries.push({ name: `${String(n + 1).padStart(2, '0')} ${it.label}${fs.length > 1 ? ` (${k + 1})` : ''}${ext}`, data: await getObjectBytes(l.f.bucketKey) });
    }
  }
  const cover = `<!doctype html><meta charset="utf-8"><title>${esc(p.name)}</title><body style="font-family:Arial,sans-serif">
<h2>${esc(p.name)}</h2>${p.recipient ? `<p>До: <b>${esc(p.recipient)}</b></p>` : ''}<p>Датум: ${dmy(todaySkopje())}</p>
${p.coverNote ? `<p>${esc(p.coverNote).replace(/\n/g, '<br>')}</p>` : ''}<p>Во прилог ги доставуваме следните документи:</p>
<ol>${p.items.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ol></body>`;
  entries.unshift({ name: '00 Пропратно писмо.html', data: cover });
  const zip = zipFiles(entries);
  await db().transaction((tx) => audit(tx, { userId: u.id, firmId: p.firmId, action: 'pkgZip', entityType: 'doc_package', entityId: id, data: { files: entries.length } }));
  return new Response(Buffer.from(zip), {
    headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}.zip` },
  });
}
