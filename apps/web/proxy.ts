/**
 * Global route guard (Next 16 `proxy`, Node.js runtime) for the restricted roles: a `klient` user reaches only the
 * client portal of their firm and a `teren` user only their tasks — direct URLs, print views and API endpoints
 * included (`lib/route-guard.ts`, unit-tested). Other roles pass through; pages and actions keep their own checks.
 */
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, sessions, users } from '@wise/db';
import { klientViews } from './lib/kl-views';
import { isGuardRole, publicPath, routeVerdict } from './lib/route-guard';

const SESSION_COOKIE = 'wc_sess';
const FIRM_COOKIE = 'wc_fid';

export async function proxy(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (publicPath(p)) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();
  const [u] = await getDb().select({ id: users.id, role: users.role }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, createHash('sha256').update(token).digest('hex')), gt(sessions.expiresAt, new Date()), eq(users.active, true))).limit(1);
  if (!u || !isGuardRole(u.role)) return NextResponse.next();
  const views = u.role === 'klient' ? await klientViews(u.id, req.cookies.get(FIRM_COOKIE)?.value) : [];
  const v = routeVerdict(u.role, p, views);
  if (!v) return NextResponse.next();
  if (v === '403') return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
  return NextResponse.redirect(new URL(v, req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
