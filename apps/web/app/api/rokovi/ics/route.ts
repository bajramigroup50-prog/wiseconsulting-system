/**
 * „📅 Календар на рокови“ → ICS (iCalendar, all-day events) for Outlook / Google Calendar / the phone:
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD&fid&uid&t&st=open|done|all` — the same filters as the screen, the user's firms only.
 */
import { can } from '@wise/core';
import { addDays } from '@wise/core/office';
import { rokIcs } from '@wise/core/office/rokovi';
import { getUser } from '@/lib/auth';
import { today } from '@/lib/office';
import { rokRows } from '@/lib/rokovi';

const D = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const u = await getUser();
  if (!u) return new Response('unauthorized', { status: 401 });
  if (u.role === 'klient' || u.role === 'teren' || !can(u.principal, 'office', null)) return new Response('forbidden', { status: 403 });
  const q = new URL(req.url).searchParams;
  const td = today();
  let from = q.get('from') ?? '', to = q.get('to') ?? '';
  if (!D.test(from)) from = addDays(td, -30);
  if (!D.test(to) || to < from) to = addDays(td, 120);
  if (to > addDays(from, 800)) to = addDays(from, 800);
  const st = q.get('st');
  const { rows } = await rokRows(u, { from, to, fid: q.get('fid') ?? undefined, uid: q.get('uid') ?? undefined, t: q.get('t') ?? undefined, st: st === 'done' || st === 'all' ? st : 'open', mine: q.get('sc') === 'moi' });
  const origin = new URL(req.url).origin;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = rokIcs(rows.map((r) => ({ key: r.key, firmId: r.firmId, title: r.title, due: r.due, verified: r.verified, firm: r.firm, done: r.done, url: `${origin}/rokovi?v=lista` })), stamp);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="rokovi-${from}-${to}.ics"`,
      'cache-control': 'private, no-store',
    },
  });
}
