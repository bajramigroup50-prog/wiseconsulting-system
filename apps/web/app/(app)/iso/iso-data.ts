/**
 * Data of the ISO screen and its prints: the registers as `IsoRow`s, the office's own employees with their readiness
 * rows (ISO 27001 A.6 – the employees of the office's firm, matched to the program's users by name like
 * /korisnici; the current employment contract; the ЗЗЛП confidentiality statement; attached scans), the Statement of
 * Applicability and the certification readiness.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { type IsoKind, type IsoRow, type IsoStatus } from '@wise/core/office/iso';
import { isoReadiness } from '@wise/core/office/iso-ready';
import { isoRegistry, type RegFacts } from '@wise/core/office/iso-registry';
import { soaMerge } from '@wise/core/office/iso-soa';
import { policiesInForce, staffStatus, type StaffStatus } from '@wise/core/office/iso-staff';
import { amlRecords, auditLog, employees, files, firms, getOfficeProfile, hrContracts, isoClientCounts, isoGdprLinks, isoRecords, loadSoa, OFFICE_FILE_ENTITY, users } from '@wise/db';
import { db } from '@/lib/db';
import { filesOf } from '@/lib/office';

export type IsoRowX = IsoRow & { firmId: string | null; ownerId: string | null; createdBy: string | null };

export async function loadIsoRows(): Promise<IsoRowX[]> {
  const R0 = await db().select().from(isoRecords).orderBy(desc(isoRecords.year), desc(isoRecords.no));
  return R0.filter((r) => r.kind !== 'soa').map((r) => ({
    id: r.id, kind: r.kind as IsoKind, no: r.no, year: r.year, title: r.title, status: r.status as IsoStatus, due: r.due, created: r.createdAt.toISOString(),
    closed: r.closedAt?.toISOString() ?? null, data: r.data ?? {}, firmId: r.firmId, ownerId: r.ownerId, createdBy: r.createdBy,
  }));
}

export interface StaffLine {
  emp: { id: string; name: string; embg: string | null; position: string | null; active: boolean; start: string | null; end: string | null };
  user: { id: string; name: string; active: boolean; role: string } | null;
  row: IsoRowX | null;
  contract: { id: string; no: string; signDate: string | null; iso: boolean } | null;
  files: { id: string; name: string }[];
  s: StaffStatus;
}

/** The office's own firm (Фирми → „фирма на канцеларијата“). */
export async function officeFirm() {
  const F = await db().select().from(firms);
  return F.find((f) => (f.settings as { officeFirm?: boolean } | null)?.officeFirm) ?? null;
}

export async function loadStaff(R: readonly IsoRowX[], today: string): Promise<{ office: Awaited<ReturnType<typeof officeFirm>>; lines: StaffLine[] }> {
  const office = await officeFirm();
  if (!office) return { office, lines: [] };
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 10)}`;
  const [E, U, O] = await Promise.all([
    db().select().from(employees).where(eq(employees.firmId, office.id)).orderBy(employees.name),
    db().select({ id: users.id, name: users.name, active: users.active, role: users.role, demo: users.demo }).from(users),
    getOfficeProfile(db()),
  ]);
  // the colleagues working now, and those who left in the last year (their leaving is still checked)
  const emps = E.filter((e) => e.active || (e.end && e.end >= yearAgo));
  const C = emps.length ? await db().select().from(hrContracts).where(and(inArray(hrContracts.employeeId, emps.map((e) => e.id)), eq(hrContracts.current, true))) : [];
  const rows = R.filter((r) => r.kind === 'staff');
  const FL = await filesOf(OFFICE_FILE_ENTITY.iso, rows.map((r) => r.id));
  const izj = (O.zzlp?.izj ?? {}) as Record<string, { signed?: boolean; at?: string }>;
  const policies = policiesInForce(R), trainings = R.filter((r) => r.kind === 'training');
  const lines = emps.map((e): StaffLine => {
    const user = U.find((x) => !x.demo && x.name.trim().toLowerCase() === e.name.trim().toLowerCase()) ?? null;
    const row = rows.find((r) => r.data.employeeId === e.id) ?? null;
    const ct = C.find((c) => c.employeeId === e.id);
    const contract = ct ? { id: ct.id, no: ct.no, signDate: ct.signDate, iso: !!(ct.data as { iso?: boolean } | null)?.iso } : null;
    const files = (row && FL.get(row.id)) ?? [];
    const emp = { id: e.id, name: e.name, embg: e.embg, position: e.position, active: e.active, start: e.start, end: e.end };
    const s = staffStatus({ emp, user, row, contract, files: files.length, izj: user ? izj[user.id] ?? null : null, policies, trainings, today });
    return { emp, user: user ? { id: user.id, name: user.name, active: user.active, role: user.role } : null, row, contract, files, s };
  });
  return { office, lines };
}

/** The statement (93 controls, confirmed over the proposal). */
export const loadSoaMerged = async () => soaMerge(await db().transaction((tx) => loadSoa(tx)));

/** What the master register computes from the program besides the ISO registers. */
export async function loadRegFacts(year: number, today: string): Promise<RegFacts> {
  const office = await officeFirm();
  const [U, E, F, A, FL, AL, G, CC] = await Promise.all([
    db().select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.active, true), eq(users.demo, false))),
    office ? db().select({ name: employees.name, lek: employees.lekDate, bzr: employees.bzrDate }).from(employees).where(and(eq(employees.firmId, office.id), eq(employees.active, true))) : Promise.resolve([]),
    db().select({ id: firms.id, settings: firms.settings }).from(firms).where(eq(firms.active, true)),
    db().select({ firmId: amlRecords.firmId, next: amlRecords.nextReview }).from(amlRecords),
    db().select({ total: sql<number>`count(*)::int`, hashed: sql<number>`count(*) filter (where length(${files.sha256}) = 64)::int` }).from(files),
    db().select({ at: sql<string | null>`max(${auditLog.at})` }).from(auditLog),
    db().transaction((tx) => isoGdprLinks(tx, year, today)),
    db().transaction((tx) => isoClientCounts(tx)),
  ]);
  const clients = new Set(F.filter((f) => !(f.settings as { officeFirm?: boolean; demo?: boolean } | null)?.officeFirm).map((f) => f.id));
  const am = A.filter((a) => clients.has(a.firmId));
  return {
    users: { active: U[0]?.n ?? 0 }, employees: E,
    aml: { clients: clients.size, withFile: am.length, overdue: am.filter((a) => a.next && a.next < today).length },
    clients: CC.clients, clientContracts: CC.withContract, gdpr: G,
    files: { total: FL[0]?.total ?? 0, hashed: FL[0]?.hashed ?? 0 }, auditLast: AL[0]?.at ? String(AL[0].at).slice(0, 10) : null,
  };
}

/** The master register of mandatory records. */
export async function loadRegistry(R: readonly IsoRowX[], staff: readonly StaffLine[], year: number, today: string) {
  const [soa, facts] = await Promise.all([loadSoaMerged(), loadRegFacts(year, today)]);
  return isoRegistry({ R, soa, staff: staff.map((l) => ({ name: l.emp.name, s: l.s })), facts, year, today });
}

/** The certification readiness per standard (with the legal and archive rows of the master register). */
export async function loadReadiness(R: readonly IsoRowX[], staff: readonly StaffLine[], year: number, today: string) {
  const [soa, G, CC, registry] = await Promise.all([loadSoaMerged(), db().transaction((tx) => isoGdprLinks(tx, year, today)), db().transaction((tx) => isoClientCounts(tx)), loadRegistry(R, staff, year, today)]);
  return isoReadiness({ R, soa, staff: staff.map((l) => ({ name: l.emp.name, s: l.s })), gdpr: G, clients: CC.clients, clientContracts: CC.withContract, year, today, registry });
}
