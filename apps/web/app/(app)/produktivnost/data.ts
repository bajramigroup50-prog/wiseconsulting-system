import 'server-only';
/**
 * 📊 Продуктивност на вработените — loader shared by the screen, the print view (PDF) and the Excel export:
 * the audit rows of the period (office users and automatic jobs; client users are left out), aggregated by
 * `@wise/core/office/productivity`.
 */
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays } from '@wise/core/office';
import { aggregateProductivity, parsePeriod, type AuditRowIn, type PeriodPreset, type ProductivityReport } from '@wise/core/office/productivity';
import { auditLog, firms, users } from '@wise/db';
import type { Role } from '@wise/core';
import { getUser, requireUser, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { viewAllowed } from '@/lib/nav';
import { isUuid, today } from '@/lib/office';
import { firmSideSql, ownerContext, scopeAuditSql, userSideSql } from '@/lib/demo-office';

/** `u` = a user id, `-` = automatic jobs (no user), empty = everybody. */
export interface ProdFilter { from: string; to: string; preset: PeriodPreset | ''; user: string; firm: string }

export function prodFilter(sp: Record<string, string | string[] | undefined>): ProdFilter {
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : ''; };
  const p = parsePeriod({ p: one('p'), od: one('od'), do: one('do') }, today());
  const u = one('u');
  return { ...p, user: u === '-' || isUuid(u) ? u : '', firm: isUuid(one('f')) ? one('f') : '' };
}

/** Query string of a filter (for the export links and the drill-down). */
export function prodQs(f: ProdFilter, over: Partial<ProdFilter> = {}): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.preset && !over.from && !over.to) q.set('p', x.preset); else { q.set('od', x.from); q.set('do', x.to); }
  if (x.user) q.set('u', x.user);
  if (x.firm) q.set('f', x.firm);
  return q.toString();
}

/** Actions whose `data` the aggregation reads (volumes); every other row is loaded without it. */
const DATA_ACTIONS = ['saveInv', 'editInv', 'savePur', 'editPur', 'importBank', 'autoMatch'];

export interface ProdUser { id: string; name: string; role: Role; active: boolean }
export interface ProdData {
  report: ProductivityReport;
  users: Map<string, ProdUser>;
  firms: Map<string, string>;
  /** Users for the filter (office users, not clients). */
  userList: ProdUser[];
  firmList: { id: string; name: string }[];
}

/**
 * 🎭 `me`: the viewer — a demo admin (owner of the demo office) gets only demo users / demo firms / their audit rows;
 * the real owner (and `null`, the default) never gets a demo user, firm or row (`lib/demo-office.ts`).
 */
export async function loadProductivity(f: ProdFilter, me: Pick<SessionUser, 'principal' | 'role'> | null = null): Promise<ProdData> {
  // a day either side: the Skopje day of a row is decided in the aggregation
  const lo = new Date(`${addDays(f.from, -1)}T00:00:00Z`), hi = new Date(`${addDays(f.to, 2)}T00:00:00Z`);
  const where: (SQL | undefined)[] = [gte(auditLog.at, lo), lt(auditLog.at, hi), or(isNull(auditLog.userId), ne(users.role, 'klient')), scopeAuditSql(me)];
  if (f.user === '-') where.push(isNull(auditLog.userId));
  else if (f.user) where.push(eq(auditLog.userId, f.user));
  if (f.firm) where.push(eq(auditLog.firmId, f.firm));
  const [rows, U, F] = await Promise.all([
    db().select({
      at: auditLog.at, userId: auditLog.userId, firmId: auditLog.firmId, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId,
      data: sql<Record<string, unknown> | null>`case when ${or(inArray(auditLog.action, DATA_ACTIONS), eq(auditLog.entityType, 'journal'))} then ${auditLog.data} else null end`,
    }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).where(and(...where)),
    db().select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).where(and(ne(users.role, 'klient'), userSideSql(me))).orderBy(asc(users.name)),
    db().select({ id: firms.id, name: firms.name }).from(firms).where(firmSideSql(me)).orderBy(asc(firms.name)),
  ]);
  const report = aggregateProductivity(rows.map((r): AuditRowIn => ({ ...r, at: r.at instanceof Date ? r.at : new Date(r.at), data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data })), f);
  return { report, users: new Map(U.map((u) => [u.id, u])), firms: new Map(F.map((x) => [x.id, x.name])), userList: U, firmList: F };
}

export const userName = (D: ProdData, id: string | null): string => (id ? D.users.get(id)?.name ?? '(избришан корисник)' : '⚙ Автоматски (систем)');
export const firmName = (D: ProdData, id: string | null): string => (id ? D.firms.get(id) ?? '(избришана фирма)' : '— без фирма (општо)');

/**
 * Guard of the screen, print view and export: office users only (the route guard already keeps clients and field
 * workers out), and of those only the office owner — or 🎭 a demo admin for the demo office (`ownerContext`, `demo`).
 */
export async function ownerGate(): Promise<{ u: SessionUser; ok: boolean; demo: boolean }> {
  const u = await requireUser();
  const c = viewAllowed(u.role, 'produktivnost') ? await ownerContext(u) : null;
  return { u, ok: !!c, demo: !!c?.demo };
}
export async function ownerGateApi(): Promise<SessionUser | null> {
  const u = await getUser();
  return u && viewAllowed(u.role, 'produktivnost') && await ownerContext(u) ? u : null;
}
