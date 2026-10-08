import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { files } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import { db } from '@/lib/db';
import { objectKey, presignPut } from '@/lib/storage';

const MAX_BYTES = 100 * 1024 * 1024;

const Body = z.object({
  firmId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(255),
  mime: z.string().max(200).regex(/^[\w.+-]+\/[\w.+-]+$/).catch('application/octet-stream'),
  size: z.number().int().positive().max(MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Step 1 of an upload: register the file and return a presigned PUT URL.
 * If the firm already has a ready file with the same sha256, return it instead (duplicate detection).
 */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Неважечко барање.' }, { status: 400 });
  const v = p.data;
  let u;
  try {
    u = await requireCan(v.firmId ? 'write' : 'office', v.firmId);
  } catch (e) {
    if (e instanceof Forbidden) return Response.json({ error: e.message }, { status: 403 });
    throw e;
  }

  const [dupe] = await db().select().from(files)
    .where(and(v.firmId ? eq(files.firmId, v.firmId) : undefined, eq(files.sha256, v.sha256), eq(files.status, 'ready')))
    .limit(1);
  if (dupe) return Response.json({ duplicate: true, file: { id: dupe.id, name: dupe.name, createdAt: dupe.createdAt } });

  const key = objectKey(v.firmId, v.name);
  const [f] = await db().insert(files).values({
    firmId: v.firmId, bucketKey: key, name: v.name, mime: v.mime, size: v.size, sha256: v.sha256, uploadedBy: u.id,
  }).returning({ id: files.id });
  return Response.json({ id: f!.id, uploadUrl: await presignPut(key, v.mime, v.size) });
}
