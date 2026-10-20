/**
 * IFAC standards per client firm (`ifac_records`, `@wise/core/office/ifac`): the ISRS 4410 engagement letter (numbered
 * per year, its copy in the dossier with the year's validity and a renewal deadline), the ISQM 1 checklist and the
 * IESBA declarations of the employees (synced into the ISO „Обуки“ register). Every change audited.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  cpdHours, IFAC_FILE_ENTITY, ifacReadiness, OFFICE_SUBJECT, SQM_COMPONENTS, sqmComp, sqmKind, sqmNormalize, sqmStarter, staffNormalize, type SqmData, type StaffData,
} from '@wise/core/office/ifac-sqm';
import {
  EL_DOS_CAT, EL_RENEW_DAYS, elNormalize, elNumber, elRenewTitle, elValidTo, ETHICS_VERSION, ethicsTraining, ethicsTrainingTitle, qcNormalize, qcReviewed, qcValidate,
  type ElLetter, type ElSig, type IfacKind, type QcAuto, type QcData,
} from '@wise/core/office/ifac';
import { audit, type Tx } from './audit';
import { saveIsoRecord } from './iso';
import { nextOfficeNumber } from './office';
import { amlRecords, dossierDocs, fileLinks, files, firmDeadlines, ifacRecords, isoRecords, OFFICE_FILE_ENTITY, serviceContracts, users } from './schema/index';

export class IfacError extends Error { constructor(m: string) { super(m); this.name = 'IfacError'; } }

/** Letter-number counter (`office_counters.key`); the 🎭 demo office has its own. */
export const elCounterKey = (demo: boolean) => (demo ? 'demo:ifacEl' : 'ifacEl');

export async function ifacGet(tx: Tx, kind: IfacKind, year: number, subject: string) {
  const [r] = await tx.select().from(ifacRecords).where(and(eq(ifacRecords.kind, kind), eq(ifacRecords.year, year), eq(ifacRecords.subject, subject))).limit(1);
  return r ?? null;
}

/** Every save keeps who, when and the version of the form (`_by`, `_at`, `_v`). */
async function upsert(tx: Tx, kind: IfacKind, year: number, subject: string, v: { firmId?: string | null; userId?: string | null; no?: number | null; status: string; data: Record<string, unknown> }, by: string | null) {
  const cur = await ifacGet(tx, kind, year, subject);
  const data = { ...v.data, _v: (Number(cur?.data._v) || 0) + 1, _by: by, _at: new Date().toISOString() };
  if (cur) { await tx.update(ifacRecords).set({ status: v.status, data, ...(v.no != null ? { no: v.no } : {}) }).where(eq(ifacRecords.id, cur.id)); return cur.id; }
  const [r] = await tx.insert(ifacRecords).values({ kind, year, subject, firmId: v.firmId ?? null, userId: v.userId ?? null, no: v.no ?? null, status: v.status, data, createdBy: by }).returning({ id: ifacRecords.id });
  return r!.id;
}

/** The stored letter of a firm and year. */
export async function letterOf(tx: Tx, firmId: string, year: number): Promise<{ id: string; letter: ElLetter } | null> {
  const r = await ifacGet(tx, 'letter', year, firmId);
  return r ? { id: r.id, letter: elNormalize({ ...r.data, year: r.year } as never, String(r.createdAt.toISOString()).slice(0, 10)) } : null;
}

async function removeDossierCopy(tx: Tx, firmId: string, id: string | null | undefined) {
  if (!id) return;
  await tx.delete(dossierDocs).where(and(eq(dossierDocs.id, id), eq(dossierDocs.firmId, firmId)));
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), eq(fileLinks.entityId, id)));
}

async function dossierCopy(tx: Tx, firmId: string, l: ElLetter, office: string, userId: string | null): Promise<string> {
  const [d] = await tx.insert(dossierDocs).values({
    firmId, category: EL_DOS_CAT, title: `Писмо за ангажман ${l.number} за ${l.year}${l.signed ? '' : ' (чека потпис)'}`, number: l.number, date: l.date,
    validTo: elValidTo(l), partnerName: office || null, createdBy: userId,
    note: l.signed ? `Потпишано од клиентот на ${l.signed.at.slice(0, 10)}${l.signed.name ? ` (${l.signed.name})` : ''}.` : 'Примерок пред потпишување – по потпишувањето се заменува со потпишаниот.',
  }).returning({ id: dossierDocs.id });
  return d!.id;
}

/** The renewal reminder of the year's letter (a firm deadline on 31.12, raised 30 days before); the previous year's is done. */
async function renewalDeadline(tx: Tx, firmId: string, year: number, userId: string | null) {
  await tx.update(firmDeadlines).set({ done: true }).where(and(eq(firmDeadlines.firmId, firmId), eq(firmDeadlines.title, elRenewTitle(year - 1)), eq(firmDeadlines.done, false)));
  const [has] = await tx.select({ id: firmDeadlines.id }).from(firmDeadlines).where(and(eq(firmDeadlines.firmId, firmId), eq(firmDeadlines.title, elRenewTitle(year)))).limit(1);
  if (!has) await tx.insert(firmDeadlines).values({ firmId, title: elRenewTitle(year), due: elValidTo({ year }), remindDays: EL_RENEW_DAYS, note: 'ISRS 4410 – ново писмо за ангажман за следната година (🤝 IFAC).', createdBy: userId });
}

/**
 * Save the year's letter (new or the unsigned one): number from the per-year counter, the copy in the dossier replaced,
 * the renewal reminder. Returns the dossier document the PDF goes to.
 */
export async function saveLetter(tx: Tx, firmId: string, input: Partial<ElLetter> & Record<string, unknown>, a: { userId: string | null; today: string; office: string; demo?: boolean }): Promise<{ id: string; letter: ElLetter; dossierId: string }> {
  const l0 = elNormalize(input, a.today);
  const cur = await letterOf(tx, firmId, l0.year);
  if (cur?.letter.signed) throw new IfacError('Потпишаното писмо не може да се менува.');
  let no: number | null = null, number = cur?.letter.number ?? '';
  if (!number) { no = await nextOfficeNumber(tx, elCounterKey(!!a.demo), l0.year); number = (a.demo ? 'ДЕМО-' : '') + elNumber(no, l0.year); }
  await removeDossierCopy(tx, firmId, cur?.letter.dossierId);
  const l: ElLetter = { ...l0, number, signed: null, dossierId: null };
  l.dossierId = await dossierCopy(tx, firmId, l, a.office, a.userId);
  const id = await upsert(tx, 'letter', l.year, firmId, { firmId, no, status: 'draft', data: { ...l } }, a.userId);
  await renewalDeadline(tx, firmId, l.year, a.userId);
  await audit(tx, { userId: a.userId, firmId, action: 'elSave', entityType: 'ifac_record', entityId: id, data: { number, year: l.year, svc: l.svc } });
  return { id, letter: l, dossierId: l.dossierId };
}

/** The client signed (paper copy with an optional scan, or on the screen): the signed copy replaces the draft in the dossier. */
export async function signLetter(tx: Tx, firmId: string, year: number, sig: ElSig, a: { userId: string | null; office: string }): Promise<{ letter: ElLetter; dossierId: string }> {
  const cur = await letterOf(tx, firmId, year);
  if (!cur) throw new IfacError('Прво изгответе го писмото за ангажман.');
  if (cur.letter.signed) throw new IfacError('Писмото е веќе потпишано.');
  if (!/^\d{4}-\d{2}-\d{2}/.test(sig.at)) throw new IfacError('Внесете го датумот на потпишување.');
  if (sig.scan) {
    const [fl] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, sig.scan), eq(files.firmId, firmId), eq(files.status, 'ready'))).limit(1);
    if (!fl) throw new IfacError('Датотеката не е пронајдена.');
  }
  await removeDossierCopy(tx, firmId, cur.letter.dossierId);
  const l: ElLetter = { ...cur.letter, signed: { at: sig.at.slice(0, 10), name: sig.name || cur.letter.rep, by: sig.by, scan: sig.scan ?? null } };
  l.dossierId = await dossierCopy(tx, firmId, l, a.office, a.userId);
  if (sig.scan) await tx.insert(fileLinks).values({ fileId: sig.scan, entityType: OFFICE_FILE_ENTITY.dossier, entityId: l.dossierId, role: 'attachment' }).onConflictDoNothing();
  await upsert(tx, 'letter', year, firmId, { firmId, status: 'signed', data: { ...l } }, a.userId);
  await audit(tx, { userId: a.userId, firmId, action: 'elSign', entityType: 'ifac_record', entityId: cur.id, data: { number: l.number, at: l.signed!.at, scan: !!sig.scan } });
  return { letter: l, dossierId: l.dossierId };
}

/** Delete an unsigned letter (and its dossier copy). */
export async function deleteLetter(tx: Tx, firmId: string, year: number, userId: string | null): Promise<void> {
  const cur = await letterOf(tx, firmId, year);
  if (!cur) return;
  if (cur.letter.signed) throw new IfacError('Потпишаното писмо не се брише.');
  await removeDossierCopy(tx, firmId, cur.letter.dossierId);
  await tx.delete(ifacRecords).where(eq(ifacRecords.id, cur.id));
  await audit(tx, { userId, firmId, action: 'elDelete', entityType: 'ifac_record', entityId: cur.id, data: { number: cur.letter.number, year } });
}

/** `qc` row status from the manual parts: reviewed (second person done) › accepted › open. */
export function qcRowStatus(q: QcData): string {
  if (qcReviewed(q)) return 'reviewed';
  return (q.decision === 'accept' || q.decision === 'continue') && q.decidedOn ? 'accepted' : 'open';
}

export async function qcOf(tx: Tx, firmId: string, year: number): Promise<QcData | null> {
  const r = await ifacGet(tx, 'qc', year, firmId);
  return r ? qcNormalize(r.data as never) : null;
}

/** Save the ISQM 1 checklist of a firm and year (the reviewer must be a second person). */
export async function saveQc(tx: Tx, firmId: string, year: number, input: Partial<QcData> & Record<string, unknown>, userId: string | null): Promise<QcData & { id: string }> {
  const q = qcNormalize(input);
  const e = qcValidate(q);
  if (e) throw new IfacError(e);
  const id = await upsert(tx, 'qc', year, firmId, { firmId, status: qcRowStatus(q), data: { ...q } }, userId);
  await audit(tx, { userId, firmId, action: 'qcSave', entityType: 'ifac_record', entityId: id, data: { year, status: qcRowStatus(q), decision: q.decision, reviewedBy: q.reviewedBy } });
  return { ...q, id };
}

/** The employees who sign the declaration: active office users (not the client portal; 🎭 the demo side apart). */
export async function ethicsStaff(tx: Tx, demo = false) {
  return (await tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.active, true), ne(users.role, 'klient'), eq(users.demo, demo))).orderBy(users.name));
}

/** Who signed in a year (userId → date). */
export async function ethicsSigned(tx: Tx, year: number): Promise<Map<string, string>> {
  const R = await tx.select({ s: ifacRecords.subject, d: ifacRecords.data }).from(ifacRecords).where(and(eq(ifacRecords.kind, 'ethics'), eq(ifacRecords.year, year)));
  return new Map(R.map((r) => [r.s, String(r.d.at ?? '')]));
}

/** The year's declarations as the ISO „Обуки“ record (created once per year, then updated). */
export async function syncEthicsTraining(tx: Tx, year: number, office: string, userId: string | null, today: string, demo = false): Promise<string> {
  const [S, M] = await Promise.all([ethicsStaff(tx, demo), ethicsSigned(tx, year)]);
  const t = ethicsTraining(S.map((u) => ({ userId: u.id, name: u.name, at: M.get(u.id) ?? null })), office, year);
  const [cur] = await tx.select({ id: isoRecords.id }).from(isoRecords).where(and(eq(isoRecords.kind, 'training'), eq(isoRecords.title, ethicsTrainingTitle(year)))).limit(1);
  return saveIsoRecord(tx, { id: cur?.id ?? null, kind: 'training', title: t.title, status: t.status, data: t.data }, userId, today.startsWith(String(year)) ? today : `${year}-12-31`);
}

/** An employee signs the year's IESBA declaration (once a year); the ISO training record follows. */
export async function signEthics(tx: Tx, userId: string, year: number, a: { office: string; today: string; demo?: boolean; clients?: string[]; conflicts?: string }): Promise<string> {
  const [u] = await tx.select({ name: users.name, role: users.role, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active || u.role === 'klient') throw new IfacError('Изјавата ја потпишуваат вработените во канцеларијата.');
  if (await ifacGet(tx, 'ethics', year, userId)) throw new IfacError(`Изјавата за ${year} е веќе потпишана.`);
  const id = await upsert(tx, 'ethics', year, userId, { userId, status: 'signed', data: { name: u.name, at: a.today, version: ETHICS_VERSION, clients: (a.clients ?? []).slice(0, 300), conflicts: String(a.conflicts ?? '').slice(0, 2000) } }, userId);
  await audit(tx, { userId, action: 'ethicsSign', entityType: 'ifac_record', entityId: id, data: { year, version: ETHICS_VERSION, clients: a.clients?.length ?? 0, conflicts: !!a.conflicts } });
  await syncEthicsTraining(tx, year, a.office, userId, a.today, a.demo);
  return id;
}

/** What the system knows about the engagement (УФР file, declarations, signed contract, the letter). */
export async function qcAuto(tx: Tx, firmId: string, year: number, demo = false): Promise<QcAuto> {
  const [A, S, M, K, L] = await Promise.all([
    tx.select({ level: amlRecords.level, last: amlRecords.lastReview, next: amlRecords.nextReview }).from(amlRecords).where(eq(amlRecords.firmId, firmId)).limit(1),
    ethicsStaff(tx, demo), ethicsSigned(tx, year),
    tx.select({ id: serviceContracts.id }).from(serviceContracts).where(and(eq(serviceContracts.firmId, firmId), eq(serviceContracts.status, 'signed'))).limit(1),
    ifacGet(tx, 'letter', year, firmId),
  ]);
  return {
    aml: A[0] ? { level: A[0].level, last: A[0].last, next: A[0].next } : null,
    ethics: { signed: S.filter((u) => M.has(u.id)).length, total: S.length },
    contract: K.length > 0,
    letter: L ? (L.status === 'signed' ? 'signed' : 'draft') : null,
  };
}

/** All rows of a year (the office overview and the management review). */
export async function ifacYear(tx: Tx, year: number) {
  return tx.select().from(ifacRecords).where(eq(ifacRecords.year, year));
}

/* ---------------- ISQM 1 components, staff, readiness ---------------- */

/** The ISQM 1 component rows of a year (component key → row). */
export async function sqmYear(tx: Tx, year: number) {
  const R = await tx.select().from(ifacRecords).where(and(eq(ifacRecords.year, year), eq(ifacRecords.subject, OFFICE_SUBJECT)));
  return new Map(R.filter((r) => r.kind.startsWith('sqm_')).map((r) => [r.kind.slice(4), r]));
}

/** Save one ISQM 1 component (documented text, owner, sign-off); returns the row id for the evidence files. */
export async function saveSqm(tx: Tx, comp: string, year: number, input: Record<string, unknown>, userId: string | null): Promise<string> {
  const c = sqmComp(comp);
  if (!c) throw new IfacError('Непозната компонента.');
  const d = sqmNormalize(c, input);
  if (d.signedBy && !d.signedOn) throw new IfacError('Внесете го датумот на потпишување.');
  const id = await upsert(tx, sqmKind(c.k) as IfacKind, year, OFFICE_SUBJECT, { status: d.signedBy && d.signedOn ? 'signed' : 'draft', data: { ...d } }, userId);
  await audit(tx, { userId, action: 'sqmSave', entityType: 'ifac_record', entityId: id, data: { comp: c.k, year, signed: !!d.signedOn } });
  return id;
}

/** The components not documented yet in the year: last year's text carried over, else the starting text (never signed). */
export async function addSqmStarter(tx: Tx, year: number, office: string, userId: string | null): Promise<number> {
  const [cur, prev] = await Promise.all([sqmYear(tx, year), sqmYear(tx, year - 1)]);
  const st = sqmStarter(office);
  let n = 0;
  for (const c of SQM_COMPONENTS) {
    if (cur.has(c.k)) continue;
    const from = (prev.get(c.k)?.data ?? st[c.k]) as Record<string, unknown> | undefined;
    if (!from) continue;
    const keep = Object.fromEntries(c.fields.filter((f) => f.t !== 'date').map((f) => [f.k, from[f.k]]));
    await saveSqm(tx, c.k, year, { ...keep, owner: from.owner }, userId);
    n++;
  }
  return n;
}

export async function staffOf(tx: Tx, userId: string, year: number): Promise<StaffData | null> {
  const r = await ifacGet(tx, 'staff', year, userId);
  return r ? staffNormalize(r.data) : null;
}

/** Save an employee's competence assessment and CPD for the year (the assessor is someone else). */
export async function saveStaff(tx: Tx, subject: string, year: number, input: Record<string, unknown>, by: string | null): Promise<string> {
  const d = staffNormalize(input);
  if (d.assessedBy && d.assessedBy === subject) throw new IfacError('Компетентноста ја проценува друго лице (управител / одговорен), не самиот вработен.');
  if ((d.assessedBy || d.assessedExt) && !d.assessedOn) throw new IfacError('Внесете го датумот на проценката.');
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, subject)).limit(1);
  if (!u) throw new IfacError('Непознат вработен.');
  const id = await upsert(tx, 'staff', year, subject, { userId: subject, status: d.assessedOn ? 'assessed' : 'draft', data: { ...d } }, by);
  await audit(tx, { userId: by, action: 'staffSave', entityType: 'ifac_record', entityId: id, data: { subject, year, hours: cpdHours(d.cpd) } });
  return id;
}

/** Evidence files per IFAC record. */
export async function ifacFilesCount(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const R = await tx.select({ e: fileLinks.entityId, n: sql<number>`count(*)::int` }).from(fileLinks).where(and(eq(fileLinks.entityType, IFAC_FILE_ENTITY), inArray(fileLinks.entityId, ids))).groupBy(fileLinks.entityId);
  return new Map(R.map((r) => [r.e, r.n]));
}

/**
 * Readiness for the ИСОС quality-control review in one call (for /ifac and for linking from other modules, e.g. the
 * ISO certification readiness): the ISQM 1 components, the employees, the client engagements of the given firms.
 */
export async function ifacReadinessFor(tx: Tx, year: number, o: { firms: { id: string; name: string }[]; today: string; demo?: boolean }) {
  const [S, staff, R, Rp] = await Promise.all([sqmYear(tx, year), ethicsStaff(tx, o.demo), ifacYear(tx, year), tx.select().from(ifacRecords).where(inArray(ifacRecords.year, [year - 1, year - 2]))]);
  const F = await ifacFilesCount(tx, [...[...S.values()].map((r) => r.id), ...R.map((r) => r.id), ...Rp.map((r) => r.id)]);
  const of = (L: typeof R, k: string, s: string, y: number) => L.find((r) => r.kind === k && r.subject === s && r.year === y);
  const hoursIn = (y: number, uid: string) => { const r = of(Rp, 'staff', uid, y); return r ? cpdHours(staffNormalize(r.data).cpd) : 0; };
  return ifacReadiness({
    year, today: o.today,
    sqm: Object.fromEntries(SQM_COMPONENTS.map((c) => { const r = S.get(c.k); return [c.k, { d: r ? (r.data as SqmData) : null, files: r ? F.get(r.id) ?? 0 : 0 }]; })),
    staff: staff.map((u) => {
      const st = of(R, 'staff', u.id, year), et = of(R, 'ethics', u.id, year);
      return { id: u.id, name: u.name, role: u.role, d: st ? staffNormalize(st.data) : null, prev: { y1: hoursIn(year - 1, u.id), y2: hoursIn(year - 2, u.id) }, ethicsAt: et ? String(et.data.at ?? '') || null : null, files: st ? F.get(st.id) ?? 0 : 0 };
    }),
    firms: o.firms.map((f) => {
      const l = of(R, 'letter', f.id, year), q = of(R, 'qc', f.id, year), qp = of(Rp, 'qc', f.id, year - 1);
      return { id: f.id, name: f.name, letter: l ? (l.status === 'signed' ? 'signed' : 'draft') : null, qc: q ? qcNormalize(q.data as never) : null, qcPrev: qp ? qcNormalize(qp.data as never) : null, docFiles: qp ? F.get(qp.id) ?? 0 : 0 };
    }),
  });
}
