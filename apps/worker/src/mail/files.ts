/** Read an uploaded document from MinIO (same bucket/credentials as `apps/web/lib/storage.ts`). */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

let client: S3Client | undefined;

export function s3Configured(env: Record<string, string | undefined> = process.env): boolean {
  return !!(env.S3_ENDPOINT && env.S3_ACCESS_KEY);
}

export async function readS3File(bucketKey: string): Promise<Buffer> {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
  // SDK ≥3.729 adds CRC32 checksums by default; presigned PUTs would carry the empty-body checksum and SeaweedFS rejects the upload.
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });
  const r = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'wise-docs', Key: bucketKey }));
  if (!r.Body) throw new Error('empty object');
  return Buffer.from(await r.Body.transformToByteArray());
}
