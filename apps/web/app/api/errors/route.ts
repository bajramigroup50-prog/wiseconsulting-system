import { getUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { logAppError } from '@/lib/errlog';

/** Browser error reports (legacy `errLog` from `window.onerror` / `unhandledrejection` / render). Signed-in users only. */
export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'bad request' }, { status: 400 }); }
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : null);
  const firm = await currentFirm(u);
  await logAppError(u, firm, { msg: s('msg') ?? '', stack: s('stack'), view: s('view'), src: s('src'), ua: req.headers.get('user-agent') });
  return Response.json({ ok: true });
}
