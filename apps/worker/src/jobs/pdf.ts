import { fileLinks, type DB } from '@wise/db';
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
  /** Link the stored PDF to an entity (e.g. a dossier document) once it exists (`file_links` needs the `files` row). */
  link?: { entityType: string; entityId: string; role?: string } | null;
}

/** Render + store; returns the `files.id`. Injectable renderer/store for tests. */
export async function renderPdfToFile(
  db: DB, d: PdfRenderData,
  deps: { render?: (p: PdfInput) => Promise<Uint8Array>; store?: ObjectStore } = {},
): Promise<string> {
  if (!d?.html) throw new Error('pdf.render: html is required');
  const body = await (deps.render ?? htmlToPdf)(d);
  const id = await storeFile(db, deps.store ?? s3Store, {
    id: d.fileId, firmId: d.firmId ?? null, name: pdfName(d.title), mime: 'application/pdf', ext: 'pdf', body, userId: d.userId,
  });
  if (d.link?.entityType && d.link.entityId) {
    await db.insert(fileLinks).values({ fileId: id, entityType: d.link.entityType, entityId: d.link.entityId, role: d.link.role ?? 'attachment' }).onConflictDoNothing();
  }
  return id;
}

/** `pdf.render({html, css?}) → fileId` stored in MinIO (see `pdf/render.ts` for the Chromium choice). */
export const pdfRender = defineJob<PdfRenderData>({
  name: 'pdf.render',
  async run(data, { db, log }) {
    const id = await renderPdfToFile(db, data);
    log(`file ${id} (${data.title ?? 'документ'})`);
  },
});
