/**
 * Global route guard (Next 16 `proxy`, Node.js runtime) for the restricted roles: a `klient` user reaches only the
 * client portal of their firm and a `teren` user only their tasks — direct URLs, print views and API endpoints
 * included (`lib/route-guard.ts`, unit-tested). Other roles pass through; pages and actions keep their own checks.
 */
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, sessions, users } from '@wise/db';
import { firmKlientViews, klientViews } from './lib/kl-views';
import { PREVIEW_COOKIE, isGuardRole, previewVerdict, publicPath, routeVerdict } from './lib/route-guard';

const SESSION_COOKIE = 'wc_sess';
const FIRM_COOKIE = 'wc_fid';

export async function proxy(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (publicPath(p)) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();
  const [u] = await getDb().select({ id: users.id, role: users.role }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, createHash('sha256').update(token).digest('hex')), gt(sessions.expiresAt, new Date()), eq(users.active, true))).limit(1);
  if (!u) return NextResponse.next();
  if (!isGuardRole(u.role)) {
    // legacy `S.asClient`: an office user previewing the client portal of the current firm sees only its sections
    // (the cookie only narrows what an office user is shown; the klient guard below is unchanged)
    const pv = req.cookies.get(PREVIEW_COOKIE)?.value, fid = req.cookies.get(FIRM_COOKIE)?.value;
    if (!pv || pv !== fid) return NextResponse.next();
    const pvv = previewVerdict(p, await firmKlientViews(fid));
    return pvv ? NextResponse.redirect(new URL(pvv, req.url)) : NextResponse.next();
  }
  const views = u.role === 'klient' ? await klientViews(u.id, req.cookies.get(FIRM_COOKIE)?.value) : [];
  const v = routeVerdict(u.role, p, views);
  if (!v) return NextResponse.next();
  if (v === '403') return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
  return NextResponse.redirect(new URL(v, req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
