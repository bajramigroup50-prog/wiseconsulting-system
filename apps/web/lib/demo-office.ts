import 'server-only';
/**
 * 🎭 The DEMO OWNER context — the office / owner views (activity log, productivity, contracts, fee invoices, firm report,
 * deadlines, client reports, tasks, client inbox, AI cost) for a demo ADMIN, showing only the sandboxed demo office.
 *
 * Never by making `isOfficeOwner` true (it is always false for a demo user) and never through a real-owner code path:
 * every owner view asks `ownerContext(u)` → `{ demo: false }` for the real office owner, `{ demo: true }` for a demo
 * admin, `null` for everybody else, and then reads / writes its side only:
 *  - firms: `firmSideSql(u)` (demo firms ↔ real firms), users: `userSideSql(u)` (demo users ↔ real users);
 *  - audit rows: `scopeAuditSql(u)`; office tasks: `taskScopeSql(u)`;
 *  - the office profile: `officeProfileFor(u)` / `patchOfficeProfileFor` (app_settings `demoOffice` ↔ `office`);
 *  - the office firm: `officeFirmFor(u)` (the demo office firm „ДЕМО СМЕТКОВОДСТВО ДООЕЛ“ ↔ the real office firm).
 * Ids coming from a form are re-checked against the side (`assertFirmSide`, `assertUserSide`, `assertTaskSide`).
 * Real users get the mirror image: never a demo firm / demo user / demo row in their office lists.
 */
import { and, eq, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { isDemoFirm } from '@wise/core/demo';
import {
  auditLog, demoFirmSql, files, firms, getOfficeProfile, officeFirmOf, OfficeError, officeTasks, patchOfficeProfile, realFirmSql, users, type Firm, type OfficeProfile, type Tx,
} from '@wise/db';
import { getUser, requireUser, type SessionUser } from './auth';
import { db } from './db';
import { isDemoUser } from './demo';
import { isOfficeOwner, OWNER_ONLY_MSG } from './office-owner';
import { demoViews } from './route-guard';

type U = Pick<SessionUser, 'principal' | 'role'> & { demo?: boolean };

/** A demo ADMIN: the owner of the sandboxed demo office (never the real office owner). */
export const isDemoOwner = (u: U | null | undefined): boolean => !!u && isDemoUser(u) && u.role === 'admin';

/** The owner context of a user: the real office owner, the demo office's owner (a demo admin), or nobody. */
export interface OwnerCtx { u: SessionUser; demo: boolean }
export async function ownerContext(u: SessionUser | null | undefined): Promise<OwnerCtx | null> {
  if (!u) return null;
  if (isDemoUser(u)) return isDemoOwner(u) ? { u, demo: true } : null;
  return (await isOfficeOwner(u)) ? { u, demo: false } : null;
}

/** Pages / routes: the owner context of the signed-in user (no throw). */
export const ownerPage = async (): Promise<OwnerCtx | null> => ownerContext(await getUser());

/** Server actions: the owner context, else „Само за сопственикот на канцеларијата.“ */
export async function requireOwner(): Promise<OwnerCtx> {
  const c = await ownerContext(await requireUser());
  if (!c) throw new OfficeError(OWNER_ONLY_MSG);
  return c;
}

/** The menu of a demo user keeps exactly the route-guard allow-list (`DEMO_BOOK_VIEWS` + `DEMO_OFFICE_VIEWS`). */
export const demoNavViews = (): readonly string[] => [...demoViews()];

/* ---------------- office profile / office firm ---------------- */

/** The office profile this user sees: the demo office's copy (`demoOffice`) for a demo user, else the real one. */
export const officeProfileFor = (u: U | null | undefined, tx: Tx = db()): Promise<OfficeProfile> =>
  getOfficeProfile(tx, { demo: isDemoUser(u) });

/** Writes of the office profile by this user: a demo user only ever writes the demo office's copy. */
export const patchOfficeProfileFor = (tx: Tx, u: U & { id: string }, patch: Partial<OfficeProfile> & Record<string, unknown>): Promise<void> =>
  patchOfficeProfile(tx, patch, u.id, { demo: isDemoUser(u) });

/** The demo office firm („ДЕМО СМЕТКОВОДСТВО ДООЕЛ“, a demo firm with `settings.demoOffice`), or null. */
export async function demoOfficeFirm(tx: Tx = db()): Promise<Firm | null> {
  return officeFirmOf(await tx.select().from(firms).where(demoFirmSql), null, { demo: true });
}

/** The office firm of this user's side: the demo office firm for a demo user, the real office firm (never a demo firm) otherwise. */
export async function officeFirmFor(u: U | null | undefined, O?: { edb?: string | null }): Promise<Firm | null> {
  if (isDemoUser(u)) return demoOfficeFirm();
  return officeFirmOf(await db().select().from(firms).where(realFirmSql), O ?? await getOfficeProfile(db()));
}

/* ---------------- sides ---------------- */

/** `firms` rows of this user's side: demo firms for a demo user, real firms for everybody else. */
export const firmSideSql = (u: U | null | undefined): SQL => (isDemoUser(u) ? demoFirmSql : realFirmSql);
/** `users` rows of this user's side. */
export const userSideSql = (u: U | null | undefined): SQL => (isDemoUser(u) ? eq(users.demo, true) : not(eq(users.demo, true)));
/** Is this firm on the user's side (flag + prefix for demo)? */
export const firmOnSide = (u: U | null | undefined, f: { name: string | null; settings?: unknown } | null | undefined): boolean =>
  !!f && isDemoFirm(f) === isDemoUser(u);

const demoUsersSq = () => db().select({ id: users.id }).from(users).where(eq(users.demo, true));
const demoFirmsSq = () => db().select({ id: firms.id }).from(firms).where(demoFirmSql);

/**
 * Audit rows a user may see in the office views:
 *  - demo: the user is a demo user or nobody, the firm is a demo firm or none, and at least one of them is demo
 *    (never a real user's or a real firm's row, never a system row of nobody);
 *  - real: no demo user and no demo firm.
 */
export function scopeAuditSql(u: U | null | undefined): SQL {
  const du = inArray(auditLog.userId, demoUsersSq()), df = inArray(auditLog.firmId, demoFirmsSq());
  if (isDemoUser(u)) return and(or(isNull(auditLog.userId), du), or(isNull(auditLog.firmId), df), or(du, df))!;
  // real: never a demo user / firm, nor a seeded demo row orphaned by a demo reset (audit_log is append-only: the reset
  // leaves them with user_id / firm_id NULL, tagged entity_type 'demo' / data.demo)
  return and(or(isNull(auditLog.userId), not(du)), or(isNull(auditLog.firmId), not(df)),
    sql`${auditLog.entityType} is distinct from 'demo'`, sql`coalesce(${auditLog.data} ->> 'demo', '') <> 'true'`)!;
}

/**
 * Office tasks of a side:
 *  - demo: firm none or demo, creator none or demo, assignee none or demo, not a firm-formation task, and at least one
 *    of firm / creator / assignee demo;
 *  - real: no demo firm, no demo creator, no demo assignee.
 */
export function taskScopeSql(u: U | null | undefined): SQL {
  const t = officeTasks;
  const df = inArray(t.firmId, demoFirmsSq()), dc = inArray(t.createdBy, demoUsersSq()), da = inArray(t.assigneeId, demoUsersSq());
  if (isDemoUser(u)) {
    return and(or(isNull(t.firmId), df), or(isNull(t.createdBy), dc), or(isNull(t.assigneeId), da), isNull(t.formationId), or(df, dc, da))!;
  }
  return and(or(isNull(t.firmId), not(df)), or(isNull(t.createdBy), not(dc)), or(isNull(t.assigneeId), not(da)))!;
}

/* ---------------- checks of ids from a form ---------------- */

/** The firm (by id) when it is on the user's side, else an error (a forged id of the other side never passes). */
export async function assertFirmSide(u: U, id: unknown, tx: Tx = db()): Promise<Firm> {
  const [f] = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? await tx.select().from(firms).where(eq(firms.id, id)).limit(1) : [];
  if (!f || !firmOnSide(u, f)) throw new OfficeError('Фирмата не постои.');
  return f;
}

/** The user (by id) is on the side of `u` (a demo user only ever names demo users). */
export async function assertUserSide(u: U, id: string | null | undefined, tx: Tx = db()): Promise<void> {
  if (!id) return;
  const [x] = await tx.select({ demo: users.demo }).from(users).where(eq(users.id, id)).limit(1);
  if (!x || !!x.demo !== isDemoUser(u)) throw new OfficeError('Корисникот не постои.');
}

/** The office task (by id) is on the side of `u`. */
export async function assertTaskSide(u: U, id: string, tx: Tx = db()): Promise<void> {
  const [t] = /^[0-9a-f-]{36}$/i.test(id) ? await tx.select({ id: officeTasks.id }).from(officeTasks).where(and(eq(officeTasks.id, id), taskScopeSql(u))).limit(1) : [];
  if (!t) throw new OfficeError('Задачата не постои.');
}

/**
 * File ids from a form a 🎭 demo user may attach to an office-wide record: only files a demo user uploaded (a real
 * office file id, even if known, is dropped). Real users: unchanged.
 */
export async function sideFileIds(u: U, ids: readonly unknown[], tx: Tx = db()): Promise<unknown[]> {
  if (!isDemoUser(u)) return [...ids];
  const want = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))];
  if (!want.length) return [];
  return (await tx.select({ id: files.id }).from(files).where(and(inArray(files.id, want), inArray(files.uploadedBy, demoUsersSq())))).map((r) => r.id);
}

/** SQL `true` / `false` helper for an empty id list. */
export const inIds = (col: Parameters<typeof inArray>[0], ids: readonly string[]): SQL => (ids.length ? inArray(col, [...ids]) : sql`false`);
