import 'server-only';
/**
 * Store a small image sent as a data URL (driver signature / delivery photo, legacy `pnUpload`) in the object store
 * and register it in `files` (status `ready`, with its audit row in the caller's transaction).
 */
import { createHash } from 'node:crypto';
import { audit, files, IndustryError, type Tx } from '@wise/db';
import { objectKey, putObjectBytes } from './storage';

const MAX = 900 * 1024;
const RE = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

/** Parse a PNG/JPEG data URL; null when empty, throws on anything else. */
export function parseImageDataUrl(s: string): { mime: string; bytes: Uint8Array } | null {
  if (!s) return null;
  const m = RE.exec(s);
  if (!m) throw new IndustryError('Неважечка слика.');
  const bytes = new Uint8Array(Buffer.from(m[2]!, 'base64'));
  if (!bytes.byteLength || bytes.byteLength > MAX) throw new IndustryError('Сликата е преголема.');
  return { mime: m[1]!, bytes };
}

export async function storeImageDataUrl(tx: Tx, o: { firmId: string; userId: string; dataUrl: string; name: string }): Promise<string | null> {
  const img = parseImageDataUrl(o.dataUrl);
  if (!img) return null;
  const name = `${o.name}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
  const key = objectKey(o.firmId, name);
  await putObjectBytes(key, img.bytes, img.mime);
  const [f] = await tx.insert(files).values({
    firmId: o.firmId, bucketKey: key, name, mime: img.mime, size: img.bytes.byteLength, sha256: createHash('sha256').update(img.bytes).digest('hex'), status: 'ready', uploadedBy: o.userId,
  }).returning({ id: files.id });
  await audit(tx, { userId: o.userId, firmId: o.firmId, action: 'fileUpload', entityType: 'file', entityId: f!.id, data: { name, size: img.bytes.byteLength } });
  return f!.id;
}
