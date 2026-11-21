/**
 * `wa.media` — 💬 a client's WhatsApp image / PDF: downloaded through the Graph media API (with the sealed token),
 * stored like any upload (`files`) and put into „📥 Пристигнати документи“ of the firm (`incoming_docs`, source
 * `whatsapp`; the office inbox when the phone is not known), then `incoming.detect` → the usual document reading.
 * Enqueued by the webhook per message; the cron run every 15 minutes picks up downloads that failed before.
 * Voice messages, videos and stickers stay in the conversation only (no file). Office server only (not Фејкан).
 */
import { brandCustom } from '@wise/core';
import { INCOMING_JOB } from '@wise/core/office';
import { WA_JOB_MEDIA, waActive, waDocWanted, waExt, type WaInMedia } from '@wise/core/whatsapp/wa';
import { waGraph, waIngestFile, waMediaFailed, waMessages, waPendingMedia, waSecrets, type DB, type Fetch, type Tx } from '@wise/db';
import { eq } from 'drizzle-orm';
import { defineJob } from '../job';
import { s3Store, storeFile, type ObjectStore } from '../storage';

export async function runWaMedia(db: DB, id: string, o: { fetch?: Fetch; base?: string; store?: ObjectStore; send?: (name: string, data: object) => Promise<unknown>; log?: (m: string) => void } = {}): Promise<string> {
  const s = await waSecrets(db as unknown as Tx);
  if (!waActive(s) || !s.accessToken) return 'off';
  const [m] = await db.select().from(waMessages).where(eq(waMessages.id, id)).limit(1);
  const media = m?.data?.media as WaInMedia | undefined;
  if (!m || !media?.id || m.fileId) return 'nothing';
  if (!waDocWanted(media, m.kind)) {
    await db.update(waMessages).set({ data: { ...m.data, media: undefined, skipped: m.kind } }).where(eq(waMessages.id, id));
    return 'skipped';
  }
  try {
    const g = waGraph({ phoneNumberId: s.phoneNumberId, token: s.accessToken, fetch: o.fetch, base: o.base });
    const f = await g.download(media.id);
    const mime = (f.mime || media.mime).split(';')[0]!.trim();
    const ext = waExt(mime, media.filename);
    const name = (media.filename || `whatsapp-${m.createdAt.toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`).replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 200);
    const fileId = await storeFile(db, o.store ?? s3Store, { firmId: m.firmId, name, mime, ext, body: f.bytes });
    const inId = await db.transaction((tx) => waIngestFile(tx as unknown as Tx, { msgId: id, fileId, name }));
    await o.send?.(INCOMING_JOB, { id: inId });
    o.log?.(`wa.media: ${m.phone} → ${name}`);
    return 'stored';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await waMediaFailed(db as unknown as Tx, id, msg);
    o.log?.(`wa.media: ${id} ✕ ${msg}`);
    return 'failed';
  }
}

export const waMedia = defineJob<{ id?: string }>({
  name: WA_JOB_MEDIA,
  cron: '*/15 * * * *',
  queue: { retryLimit: 2, expireInSeconds: 10 * 60 },
  async run(data, { db, log, send }) {
    if (brandCustom()) return;
    if (data?.id) { await runWaMedia(db, data.id, { log, send }); return; }
    for (const r of await waPendingMedia(db as unknown as Tx)) await runWaMedia(db, r.id, { log, send });
  },
});
