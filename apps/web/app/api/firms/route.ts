import { type NextRequest } from 'next/server';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import { firms, userFirms } from '@wise/db';
import { getUser } from '@/lib/auth';
import { db } from '@/lib/db';

/** Firm search for the "⇄ Промени фирма" window: firms the user can access, max 50. */
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const search = q
    ? and(...q.split(/\s+/).map((w) => `%${w}%`).map((w) => or(ilike(firms.name, w), ilike(firms.edb, w), ilike(firms.embs, w), ilike(firms.city, w))))
    : undefined;
  const rows = await db()
    .select({ id: firms.id, name: firms.name, edb: firms.edb, city: firms.city, vatRegistered: firms.vatRegistered, vatPeriod: firms.vatPeriod })
    .from(firms)
    .where(and(eq(firms.active, true), scoped, search))
    .orderBy(asc(firms.name))
    .limit(50);
  return Response.json(rows);
}
