import 'server-only';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage via the S3 API (SeaweedFS in production). Two clients: `internal` talks to s3:8333 inside the compose network;
 * `public` only signs URLs with the host the browser uses (S3_PUBLIC_URL, proxied by Caddy).
 */
export const BUCKET = process.env.S3_BUCKET ?? 'wise-docs';
const URL_TTL = 300;

const mk = (endpoint: string | undefined) => new S3Client({
  endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
});

let clients: { internal: S3Client; public: S3Client } | undefined;
const s3 = () => (clients ??= {
  internal: mk(process.env.S3_ENDPOINT),
  public: mk(process.env.S3_PUBLIC_URL ?? process.env.S3_ENDPOINT),
});

const EXT_RE = /\.([a-z0-9]{1,8})$/i;

/** firms/{firmId}/{yyyy}/{uuid}.{ext} (global files go under `office/`). */
export function objectKey(firmId: string | null, name: string, now = new Date()): string {
  const ext = EXT_RE.exec(name)?.[1]?.toLowerCase();
  return `${firmId ? `firms/${firmId}` : 'office'}/${now.getFullYear()}/${randomUUID()}${ext ? '.' + ext : ''}`;
}

export const presignPut = (key: string, mime: string, size: number) =>
  getSignedUrl(s3().public, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: URL_TTL });

export const presignGet = (key: string, name: string, inline = true) =>
  getSignedUrl(s3().public, new GetObjectCommand({
    Bucket: BUCKET, Key: key,
    ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
  }), { expiresIn: URL_TTL });

/** Size of the stored object, or null if it isn't there. */
export async function objectSize(key: string): Promise<number | null> {
  try {
    const r = await s3().internal.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ContentLength ?? null;
  } catch {
    return null;
  }
}

/** Read a stored object (server side, internal endpoint) — Word templates, ZIP packages (Phase 9). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const r = await s3().internal.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return r.Body!.transformToByteArray();
}

/** Write an object (server side) — generated documents (Phase 9). */
export async function putObjectBytes(key: string, body: Uint8Array, mime: string): Promise<void> {
  await s3().internal.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: mime, ContentLength: body.byteLength }));
}
