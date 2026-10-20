/**
 * ISO квалитет of the office (`iso_records`): save / status / delete with the audit, the starting documents, and the
 * evidence the system already holds (users and roles, the change log, system errors) for ISO 27001 / 9001, and the
 * personal-data records of the ЗЗЛП screen (`gdpr_records`) the ISO 27701 part links to.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { isoAutoDue, isoCloseCheck, isoKind, isoStarters, type IsoKind, type IsoRev, type IsoStatus } from '@wise/core/office/iso';
import { ISO_ANNEX_A, type SoaEntry } from '@wise/core/office/iso-soa';
import { audit, type Tx } from './audit';
import { appErrors, auditLog, firms, gdprRecords, isoRecords, serviceContracts, users } from './schema/index';

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
  const data: Record<string, unknown> = Object.fromEntries(def.fields.map((f) => [f.k, a.data[f.k]]).filter(([, v]) => v != null && v !== ''));
  if (status === 'done') { const m = isoCloseCheck(def.k, data); if (m) throw new IsoError(m); }
  const base = { title, status, due: a.due || isoAutoDue(def.k, data, today), firmId: a.firmId || null, ownerId: a.ownerId || null, data, closedAt: status === 'done' ? new Date() : null };
  /** A document's change history: every new version with the date, the user and the description of the change. */
  const rev = (prev: IsoRev[]): IsoRev[] => (def.k === 'policy' && data.version && prev.at(-1)?.v !== String(data.version) ? [...prev, { v: String(data.version), on: today, by: userId ?? '', ...(data.changeNote ? { note: String(data.changeNote) } : {}) }] : prev);
  if (a.id) {
    const [old] = await tx.select().from(isoRecords).where(eq(isoRecords.id, a.id)).limit(1);
    if (!old) throw new IsoError('Записот не постои.');
    const od = old.data ?? {}, own = (d: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')).sort()));
    // the sign-off stays only while the content it confirmed is unchanged
    if (od._sign && own(od) === own(data) && old.title === title) data._sign = od._sign;
    const r = rev(Array.isArray(od._rev) ? (od._rev as IsoRev[]) : []);
    if (r.length) data._rev = r;
    await tx.update(isoRecords).set({ ...base, data, closedAt: status === 'done' ? old.closedAt ?? new Date() : null }).where(eq(isoRecords.id, a.id));
    await audit(tx, { userId, action: 'isoSave', entityType: 'iso_record', entityId: a.id, data: { kind: old.kind, status } });
    return a.id;
  }
  const r0 = rev([]);
  if (r0.length) data._rev = r0;
  const year = Number(today.slice(0, 4));
  const [m] = await tx.select({ n: sql<number>`coalesce(max(${isoRecords.no}), 0)::int` }).from(isoRecords).where(and(eq(isoRecords.kind, def.k), eq(isoRecords.year, year)));
  const [r] = await tx.insert(isoRecords).values({ ...base, kind: def.k, no: (m?.n ?? 0) + 1, year, createdBy: userId }).returning({ id: isoRecords.id });
  await audit(tx, { userId, action: 'isoNew', entityType: 'iso_record', entityId: r!.id, data: { kind: def.k } });
  return r!.id;
}

export async function setIsoStatus(tx: Tx, id: string, status: IsoStatus, userId: string | null): Promise<void> {
  if (!STATUSES.includes(status)) throw new IsoError('Неважечки статус.');
  if (status === 'done') {
    const [r] = await tx.select({ kind: isoRecords.kind, data: isoRecords.data }).from(isoRecords).where(eq(isoRecords.id, id)).limit(1);
    if (!r) throw new IsoError('Записот не постои.');
    const m = isoCloseCheck(r.kind as IsoKind, r.data ?? {});
    if (m) throw new IsoError(m);
  }
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

/**
 * „✍ Потврди“: the responsible person (the record's owner, or the manager) signs the record off – who and when; a
 * later change of the content drops the sign-off (saveIsoRecord).
 */
export async function signIsoRecord(tx: Tx, id: string, user: { id: string; name: string; admin: boolean }): Promise<void> {
  const [r] = await tx.select({ ownerId: isoRecords.ownerId, data: isoRecords.data }).from(isoRecords).where(eq(isoRecords.id, id)).limit(1);
  if (!r) throw new IsoError('Записот не постои.');
  if (r.ownerId && r.ownerId !== user.id && !user.admin) throw new IsoError('Потврдува одговорното лице на записот или управителот.');
  await tx.update(isoRecords).set({ data: { ...(r.data ?? {}), _sign: { by: user.id, name: user.name, at: new Date().toISOString() } } }).where(eq(isoRecords.id, id));
  await audit(tx, { userId: user.id, action: 'isoSign', entityType: 'iso_record', entityId: id });
}

/* ---------------- Statement of Applicability (ISO 27001 §6.1.3 d) ---------------- */

/** The confirmed controls: control id → entry (kind `soa`, title = the control id). */
export async function loadSoa(tx: Tx): Promise<Map<string, Partial<SoaEntry>>> {
  const L = await tx.select({ title: isoRecords.title, data: isoRecords.data }).from(isoRecords).where(eq(isoRecords.kind, 'soa'));
  return new Map(L.map((r) => [r.title, r.data as Partial<SoaEntry>]));
}

/** Confirm / change one control. */
export async function saveSoa(tx: Tx, id: string, e: SoaEntry, userId: string | null, today: string): Promise<void> {
  const c = ISO_ANNEX_A.find((x) => x.id === id);
  if (!c) throw new IsoError('Непозната контрола.');
  if (!e.justification.trim()) throw new IsoError('Внесете оправдување (зошто се применува или зошто е исклучена).');
  const data = { applicable: e.applicable, justification: e.justification.trim(), status: e.applicable ? e.status : 'не се применува', evidence: e.evidence.trim() };
  const [old] = await tx.select({ id: isoRecords.id }).from(isoRecords).where(and(eq(isoRecords.kind, 'soa'), eq(isoRecords.title, id))).limit(1);
  if (old) await tx.update(isoRecords).set({ data, status: 'done' }).where(eq(isoRecords.id, old.id));
  else {
    const year = Number(today.slice(0, 4));
    const [m] = await tx.select({ n: sql<number>`coalesce(max(${isoRecords.no}), 0)::int` }).from(isoRecords).where(and(eq(isoRecords.kind, 'soa'), eq(isoRecords.year, year)));
    await tx.insert(isoRecords).values({ kind: 'soa', no: (m?.n ?? 0) + 1, year, title: id, status: 'done', data, createdBy: userId });
  }
  await audit(tx, { userId, action: 'isoSoa', entityType: 'iso_soa', entityId: id, data: { applicable: data.applicable, status: data.status } });
}

/** „✓ Прифати го предлогот“ for every control not confirmed yet; the count. */
export async function confirmSoaAll(tx: Tx, userId: string | null, today: string): Promise<number> {
  const have = await loadSoa(tx);
  let n = 0;
  for (const c of ISO_ANNEX_A) {
    if (have.has(c.id)) continue;
    await saveSoa(tx, c.id, { applicable: c.applicable, justification: c.justification, status: c.status, evidence: c.evidence }, userId, today);
    n++;
  }
  return n;
}

/* ---------------- Staff (ISO 27001 A.6) ---------------- */

/** The staff row of an employee (kind `staff`, `data.employeeId`), merged with `patch`; its id. */
export async function saveIsoStaff(tx: Tx, emp: { id: string; name: string }, patch: Record<string, unknown>, userId: string | null, today: string): Promise<string> {
  const [old] = await tx.select().from(isoRecords).where(and(eq(isoRecords.kind, 'staff'), sql`${isoRecords.data}->>'employeeId' = ${emp.id}`)).limit(1);
  const data = { ...(old?.data ?? {}), ...patch, employeeId: emp.id };
  return saveIsoRecord(tx, { id: old?.id ?? null, kind: 'staff', title: emp.name, status: old?.status ?? 'progress', ownerId: old?.ownerId ?? null, data }, userId, today);
}

/** Active clients (without the office's own firm) and those with a signed service contract (ISO 9001 §8.2.3). */
export async function isoClientCounts(tx: Tx): Promise<{ clients: number; withContract: number }> {
  const F = await tx.select({ id: firms.id, settings: firms.settings }).from(firms).where(eq(firms.active, true));
  const C = F.filter((f) => !(f.settings as { officeFirm?: boolean } | null)?.officeFirm);
  const S = await tx.select({ firmId: serviceContracts.firmId, status: serviceContracts.status }).from(serviceContracts);
  const ids = new Set(C.map((f) => f.id));
  return { clients: C.length, withContract: new Set(S.filter((s) => s.status !== 'ended' && ids.has(s.firmId)).map((s) => s.firmId)).size };
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
