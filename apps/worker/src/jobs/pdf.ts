import { and, eq } from 'drizzle-orm';
import { fileLinks, type DB, type PdfFileLink } from '@wise/db';
import { defineJob } from '../job';
import { pdfName, type PdfInput } from '../pdf/document';
import { htmlToPdf } from '../pdf/render';
import { s3Store, storeFile, type ObjectStore } from '../storage';

export interface PdfRenderData extends PdfInput {
  /** Firm the PDF belongs to (null = office-wide file). */
  firmId?: string | null;
  /** Pre-allocated `files.id` so the caller can wait for it (`GET /api/files/{id}` returns 404 until ready). */
  fileId?: string;
  userId?: string | null;
  /** File the stored PDF into a dossier / year dossier (legacy `recArchive`, `zyAdd`). */
  link?: PdfFileLink;
}

/** Render + store (+ link); returns the `files.id`. Injectable renderer/store for tests. */
export async function renderPdfToFile(
  db: DB, d: PdfRenderData,
  deps: { render?: (p: PdfInput) => Promise<Uint8Array>; store?: ObjectStore } = {},
): Promise<string> {
  if (!d?.html) throw new Error('pdf.render: html is required');
  const body = await (deps.render ?? htmlToPdf)(d);
  const id = await storeFile(db, deps.store ?? s3Store, {
    id: d.fileId, firmId: d.firmId ?? null, name: pdfName(d.title), mime: 'application/pdf', ext: 'pdf', body, userId: d.userId,
  });
  const l = d.link;
  if (l?.entityType && l.entityId) {
    const role = l.role || 'attachment';
    await db.transaction(async (tx) => {
      if (l.replace) await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, l.entityType), eq(fileLinks.entityId, l.entityId), eq(fileLinks.role, role)));
      await tx.insert(fileLinks).values({ fileId: id, entityType: l.entityType, entityId: l.entityId, role }).onConflictDoNothing();
    });
  }
  return id;
}

/** `pdf.render({html, css?, link?}) → fileId` stored in MinIO (see `pdf/render.ts` for the Chromium choice). */
export const pdfRender = defineJob<PdfRenderData>({
  name: 'pdf.render',
  async run(data, { db, log }) {
    const id = await renderPdfToFile(db, data);
    log(`file ${id} (${data.title ?? 'документ'})${data.link ? ` → ${data.link.entityType}` : ''}`);
  },
});
