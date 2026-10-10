import { eq } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { cookies } from 'next/headers';
import { audit, fileLinks, files, firms } from '@wise/db';
import { getUser } from '@/lib/auth';
import { FIRM_COOKIE } from '@/lib/context';
import { klientViews } from '@/lib/kl-views';
import { klFileAllowed } from '@/lib/route-guard';
import { db } from '@/lib/db';
import { objectSize, presignGet } from '@/lib/storage';

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db().select().from(files).where(eq(files.id, id)).limit(1);
  return f ?? null;
}

/** Download/view: redirect to a short-lived presigned GET. `?dl=1` forces a download. */
export async function GET(req: Request, { params }: Ctx) {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  const f = await load((await params).id);
  // Reading needs firm access only (view role included); office files need the office permission.
  let allowed = !!f && (f.firmId ? firmAllowed(u.principal, f.firmId) : can(u.principal, 'office') || f.uploadedBy === u.id);
  // A client sees only files of the sections the office opened for them (or their own uploads).
  if (allowed && f && u.role === 'klient') {
    const links = await db().select({ entityType: fileLinks.entityType, role: fileLinks.role }).from(fileLinks).where(eq(fileLinks.fileId, f.id));
    // the firm's logo / signature / stamp (file ids in `firms.settings`) print on every document the client opens
    const [fr] = f.firmId ? await db().select({ s: firms.settings }).from(firms).where(eq(firms.id, f.firmId)).limit(1) : [];
    const S = (fr?.s ?? {}) as Record<string, unknown>;
    const img = ['logo', 'sign', 'stamp'].some((k) => S[k] === f.id);
    allowed = klFileAllowed(links, await klientViews(u.id, (await cookies()).get(FIRM_COOKIE)?.value), f.uploadedBy === u.id, img);
  }
  if (!f || f.status !== 'ready' || !allowed) return new Response('not found', { status: 404 });
  const dl = new URL(req.url).searchParams.get('dl') === '1';
  return Response.redirect(await presignGet(f.bucketKey, f.name, !dl), 302);
}

/** Step 2 of an upload: confirm the browser's PUT landed (size matches) and mark the file ready. */
export async function POST(_req: Request, { params }: Ctx) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const f = await load((await params).id);
  if (!f || f.uploadedBy !== u.id) return Response.json({ error: 'not found' }, { status: 404 });
  if (f.status === 'ready') return Response.json({ id: f.id });
  const size = await objectSize(f.bucketKey);
  if (size !== f.size) return Response.json({ error: 'Датотеката не е прикачена.' }, { status: 409 });
  await db().transaction(async (tx) => {
    await tx.update(files).set({ status: 'ready' }).where(eq(files.id, f.id));
    await audit(tx, { userId: u.id, firmId: f.firmId, action: 'fileUpload', entityType: 'file', entityId: f.id, data: { name: f.name, size: f.size } });
  });
  return Response.json({ id: f.id });
}

