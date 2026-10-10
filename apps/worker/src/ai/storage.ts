/** Reads uploaded files from MinIO (same bucket and credentials as `apps/web/lib/storage.ts`). */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

export type ObjectReader = (bucketKey: string) => Promise<Uint8Array>;

let s3: S3Client | undefined;
const BUCKET = () => process.env.S3_BUCKET ?? 'wise-docs';

const defaultReader: ObjectReader = async (key) => {
  s3 ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', // see apps/worker/src/storage.ts
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
  if (!r.Body) throw new Error('Датотеката не е пронајдена во складиштето.');
  return r.Body.transformToByteArray();
};

let reader: ObjectReader = defaultReader;
/** Tests: replace the object reader (pass null to reset). */
export function setObjectReader(r: ObjectReader | null): void { reader = r ?? defaultReader; }
export const readObject: ObjectReader = (key) => reader(key);
