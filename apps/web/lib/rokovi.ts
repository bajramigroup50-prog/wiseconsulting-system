import 'server-only';
/**
 * „📅 Календар на рокови“ — reading the stored deadlines for the screen, the ICS export and the top-bar counter.
 * Scoped to the firms the user may open (`allowedFirms`); the service-contract rows (`kdog`) only for the office owner.
 * 🎭 By side (`lib/demo-office.ts`): a demo user sees demo firms and demo colleagues only (the demo admin = the demo
 * office's owner sees the demo contracts' rows), real users never a demo firm or a demo colleague.
 *
 * „Мои фирми“ (`@wise/db` `rokMyFirmIds`): the firms assigned to the user or where the user is the responsible
 * colleague; none → all. The owner sees all firms by default, everybody else only theirs; the choice „Само мои фирми /
 * Сите фирми“ on /rokovi is remembered per user (`rokScopeGet`) and drives the 📅 counter and the list alike.
 */
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { isRokType } from '@wise/core/office/rokovi';
import { rokCounts, rokMyFirmIds, rokovi, rokScopeGet, users, type RokRow } from '@wise/db';
import type { SessionUser } from './auth';
import { db } from './db';
import { allowedFirms, today } from './office';
import { ownerContext, userSideSql } from './demo-office';

export interface RokQuery { from: string; to: string; fid?: string; uid?: string; t?: string; st?: 'open' | 'done' | 'all'; mine?: boolean }
export type RokView = RokRow & { firm: string };

const UUID = /^[0-9a-f-]{36}$/i;

const isOwner = (u: SessionUser) => ownerContext(u).then((c) => !!c).catch(() => false);

/** The user's scope: `true` = only my firms. Default: the owner all firms, everybody else only theirs. */
export async function rokScopeMine(u: SessionUser, owner?: boolean): Promise<boolean> {
  const v = await rokScopeGet(db(), u.id).catch(() => null);
  return v ?? !(owner ?? await isOwner(u));
}

/** Rows for the filters (firm, colleague, type, status, my firms) in `[from, to]`, by date. */
export async function rokRows(u: SessionUser, q: RokQuery) {
  const [A, owner] = await Promise.all([allowedFirms(u), isOwner(u)]);
  const scoped = q.mine ? new Set(await rokMyFirmIds(db(), u.id, A.map((f) => f.id))) : null;
  const F = scoped ? A.filter((f) => scoped.has(f.id)) : A;
  const name = new Map(F.map((f) => [f.id, f.name]));
  let ids = F.map((f) => f.id);
  if (q.fid && UUID.test(q.fid)) ids = ids.filter((x) => x === q.fid);
  // the colleague filter (assigned or responsible): a colleague of the user's side only
  if (q.uid && UUID.test(q.uid) && ids.length && (await rokColleagues(u)).some((x) => x.id === q.uid)) {
    const mine = new Set(await rokMyFirmIds(db(), q.uid, ids, { fallback: false }));
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

/** Office colleagues for the filter (active, not clients / field staff) — of the user's side (🎭 demo users ↔ real users). */
export async function rokColleagues(u: Pick<SessionUser, 'principal' | 'role'> | null = null) {
  return db().select({ id: users.id, name: users.name }).from(users)
    .where(and(eq(users.active, true), sql`${users.role} not in ('klient', 'teren')`, userSideSql(u))).orderBy(asc(users.name));
}

/**
 * Top-bar counter: open deadlines due this week (today + 6 days) and overdue (before today), in the user's scope.
 * One aggregate over the stored rows (the worker keeps them fresh every morning) — nothing is generated here.
 */
export async function rokBadge(u: SessionUser, firmIds: readonly string[]): Promise<{ week: number; late: number; mine: boolean } | null> {
  if (!firmIds.length) return null;
  const owner = await isOwner(u);
  const mine = await rokScopeMine(u, owner);
  const ids = mine ? await rokMyFirmIds(db(), u.id, firmIds) : [...firmIds];
  const c = await rokCounts(db(), { firmIds: ids, today: today(), kdog: owner });
  return { ...c, mine };
}
