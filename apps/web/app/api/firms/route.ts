import { type NextRequest } from 'next/server';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { firmListedIn, firms, userFirms } from '@wise/db';
import { getUser } from '@/lib/auth';
import { currentYear } from '@/lib/context';
import { db } from '@/lib/db';
import { firmBadges } from '@/lib/top-status';

/** Firm search for the "⇄ Промени фирма" window: firms the user can access that work in the selected year, max 50, with the open notifications (legacy `alFirmBadge`). */
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const year = await currentYear();
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const search = q
    ? and(...q.split(/\s+/).map((w) => `%${w}%`).map((w) => or(ilike(firms.name, w), ilike(firms.edb, w), ilike(firms.embs, w), ilike(firms.city, w))))
    : undefined;
  const [rows, B] = await Promise.all([
    db()
      .select({ id: firms.id, name: firms.name, edb: firms.edb, city: firms.city, vatRegistered: firms.vatRegistered, vatPeriod: firms.vatPeriod })
      .from(firms)
      .where(and(firmListedIn(year), scoped, search))
      .orderBy(asc(firms.name))
      .limit(50),
    u.role === 'klient' || u.role === 'teren' ? Promise.resolve(null) : firmBadges(u).catch(() => null),
  ]);
  return Response.json(rows.map((r) => ({ ...r, al: B ? B.get(r.id) ?? { n: 0, bad: 0, txt: [] } : null })));
}
