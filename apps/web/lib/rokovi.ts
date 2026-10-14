import 'server-only';
/**
 * „📅 Календар на рокови“ — reading the stored deadlines for the screen, the ICS export and the top-bar counter.
 * Scoped to the firms the user may open (`allowedFirms`); the service-contract rows (`kdog`) only for the office owner.
 */
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import { isRokType, rokDays, type RokSettings } from '@wise/core/office/rokovi';
import { getOfficeProfile, rokovi, userFirms, users, type RokRow } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';
import { allowedFirms, today } from './office';
import { isOfficeOwner } from './office-owner';

export interface RokQuery { from: string; to: string; fid?: string; uid?: string; t?: string; st?: 'open' | 'done' | 'all' }
export type RokView = RokRow & { firm: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** Rows for the filters (firm, colleague, type, status) in `[from, to]`, by date. */
export async function rokRows(u: SessionUser, q: RokQuery) {
  const [F, owner] = await Promise.all([allowedFirms(u), isOfficeOwner(u).catch(() => false)]);
  const name = new Map(F.map((f) => [f.id, f.name]));
  let ids = F.map((f) => f.id);
  if (q.fid && UUID.test(q.fid)) ids = ids.filter((x) => x === q.fid);
  if (q.uid && UUID.test(q.uid)) {
    const mine = new Set((await db().select({ f: userFirms.firmId }).from(userFirms).where(eq(userFirms.userId, q.uid))).map((r) => r.f));
    ids = ids.filter((x) => mine.has(x));
  }
  const rows = ids.length ? await db().select().from(rokovi).where(and(
    inArray(rokovi.firmId, ids), eq(rokovi.gone, false), gte(rokovi.due, q.from), lte(rokovi.due, q.to),
    q.t && isRokType(q.t) ? eq(rokovi.type, q.t) : undefined,
    owner ? undefined : ne(rokovi.type, 'kdog'),
    q.st === 'done' ? eq(rokovi.done, true) : q.st === 'all' ? undefined : eq(rokovi.done, false),
  )).orderBy(asc(rokovi.due), asc(rokovi.title)) : [];
  return { rows: rows.map((r) => ({ ...r, firm: name.get(r.firmId) ?? '' })) as RokView[], firms: F, owner };
}

/** Office colleagues for the filter (active, not clients / field staff). */
export async function rokColleagues() {
  return db().select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.active, true), sql`${users.role} not in ('klient', 'teren')`)).orderBy(asc(users.name));
}

/** Top-bar counter: open deadlines due within the reminder window (incl. late ones of the last 30 days). */
export async function rokBadge(u: SessionUser, firmIds: readonly string[]): Promise<{ n: number; late: number } | null> {
  if (!firmIds.length) return null;
  const S = ((await getOfficeProfile(db())) as { rok?: RokSettings }).rok;
  const td = today();
  const owner = await isOfficeOwner(u).catch(() => false);
  const [r] = await db().select({
    n: sql<number>`count(*)::int`, late: sql<number>`count(*) filter (where ${rokovi.due} < ${td})::int`,
  }).from(rokovi).where(and(
    inArray(rokovi.firmId, [...firmIds]), eq(rokovi.done, false), eq(rokovi.gone, false),
    gte(rokovi.due, addDays(td, -30)), lte(rokovi.due, addDays(td, rokDays(S))), owner ? undefined : ne(rokovi.type, 'kdog'),
  ));
  return { n: r?.n ?? 0, late: r?.late ?? 0 };
}
