import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { firmAllowed } from '@wise/core';
import { firms } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentFirm, currentYear, FIRM_COOKIE, YEAR_COOKIE } from '@/lib/context';
import { db } from '@/lib/db';

/**
 * The firm and year of the session now (`components/firm-guard.tsx` compares them with what its tab was rendered for
 * when the window gets the focus). Only the caller's own selection; ids, no names.
 */
export async function GET() {
  const u = await getUser();
  if (!u) return Response.json({ error: 'Најавете се.' }, { status: 401 });
  const [f, year] = await Promise.all([currentFirm(u, { check: false }), currentYear({ check: false })]);
  return Response.json({ firm: f?.id ?? '', year: String(year) }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * A tab takes the session back to the firm + year it shows (`components/firm-guard.tsx`, on focus after another tab
 * switched): the same checks and cookies as `selectFirm` / `setYear`.
 */
export async function POST(req: Request) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'Најавете се.' }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { firm?: unknown; year?: unknown } | null;
  const id = typeof b?.firm === 'string' && /^[0-9a-f-]{36}$/i.test(b.firm) ? b.firm : null;
  const year = Number(b?.year);
  if (!id) return Response.json({ error: 'firm' }, { status: 400 });
  const [f] = await db().select({ id: firms.id, ownerId: firms.ownerId, active: firms.active }).from(firms).where(eq(firms.id, id)).limit(1);
  if (!f || !f.active || !firmAllowed(u.principal, f.id, f.ownerId)) return Response.json({ error: 'Немате пристап до оваа фирма.' }, { status: 403 });
  const o = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' };
  const jar = await cookies();
  jar.set(FIRM_COOKIE, f.id, o);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) jar.set(YEAR_COOKIE, String(year), o);
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
