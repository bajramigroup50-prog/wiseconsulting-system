/**
 * 🔗 `/demo/<token>` — the owner's demo link (`lib/demo-links.ts`). The ONLY place a demo token is accepted.
 * Valid (known by hash, not revoked, not expired, its user an active demo user) → the current session (if any) ends, a
 * normal session of the demo user starts (`sessions.demo_link_id`), the year and the first demo firm are chosen, and
 * the browser goes to the demo dashboard. Anything else → the same neutral page „Линкот не важи – побарајте нов“.
 * Rate-limited per IP (10 per 15 minutes, valid or not). Works in any browser — the desktop app is not needed.
 */
import { cookies, headers } from 'next/headers';
import { DEMO_LINK_BAD_MSG } from '@wise/core/demo';
import { createSession, destroySession } from '@/lib/auth';
import { calendarYear } from '@/lib/context';
import { demoRateHit, firstDemoFirm, noteDemoLinkUse, usableDemoLink } from '@/lib/demo-links';
import { clientIp } from '@/lib/login-guard';

const page = (msg: string, status: number) => new Response(
  '<!doctype html><html lang="mk"><head><meta charset="utf-8"><title>WISE CONSULTING</title>'
  + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"></head>'
  + '<body style="font-family:Segoe UI,Arial,sans-serif;padding:40px;color:#0d5b4b;max-width:640px">'
  + `<h2>WISE CONSULTING</h2><p>${msg}</p></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } },
);

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const h = await headers();
  if (!(await demoRateHit(clientIp((n) => h.get(n))))) return page('Премногу обиди. Обидете се повторно подоцна.', 429);
  const link = await usableDemoLink(token);
  if (!link) return page(DEMO_LINK_BAD_MSG, 404);
  await destroySession();
  await createSession(link.userId, { demoLinkId: link.id });
  await noteDemoLinkUse(link.id, link.userId);
  const jar = await cookies();
  const base = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' };
  jar.set('wc_year', String(calendarYear()), base);
  const fid = await firstDemoFirm();
  if (fid) jar.set('wc_fid', fid, base);
  return new Response(null, { status: 303, headers: { location: '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
