/**
 * ISO квалитет of the office (`iso_records`): save / status / delete with the audit, the starting documents, and the
 * evidence the system already holds (users and roles, the change log, system errors) for ISO 27001 / 9001, and the
 * personal-data records of the ЗЗЛП screen (`gdpr_records`) the ISO 27701 part links to.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { isoAutoDue, isoKind, isoStarters, type IsoKind, type IsoStatus } from '@wise/core/office/iso';
import { audit, type Tx } from './audit';
import { appErrors, auditLog, gdprRecords, isoRecords, users } from './schema/index';

export class IsoError extends Error { constructor(m: string) { super(m); this.name = 'IsoError'; } }

export interface IsoInput { id?: string | null; kind: string; title: string; status?: string | null; due?: string | null; firmId?: string | null; ownerId?: string | null; data: Record<string, unknown> }

const STATUSES: readonly IsoStatus[] = ['open', 'progress', 'done'];

export async function saveIsoRecord(tx: Tx, a: IsoInput, userId: string | null, today: string): Promise<string> {
  const def = isoKind(a.kind);
  if (!def) throw new IsoError('Непознат регистар.');
  const title = a.title.trim();
  if (!title) throw new IsoError('Внесете наслов.');
  const status = (STATUSES as readonly string[]).includes(a.status ?? '') ? (a.status as IsoStatus) : 'open';
  // only the register's own fields are kept
  const data = Object.fromEntries(def.fields.map((f) => [f.k, a.data[f.k]]).filter(([, v]) => v != null && v !== ''));
  const base = { title, status, due: a.due || isoAutoDue(def.k, data, today), firmId: a.firmId || null, ownerId: a.ownerId || null, data, closedAt: status === 'done' ? new Date() : null };
  if (a.id) {
    const [old] = await tx.select().from(isoRecords).where(eq(isoRecords.id, a.id)).limit(1);
    if (!old) throw new IsoError('Записот не постои.');
    await tx.update(isoRecords).set({ ...base, closedAt: status === 'done' ? old.closedAt ?? new Date() : null }).where(eq(isoRecords.id, a.id));
    await audit(tx, { userId, action: 'isoSave', entityType: 'iso_record', entityId: a.id, data: { kind: old.kind, status } });
    return a.id;
  }
  const year = Number(today.slice(0, 4));
  const [m] = await tx.select({ n: sql<number>`coalesce(max(${isoRecords.no}), 0)::int` }).from(isoRecords).where(and(eq(isoRecords.kind, def.k), eq(isoRecords.year, year)));
  const [r] = await tx.insert(isoRecords).values({ ...base, kind: def.k, no: (m?.n ?? 0) + 1, year, createdBy: userId }).returning({ id: isoRecords.id });
  await audit(tx, { userId, action: 'isoNew', entityType: 'iso_record', entityId: r!.id, data: { kind: def.k } });
  return r!.id;
}

export async function setIsoStatus(tx: Tx, id: string, status: IsoStatus, userId: string | null): Promise<void> {
  if (!STATUSES.includes(status)) throw new IsoError('Неважечки статус.');
  await tx.update(isoRecords).set({ status, closedAt: status === 'done' ? new Date() : null }).where(eq(isoRecords.id, id));
  await audit(tx, { userId, action: 'isoStatus', entityType: 'iso_record', entityId: id, data: { status } });
}

export async function deleteIsoRecord(tx: Tx, id: string, userId: string | null): Promise<void> {
  const [r] = await tx.delete(isoRecords).where(eq(isoRecords.id, id)).returning({ kind: isoRecords.kind, title: isoRecords.title });
  if (r) await audit(tx, { userId, action: 'isoDelete', entityType: 'iso_record', entityId: id, data: r });
}

/**
 * „📘 Креирај ги основните документи“ / „🗂 … обработки“ / „🧯 … сценарија“: the starting records of a register not
 * there yet (by title).
 */
export async function addIsoStarters(tx: Tx, kind: IsoKind, office: string, userId: string | null, today: string): Promise<number> {
  const have = new Set((await tx.select({ t: isoRecords.title }).from(isoRecords).where(eq(isoRecords.kind, kind))).map((r) => r.t));
  let n = 0;
  for (const d of isoStarters(kind, office)) {
    if (have.has(d.title)) continue;
    await saveIsoRecord(tx, { kind, title: d.title, status: d.status, data: d.data }, userId, today);
    n++;
  }
  return n;
}
export const addIsoStarterDocs = (tx: Tx, office: string, userId: string | null, today: string) => addIsoStarters(tx, 'policy', office, userId, today);

/**
 * The ЗЗЛП screen's register (`gdpr_records`) in the ISO 27701 part: processing agreements with clients, staff
 * confidentiality statements, processing activities per client, and the requests / breaches recorded there in `year`
 * (open ones past their deadline count as late).
 */
export async function isoGdprLinks(tx: Tx, year: number, today: string) {
  const G = await tx.select({ kind: gdprRecords.kind, firmId: gdprRecords.firmId, date: gdprRecords.date, due: gdprRecords.due, status: gdprRecords.status }).from(gdprRecords);
  const inY = (d: string | null) => !!d && d.startsWith(String(year));
  const of = (k: string) => G.filter((g) => g.kind === k);
  const ev = (k: string) => { const L = of(k).filter((g) => inY(g.date)); return { n: L.length, open: L.filter((g) => g.status === 'open').length, late: of(k).filter((g) => g.status === 'open' && g.due && g.due < today).length }; };
  return {
    dpa: new Set(of('dpa').map((g) => g.firmId).filter(Boolean)).size,
    statements: of('izjava').length,
    activities: of('activity').length, activityFirms: new Set(of('activity').map((g) => g.firmId).filter(Boolean)).size,
    requests: ev('request'), breaches: ev('breach'),
  };
}

/** Evidence from the system (ISO 27001 A.5.15–5.18 access, A.8.15 logging, A.8.13 backup; 9001 §7.5 records). */
export async function isoEvidence(tx: Tx, since: Date) {
  const [U, A, top, logins, E] = await Promise.all([
    tx.select({ name: users.name, username: users.username, role: users.role, active: users.active }).from(users).orderBy(users.name),
    tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(gte(auditLog.at, since)),
    tx.select({ a: auditLog.action, n: sql<number>`count(*)::int` }).from(auditLog).where(gte(auditLog.at, since)).groupBy(auditLog.action).orderBy(desc(sql`count(*)`)).limit(8),
    tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(gte(auditLog.at, since), eq(auditLog.action, 'login'))),
    tx.select({ open: sql<number>`count(*) filter (where not ${appErrors.fixed})::int`, fixed: sql<number>`count(*) filter (where ${appErrors.fixed})::int` }).from(appErrors).where(gte(appErrors.lastAt, since)),
  ]);
  return { users: U, changes: A[0]?.n ?? 0, topActions: top, logins: logins[0]?.n ?? 0, errors: E[0] ?? { open: 0, fixed: 0 } };
}
