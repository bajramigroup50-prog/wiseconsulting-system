/**
 * `POST /api/pdf` — server PDF of a print view (the „PDF“ button, `serverPdf` in `lib/print-pdf.ts`) or of a screen
 * captured as it is (`ScreenExport`, `head` → firm head + title in front).
 * Body `{ html, css, title, landscape?, pkg?, head?, save? }` → `{ id }` (the `files.id` the worker's `pdf.render` will
 * store; poll `/api/files/{id}`). A route handler rather than a server action so the static payroll print pages
 * (`lib/payroll/html.ts` `printDoc`) can call it too.
 *
 * Guard: a signed-in user with access to the current firm (printing is allowed to every role with access, like the
 * print views themselves — the `view` role prints too). The session cookie is `SameSite=Lax`, so other sites cannot
 * post here with it. Images served by `/api/files/{id}` are inlined (firm access checked per file), because the
 * worker's Chromium has no network access.
 *
 * `save` files the PDF (a mutation: `write` on the current firm + audit): a new dossier document (legacy
 * `recArchive`, „Заврши и архивирај“) or the year-end dossier role (legacy `zyGen`). The worker links the file once
 * it is stored.
 */
import { eq, inArray } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { ZY_ROLES } from '@wise/core/firms/zsdos';
import { DOS_CAT } from '@wise/core/office';
import { audit, docPackages, dossierDocs, fileLinks, files, OFFICE_FILE_ENTITY, YE_DOSSIER_ENTITY, type PdfFileLink } from '@wise/db';
import { getUser } from '@/lib/auth';
import { klientViews } from '@/lib/kl-views';
import { klFileAllowed } from '@/lib/route-guard';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { renderPdf } from '@/lib/jobs';
import { dataUri, fileImageIds, firmHeadHtml, inlineFileImages, parsePrintPdfRequest, withFirmHead } from '@/lib/print-pdf';
import { getObjectBytes } from '@/lib/storage';

const ROLES = ZY_ROLES.map(([r]) => r).filter((r) => r !== 'oth');

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'Најавете се повторно.' }, { status: 401 });
  const firm = await currentFirm(u);
  if (firm && !firmAllowed(u.principal, firm.id, firm.ownerId)) return Response.json({ error: 'Немате пристап до фирмата.' }, { status: 403 });
  const p = parsePrintPdfRequest(await req.json().catch(() => null), { categories: DOS_CAT, roles: ROLES });
  if ('error' in p) return Response.json(p, { status: 400 });
  if (p.save && (!firm || !can(u.principal, 'write', firm.id))) return Response.json({ error: 'Немате право да зачувувате во досието.' }, { status: 403 });

  const ids = fileImageIds(p.html).slice(0, 20);
  const imgs = new Map<string, string | null>();
  if (ids.length) {
    const F = await db().select().from(files).where(inArray(files.id, ids));
    // a client may inline only the files it may open through /api/files (same section rule)
    const klViews = u.role === 'klient' ? await klientViews(u.id, firm?.id) : null;
    const L = klViews && F.length ? await db().select({ fileId: fileLinks.fileId, entityType: fileLinks.entityType, role: fileLinks.role }).from(fileLinks).where(inArray(fileLinks.fileId, F.map((f) => f.id))) : [];
    for (const f of F) {
      const ok = f.status === 'ready' && f.mime.startsWith('image/') && f.size <= 5_000_000
        && (f.firmId ? firmAllowed(u.principal, f.firmId) : can(u.principal, 'office') || f.uploadedBy === u.id)
        && (!klViews || klFileAllowed(L.filter((l) => l.fileId === f.id), klViews, f.uploadedBy === u.id,
          ['logo', 'sign', 'stamp'].some((k) => (firm?.settings as Record<string, unknown> | undefined)?.[k] === f.id)));
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
  let html = inlineFileImages(p.html, imgs);
  if (p.head) html = withFirmHead(html, firmHeadHtml(firm, p.title, p.head.sub, new Date().toISOString()), p.landscape);

  // the dossier document is created first (its id is the link target); the worker adds the file
  let link: PdfFileLink | undefined;
  let dossierId: string | null = null;
  if (p.save?.to === 'dossier' && firm) {
    const s = p.save;
    dossierId = await db().transaction(async (tx) => {
      const [d] = await tx.insert(dossierDocs).values({
        firmId: firm.id, category: s.category, title: s.title, date: s.date, partnerName: s.partner, note: s.note, createdBy: u.id,
      }).returning({ id: dossierDocs.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'recArchive', entityType: 'dossier_doc', entityId: d!.id, data: { category: s.category, title: s.title } });
      return d!.id;
    });
    link = { entityType: OFFICE_FILE_ENTITY.dossier, entityId: dossierId };
  } else if (p.save?.to === 'year' && firm) {
    link = { entityType: YE_DOSSIER_ENTITY, entityId: `${firm.id}:${p.save.year}`, role: p.save.role, replace: true };
  }
  let id: string;
  try {
    id = await renderPdf({ html, css: p.css, title: p.title, landscape: p.landscape, firmId: firm?.id ?? null, userId: u.id, ...(link ? { link } : {}) });
  } catch {
    if (dossierId) {
      await db().transaction(async (tx) => {
        await tx.delete(dossierDocs).where(eq(dossierDocs.id, dossierId!));
        await audit(tx, { userId: u.id, firmId: firm!.id, action: 'dosDel', entityType: 'dossier_doc', entityId: dossierId!, data: { reason: 'pdf queue unavailable' } });
      });
    }
    return Response.json({ error: 'Серверот за PDF е недостапен – користете „Печати“.' }, { status: 503 });
  }
  await db().transaction(async (tx) => {
    if (pkg) {
      await tx.update(docPackages).set({ items: [...pkg.items, { fileId: id, label: p.title }] }).where(eq(docPackages.id, pkg.id));
      await audit(tx, { userId: u.id, firmId: pkg.firmId, action: 'pkgRep', entityType: 'doc_package', entityId: pkg.id, data: { fileId: id, title: p.title } });
    }
    if (p.save?.to === 'year') {
      await audit(tx, { userId: u.id, firmId: firm!.id, action: 'zyGen', entityType: YE_DOSSIER_ENTITY, entityId: `${firm!.id}:${p.save.year}`, data: { fileId: id, role: p.save.role } });
    }
    await audit(tx, { userId: u.id, firmId: firm?.id ?? null, action: 'pdfRender', entityType: 'file', entityId: id, data: { title: p.title } });
  });
  return Response.json({ id });
}
