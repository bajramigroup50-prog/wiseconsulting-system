/**
 * Worker side of the MinIO storage (same bucket and key scheme as `apps/web/lib/storage.ts`):
 * objects are written directly with the internal endpoint; rows go into `files` as `ready`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { files, type DB } from '@wise/db';

export const BUCKET = process.env.S3_BUCKET ?? 'wise-docs';

let client: S3Client | undefined;
const s3 = () => (client ??= new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  // SDK ≥3.729 adds CRC32 checksums by default; presigned PUTs would carry the empty-body checksum and SeaweedFS rejects the upload.
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
}));

/** firms/{firmId}/{yyyy}/{uuid}.{ext}, or office/{yyyy}/… for office-wide files. */
export const objectKey = (firmId: string | null, ext: string, now = new Date()) =>
  `${firmId ? `firms/${firmId}` : 'office'}/${now.getFullYear()}/${randomUUID()}.${ext}`;

/** Storage backend, injectable for tests. */
export interface ObjectStore { put(key: string, body: Uint8Array, mime: string): Promise<void> }

export const s3Store: ObjectStore = {
  async put(key, body, mime) {
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mime, ContentLength: body.byteLength }));
  },
};

/** Upload bytes and register them in `files` (status `ready`). Returns the file id. */
export async function storeFile(
  db: DB, store: ObjectStore,
  f: { id?: string; firmId: string | null; name: string; mime: string; ext: string; body: Uint8Array; userId?: string | null },
): Promise<string> {
  const key = objectKey(f.firmId, f.ext);
  await store.put(key, f.body, f.mime);
  const [row] = await db.insert(files).values({
    ...(f.id ? { id: f.id } : {}),
    firmId: f.firmId, bucketKey: key, name: f.name, mime: f.mime, size: f.body.byteLength,
    sha256: createHash('sha256').update(f.body).digest('hex'), status: 'ready', uploadedBy: f.userId ?? null,
  }).returning({ id: files.id });
  return row!.id;
}
