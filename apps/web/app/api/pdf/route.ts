/**
 * `POST /api/pdf` — server PDF of a print view (the „PDF“ button, `serverPdf` in `lib/print-pdf.ts`).
 * Body `{ html, css, title, landscape? }` → `{ id }` (the `files.id` the worker's `pdf.render` will store; poll
 * `/api/files/{id}`). A route handler rather than a server action so the static payroll print pages
 * (`lib/payroll/html.ts` `printDoc`) can call it too.
 *
 * Guard: a signed-in user with access to the current firm (printing is allowed to every role with access, like the
 * print views themselves — the `view` role prints too). The session cookie is `SameSite=Lax`, so other sites cannot
 * post here with it. Images served by `/api/files/{id}` are inlined (firm access checked per file), because the
 * worker's Chromium has no network access.
 */
import { eq, inArray } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { audit, docPackages, files } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { renderPdf } from '@/lib/jobs';
import { dataUri, fileImageIds, inlineFileImages, parsePrintPdfRequest } from '@/lib/print-pdf';
import { getObjectBytes } from '@/lib/storage';

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'Најавете се повторно.' }, { status: 401 });
  const firm = await currentFirm(u);
  if (firm && !firmAllowed(u.principal, firm.id, firm.ownerId)) return Response.json({ error: 'Немате пристап до фирмата.' }, { status: 403 });
  const p = parsePrintPdfRequest(await req.json().catch(() => null));
  if ('error' in p) return Response.json(p, { status: 400 });

  const ids = fileImageIds(p.html).slice(0, 20);
  const imgs = new Map<string, string | null>();
  if (ids.length) {
    const F = await db().select().from(files).where(inArray(files.id, ids));
    for (const f of F) {
      const ok = f.status === 'ready' && f.mime.startsWith('image/') && f.size <= 5_000_000
        && (f.firmId ? firmAllowed(u.principal, f.firmId) : can(u.principal, 'office') || f.uploadedBy === u.id);
      if (ok) imgs.set(f.id.toLowerCase(), dataUri(f.mime, await getObjectBytes(f.bucketKey).catch(() => new Uint8Array())));
    }
  }
  // legacy PKG_REP: a generated report opened from /paket (`?pkg=<id>`) is added to that package (office permission)
  let pkg: { id: string; firmId: string; items: { dossierId?: string; fileId?: string; label: string }[] } | null = null;
  if (p.pkg) {
    const [x] = await db().select({ id: docPackages.id, firmId: docPackages.firmId, items: docPackages.items }).from(docPackages).where(eq(docPackages.id, p.pkg)).limit(1);
    if (!x || (firm && x.firmId !== firm.id) || !can(u.principal, 'office', x.firmId)) return Response.json({ error: 'Пакетот не постои.' }, { status: 404 });
    pkg = x;
  }
  let id: string;
  try {
    id = await renderPdf({ html: inlineFileImages(p.html, imgs), css: p.css, title: p.title, landscape: p.landscape, firmId: firm?.id ?? null, userId: u.id });
  } catch {
    return Response.json({ error: 'Серверот за PDF е недостапен – користете „Печати“.' }, { status: 503 });
  }
  await db().transaction(async (tx) => {
    if (pkg) {
      await tx.update(docPackages).set({ items: [...pkg.items, { fileId: id, label: p.title }] }).where(eq(docPackages.id, pkg.id));
      await audit(tx, { userId: u.id, firmId: pkg.firmId, action: 'pkgRep', entityType: 'doc_package', entityId: pkg.id, data: { fileId: id, title: p.title } });
    }
    await audit(tx, { userId: u.id, firmId: firm?.id ?? null, action: 'pdfRender', entityType: 'file', entityId: id, data: { title: p.title } });
  });
  return Response.json({ id });
}
