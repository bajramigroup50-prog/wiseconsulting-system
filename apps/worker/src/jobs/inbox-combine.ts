/**
 * „📷 Испрати документ“: several photos the client took of ONE document (pages of an invoice, a statement…) are
 * combined into one PDF (pdf-lib), stored in the firm's files and attached to the inbox message instead of the photos
 * (the photos stay in storage as the client's own uploads). One photo, PDFs and anything pdf-lib cannot read stay as
 * they were. Idempotent: a message already routed / already combined is left alone.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { capturePdfName, INBOX_COMBINE_JOB } from '@wise/core/office';
import { audit, fileLinks, files, inboxItems, OFFICE_FILE_ENTITY, type DB, type Tx } from '@wise/db';
import { defineJob } from '../job';
import { readObject } from '../ai/storage';
import { s3Store, storeFile, type ObjectStore } from '../storage';

const A4: [number, number] = [595.28, 841.89];

/** One page per image, the image fitted into A4 (portrait or landscape like the photo), 18 pt margin. */
export async function imagesToPdf(images: readonly { bytes: Uint8Array; mime: string }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = im.mime === 'image/png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    const land = img.width > img.height;
    const [W, H] = land ? [A4[1], A4[0]] : A4;
    const sc = Math.min((W - 36) / img.width, (H - 36) / img.height);
    const w = img.width * sc, h = img.height * sc;
    doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
  }
  return doc.save();
}

export async function runInboxCombine(db: DB, itemId: string, o: { store?: ObjectStore; log?: (m: string) => void } = {}): Promise<{ fileId: string | null; pages: number }> {
  const log = o.log ?? (() => {});
  const [i] = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).limit(1);
  if (!i || i.done || i.fromOffice) return { fileId: null, pages: 0 };
  const F = await db.select({ id: files.id, key: files.bucketKey, mime: files.mime, name: files.name }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
    .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.inbox), eq(fileLinks.entityId, i.id), eq(files.status, 'ready')))
    .orderBy(asc(files.createdAt), asc(files.name));
  const imgs = F.filter((f) => f.mime === 'image/jpeg' || f.mime === 'image/png');
  // only a message of photos alone (a PDF next to them is kept as sent)
  if (imgs.length < 2 || imgs.length !== F.length) return { fileId: null, pages: 0 };
  let body: Uint8Array;
  try {
    body = await imagesToPdf(await Promise.all(imgs.map(async (f) => ({ bytes: await readObject(f.key), mime: f.mime }))));
  } catch (e) {
    log(`inbox ${i.id}: photos kept (${(e as Error).message})`);
    return { fileId: null, pages: 0 };
  }
  const name = capturePdfName(i.docKind, i.createdAt.toISOString().slice(0, 10));
  const fileId = await storeFile(db, o.store ?? s3Store, { firmId: i.firmId, name, mime: 'application/pdf', ext: 'pdf', body, userId: i.fromUserId });
  await db.transaction(async (tx: Tx) => {
    await tx.insert(fileLinks).values({ fileId, entityType: OFFICE_FILE_ENTITY.inbox, entityId: i.id }).onConflictDoNothing();
    await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.inbox), eq(fileLinks.entityId, i.id), inArray(fileLinks.fileId, imgs.map((f) => f.id))));
    await audit(tx, { userId: i.fromUserId, firmId: i.firmId, action: 'klFotoPdf', entityType: 'inbox_item', entityId: i.id, data: { fileId, pages: imgs.length } });
  });
  log(`inbox ${i.id}: ${imgs.length} photos → ${name}`);
  return { fileId, pages: imgs.length };
}

export const inboxCombine = defineJob<{ itemId: string }>({
  name: INBOX_COMBINE_JOB,
  queue: { retryLimit: 2 },
  async run(data, ctx) {
    if (data?.itemId) await runInboxCombine(ctx.db, data.itemId, { log: ctx.log });
  },
});
