import 'server-only';
/** Firm list report data (legacy `frList`) shared by the PDF print view and the Excel route. */
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { frList, isFrFilter, type FrFilter } from '@wise/core/firms/firmform';
import { firms, userFirms } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';

export async function firmReport(u: SessionUser, sp: { f?: string; ex?: string }) {
  const k: FrFilter = isFrFilter(sp.f) ? sp.f : 'all';
  const scoped = u.principal.firms.includes('*')
    ? undefined
    : or(inArray(firms.id, db().select({ id: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, u.id))), eq(firms.ownerId, u.id));
  const all = await db().select().from(firms).where(and(scoped, eq(firms.active, true))).orderBy(asc(firms.name));
  const R = all.map((f) => {
    const s = (f.settings ?? {}) as { example?: boolean; vatFrom?: string };
    return { ...f, example: s.example === true, vatFrom: s.vatFrom ?? '' };
  });
  return { k, list: frList(R, k, sp.ex !== '0') };
}
