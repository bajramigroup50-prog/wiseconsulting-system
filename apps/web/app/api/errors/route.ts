/** Browser error reports (legacy `errLog` from `window.onerror` / render / ACT wrappers) → `app_errors`. */
import { recordError } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';

export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return new Response(null, { status: 401 });
  const b = (await req.json().catch(() => null)) as { msg?: unknown; stack?: unknown; src?: unknown; view?: unknown; digest?: unknown } | null;
  if (!b || typeof b.msg !== 'string') return new Response(null, { status: 400 });
  const firm = await currentFirm(u).catch(() => null);
  await recordError(db(), {
    msg: b.msg, stack: typeof b.stack === 'string' ? b.stack : null, src: typeof b.src === 'string' ? b.src : 'render',
    view: typeof b.view === 'string' ? b.view : null, digest: typeof b.digest === 'string' ? b.digest : null,
    ua: req.headers.get('user-agent'), userId: u.id, userName: u.name, role: u.role, firmRef: firm?.id ?? null, firmName: firm?.name ?? null,
  }).catch(() => null);
  return new Response(null, { status: 204 });
}
