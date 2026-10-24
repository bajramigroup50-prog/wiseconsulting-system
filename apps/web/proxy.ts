/**
 * Device guard first (🔐 enrolled computers, `lib/device-guard.ts`): with `DEVICE_CERTS=optional|required` a request
 * whose TLS client certificate (fingerprint from Caddy) is revoked / unknown — or, when required, missing — gets a 403
 * page with a short closing message; a client user on a device bound to another firm likewise.
 *
 * Global route guard (Next 16 `proxy`, Node.js runtime) for the restricted roles: a `klient` user reaches only the
 * client portal of their firm and a `teren` user only their tasks — direct URLs, print views and API endpoints
 * included (`lib/route-guard.ts`, unit-tested). 🎭 Demo users and 🔒 book-only colleagues („Колегите гледаат само
 * сметководство“) go through one allow-list gate (views by path, server actions by source file). Everybody else passes
 * through; pages and actions keep their own checks.
 */
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, sessions, userFirms, users } from '@wise/db';
import { FP_HEADER, type DeviceRow, deviceMode, devicePage, deviceUserOk, deviceVerdict, normFp } from './lib/device-guard';
import { deviceByFp, touchDevice } from './lib/device-lookup';
import { firmKlientViews, klientViews } from './lib/kl-views';
import { DEMO_OFF_MSG } from '@wise/core/demo';
import { actionFile } from './lib/action-manifest';
import {
  BOOK_ONLY_MSG, PREVIEW_COOKIE, TEREN_VIEWS, bookActionAllowed, bookVerdict, demoActionAllowed, demoVerdict, isGuardRole, portalActionAllowed, previewVerdict, publicPath, routeVerdict,
} from './lib/route-guard';
import { viewsOf } from './lib/view-access';
import { FIRM_MISMATCH_HEADER, staleTab } from './lib/firm-guard';

const SESSION_COOKIE = 'wc_sess';
const FIRM_COOKIE = 'wc_fid';
const ABSOLUTE_MS = 8 * 36e5; // = lib/auth.ts

const deny = (reason: Parameters<typeof devicePage>[0]) =>
  new NextResponse(devicePage(reason), { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export async function proxy(req: NextRequest) {
  const mode = deviceMode(process.env.DEVICE_CERTS);
  let device: DeviceRow | null = null;
  if (mode !== 'off') {
    const fp = normFp(req.headers.get(FP_HEADER));
    const v = deviceVerdict(mode, req.nextUrl.pathname, fp, fp ? await deviceByFp(fp) : null);
    // 🎭 a buyer opens the demo in an ordinary browser (no enrolled certificate): only the demo link and a demo
    // user's session pass without one — a revoked / unknown certificate is still refused
    if (!v.ok && !(v.reason === 'none' && await demoRequest(req))) return deny(v.reason);
    device = v.ok ? v.device : null;
    if (device) void touchDevice(device.id, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null);
  }
  const res = await route(req, device);
  // tab / window guard signal: a mutation from a page of another firm / year → that tab shows „освежете ја страницата“
  // (the refusal itself is in `currentFirm` / `currentYear`)
  const stale = staleTab(req.method, (h) => req.headers.get(h), (c) => req.cookies.get(c)?.value);
  if (stale) res.headers.set(FIRM_MISMATCH_HEADER, stale);
  return res;
}

async function route(req: NextRequest, device: DeviceRow | null): Promise<NextResponse> {
  const p = req.nextUrl.pathname;
  // a server action posted to a public page still goes through the user checks below (🎭 demo action gate)
  if (publicPath(p) && !req.headers.get('next-action')) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.next();
  const [u] = await getDb().select({ id: users.id, role: users.role, demo: users.demo, viewAccess: users.viewAccess }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, createHash('sha256').update(token).digest('hex')), gt(sessions.expiresAt, new Date()),
      gt(sessions.createdAt, new Date(Date.now() - ABSOLUTE_MS)), eq(users.active, true))).limit(1);
  if (!u) return NextResponse.next();
  // 🎭 demo user: the demo allow-list of views (`lib/route-guard.ts` `demoVerdict`), whatever the role
  if (u.demo) {
    // a server action is refused unless it is defined by an allowed view (an action id can be posted to any page)
    const action = req.headers.get('next-action');
    if (action && req.method === 'POST' && !demoActionAllowed(await actionFile(action))) {
      return NextResponse.json({ error: DEMO_OFF_MSG }, { status: 403 });
    }
    const dv = demoVerdict(p);
    if (!dv) return NextResponse.next();
    if (dv === '403') return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
    return NextResponse.redirect(new URL(dv, req.url));
  }
  if (device?.firmId && u.role === 'klient') {
    const F = (await getDb().select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))).map((r) => r.f);
    if (!deviceUserOk(device, u.role, F, req.cookies.get(FIRM_COOKIE)?.value)) return deny('firm');
  }
  if (!isGuardRole(u.role)) {
    // 🔒 „Колегите гледаат само сметководство“: a colleague (not the owner) gets the bookkeeping allow-list — the same
    // gate as the demo (views by path, server actions by source file; `lib/route-guard.ts` `bookVerdict`)
    const V = await viewsOf(getDb(), u, u.viewAccess);
    if (V) {
      const action = req.headers.get('next-action');
      if (action && req.method === 'POST' && !bookActionAllowed(await actionFile(action), V)) {
        return NextResponse.json({ error: BOOK_ONLY_MSG }, { status: 403 });
      }
      const bv = bookVerdict(p, V);
      if (bv === '403') return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
      if (bv) return NextResponse.redirect(new URL(bv, req.url));
    }
    // legacy `S.asClient`: an office user previewing the client portal of the current firm sees only its sections
    // (the cookie only narrows what an office user is shown; the klient guard below is unchanged)
    const pv = req.cookies.get(PREVIEW_COOKIE)?.value, fid = req.cookies.get(FIRM_COOKIE)?.value;
    if (!pv || pv !== fid) return NextResponse.next();
    const pvv = previewVerdict(p, await firmKlientViews(fid));
    return pvv ? NextResponse.redirect(new URL(pvv, req.url)) : NextResponse.next();
  }
  const views = u.role === 'klient' ? await klientViews(u.id, req.cookies.get(FIRM_COOKIE)?.value) : [];
  // a client / field worker posts only the actions of its own sections (its role carries `write` on the firm)
  const action = req.headers.get('next-action');
  if (action && req.method === 'POST' && !portalActionAllowed(await actionFile(action), u.role === 'teren' ? [...TEREN_VIEWS, 'kanc'] : views)) {
    return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
  }
  const v = routeVerdict(u.role, p, views);
  if (!v) return NextResponse.next();
  if (v === '403') return NextResponse.json({ error: 'Немате пристап.' }, { status: 403 });
  return NextResponse.redirect(new URL(v, req.url));
}

/** The demo link itself, or a request of a live demo user's session (for the device guard without a certificate). */
async function demoRequest(req: NextRequest): Promise<boolean> {
  if (req.nextUrl.pathname.startsWith('/demo/')) return true;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const [u] = await getDb().select({ demo: users.demo }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, createHash('sha256').update(token).digest('hex')), gt(sessions.expiresAt, new Date()), eq(users.active, true))).limit(1);
  return !!u?.demo;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
