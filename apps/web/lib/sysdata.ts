import 'server-only';
/** Server helpers for „Податоци и резервна копија“: store a firm backup as a JSON document in the archive bucket. */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { appSettings, files, type FirmBackup, type Tx } from '@wise/db';
import { db } from './db';
import { objectKey, putObjectBytes } from './storage';

/** `Rezervna_kopija_<firm>_<YYYY-MM-DD_HHMM>.json` (ASCII, safe for downloads). */
export function backupName(prefix: string, firmName: string, at = new Date()): string {
  const stamp = at.toLocaleString('sv-SE', { timeZone: 'Europe/Skopje' }).slice(0, 16).replace(' ', '_').replace(':', '');
  const slug = firmName.normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'firma';
  return `${prefix}${slug}_${stamp}.json`;
}

/** Upload the JSON to the bucket; the `files` row is inserted by `fileRow` inside the caller's transaction. */
export async function putBackup(firmId: string, name: string, B: FirmBackup) {
  const body = new TextEncoder().encode(JSON.stringify(B));
  const key = objectKey(firmId, name);
  await putObjectBytes(key, body, 'application/json');
  return { firmId, bucketKey: key, name, mime: 'application/json', size: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), status: 'ready' as const };
}

export async function fileRow(tx: Tx, f: Awaited<ReturnType<typeof putBackup>>, userId: string): Promise<string> {
  const [r] = await tx.insert(files).values({ ...f, uploadedBy: userId }).returning({ id: files.id });
  return r!.id;
}

/** Last nightly server backup, written by `docker/backup.sh` into `app_settings` (`backup.last`). */
export interface ServerBackup { at: string; file?: string; size?: number; kept?: number; files?: string }
export async function lastServerBackup(): Promise<ServerBackup | null> {
  const [r] = await db().select().from(appSettings).where(eq(appSettings.key, 'backup.last')).limit(1);
  const v = r?.value as ServerBackup | undefined;
  return v?.at ? v : null;
}
