import type { DB } from '@wise/db';
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
}

/** Render + store; returns the `files.id`. Injectable renderer/store for tests. */
export async function renderPdfToFile(
  db: DB, d: PdfRenderData,
  deps: { render?: (p: PdfInput) => Promise<Uint8Array>; store?: ObjectStore } = {},
): Promise<string> {
  if (!d?.html) throw new Error('pdf.render: html is required');
  const body = await (deps.render ?? htmlToPdf)(d);
  return storeFile(db, deps.store ?? s3Store, {
    id: d.fileId, firmId: d.firmId ?? null, name: pdfName(d.title), mime: 'application/pdf', ext: 'pdf', body, userId: d.userId,
  });
}

/** `pdf.render({html, css?}) → fileId` stored in MinIO (see `pdf/render.ts` for the Chromium choice). */
export const pdfRender = defineJob<PdfRenderData>({
  name: 'pdf.render',
  async run(data, { db, log }) {
    const id = await renderPdfToFile(db, data);
    log(`file ${id} (${data.title ?? 'документ'})`);
  },
});
