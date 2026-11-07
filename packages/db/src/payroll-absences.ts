/**
 * „🗓 Отсуства“ — the register of dated absences (`pay_absences`) and how the payroll uses it: a new month's draft
 * (and „⟳ Примени отсуства и задршки“ on a draft) gets one line per absence part in the month (`absenceLines`; the
 * employer's sick leave becomes ФЗО from the 31st day), the regular hours are reduced (`fixRegular`). Lines made by
 * hand are never touched; the register lines carry the mark „·евид.“ and are replaced on every apply.
 */
import { and, asc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import {
  absenceLines, absencesOverlap, fixRegular, isAbsenceLine, monthEnd, psifCodes, type PayAbsence, type PayEmp, type PayParams,
} from '@wise/core';
import { audit, type Tx } from './audit';
import { codes, employees, fileLinks, payAbsences } from './schema/index';
import { loadRun, saveRun } from './payroll';
import { applyLoanInstalments } from './payroll-loans';

export const ABSENCE_FILE_ENTITY = 'pay_absence';

export class AbsenceError extends Error { override name = 'AbsenceError'; }

const iso = /^\d{4}-\d{2}-\d{2}$/;

/** The firm's line-code table (the base codes + its own `paysif` rows). */
export async function firmPsif(tx: Pick<Tx, 'select'>, firmId: string) {
  const cb = await tx.select().from(codes).where(and(eq(codes.cb, 'paysif'), or(isNull(codes.firmId), eq(codes.firmId, firmId))));
  return psifCodes(cb.map((c) => ({ code: c.code ?? '', name: c.name, ...(c.data as Record<string, string>) })));
}

/** Absences overlapping [from, to] (all employees of the firm, or one). */
export async function listAbsences(tx: Pick<Tx, 'select'>, firmId: string, o: { from?: string; to?: string; employeeId?: string } = {}) {
  return tx.select().from(payAbsences).where(and(
    eq(payAbsences.firmId, firmId),
    ...(o.to ? [lte(payAbsences.from, o.to)] : []), ...(o.from ? [gte(payAbsences.to, o.from)] : []),
    ...(o.employeeId ? [eq(payAbsences.employeeId, o.employeeId)] : []),
  )).orderBy(asc(payAbsences.from));
}

export interface AbsenceInput { id?: string | null; employeeId: string; code: string; from: string; to: string; docNo?: string | null; note?: string | null; fileIds?: string[] }

/** Save one absence (checks: dates, the employee of the firm, no overlap with another absence of the employee). */
export async function saveAbsence(tx: Tx, firmId: string, a: AbsenceInput, userId: string | null): Promise<string> {
  if (!iso.test(a.from) || !iso.test(a.to)) throw new AbsenceError('Внесете датуми од – до.');
  if (a.to < a.from) throw new AbsenceError('Датумот „до“ е пред „од“.');
  if (!/^\d{3}$/.test(a.code)) throw new AbsenceError('Изберете вид на отсуство.');
  const [e] = await tx.select({ id: employees.id, name: employees.name }).from(employees).where(and(eq(employees.id, a.employeeId), eq(employees.firmId, firmId))).limit(1);
  if (!e) throw new AbsenceError('Изберете вработен.');
  const others = await tx.select().from(payAbsences).where(and(eq(payAbsences.employeeId, a.employeeId), lte(payAbsences.from, a.to), gte(payAbsences.to, a.from), ...(a.id ? [ne(payAbsences.id, a.id)] : [])));
  const clash = others.find((o) => absencesOverlap(o, a));
  if (clash) throw new AbsenceError(`${e.name} веќе има отсуство ${clash.from.split('-').reverse().join('.')} – ${clash.to.split('-').reverse().join('.')} во тој период.`);
  const v = { firmId, employeeId: a.employeeId, code: a.code, from: a.from, to: a.to, docNo: a.docNo?.trim() || null, note: a.note?.trim() || null };
  let id = a.id ?? null;
  if (id) await tx.update(payAbsences).set(v).where(and(eq(payAbsences.id, id), eq(payAbsences.firmId, firmId)));
  else id = (await tx.insert(payAbsences).values({ ...v, createdBy: userId }).returning({ id: payAbsences.id }))[0]!.id;
  for (const f of a.fileIds ?? []) await tx.insert(fileLinks).values({ fileId: f, entityType: ABSENCE_FILE_ENTITY, entityId: id, role: 'attachment' }).onConflictDoNothing();
  await audit(tx, { userId, firmId, action: 'payAbsence', entityType: 'pay_absence', entityId: id, data: { emp: e.name, code: a.code, from: a.from, to: a.to } });
  return id;
}

export async function deleteAbsence(tx: Tx, firmId: string, id: string, userId: string | null): Promise<void> {
  await tx.delete(payAbsences).where(and(eq(payAbsences.id, id), eq(payAbsences.firmId, firmId)));
  await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, ABSENCE_FILE_ENTITY), eq(fileLinks.entityId, id)));
  await audit(tx, { userId, firmId, action: 'payAbsenceDel', entityType: 'pay_absence', entityId: id, data: {} });
}

/**
 * The absence lines of `month` into the draft `emps` (register lines replaced, regular hours reduced). `P` = the
 * month's parameters (the full hour fund, for part-time employees the share).
 */
export async function applyAbsences(tx: Tx, firmId: string, month: string, emps: PayEmp[], P: PayParams): Promise<PayEmp[]> {
  const m0 = month + '-01', m1 = monthEnd(month);
  const A = await listAbsences(tx, firmId, { from: m0, to: m1 });
  const touched = new Set(A.map((a) => a.employeeId));
  if (!touched.size && !emps.some((e) => (e.lines ?? []).some((l) => isAbsenceLine(l.type)))) return emps;
  const psif = await firmPsif(tx, firmId);
  const H = +(P.hours ?? 0) || 176;
  return emps.map((e) => {
    const had = (e.lines ?? []).some((l) => isAbsenceLine(l.type));
    if (!touched.has(e.empId) && !had) return e;
    const mine: PayAbsence[] = A.filter((a) => a.employeeId === e.empId);
    const scale = +(e.hNorm ?? 0) > 0 ? +e.hNorm! / H : 1;
    const lines = [...(e.lines ?? []).filter((l) => !isAbsenceLine(l.type)), ...absenceLines(month, mine, psif, { scale })];
    const x: PayEmp = { ...e, lines: lines.map((l) => ({ ...l })) };
    fixRegular(x, +(e.hNorm ?? 0) || H);
    return x;
  });
}

/** Files attached to absences (`id` → files). */
export async function absenceFiles(tx: Pick<Tx, 'select'>, ids: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!ids.length) return m;
  const R = await tx.select({ fileId: fileLinks.fileId, id: fileLinks.entityId }).from(fileLinks).where(and(eq(fileLinks.entityType, ABSENCE_FILE_ENTITY), inArray(fileLinks.entityId, ids)));
  for (const r of R) m.set(r.id, [...(m.get(r.id) ?? []), r.fileId]);
  return m;
}

/**
 * „⟳ Примени отсуства и задршки“ on a saved month that is not booked yet: the register lines of the absences and the
 * withholding orders are set again (hand-made lines stay). A booked or locked month is refused.
 */
export async function reapplyToRun(tx: Tx, firmId: string, month: string, userId: string): Promise<{ emps: number }> {
  const run = await loadRun(tx, firmId, { month });
  if (!run) throw new AbsenceError('Платата за месецот сè уште не е направена – новата плата ги зема сама.');
  if (run.status === 'posted' || run.locked) throw new AbsenceError('Платата за месецот е прокнижена / заклучена – откнижете ја прво.');
  let emps = await applyAbsences(tx, firmId, month, run.emps as PayEmp[], run.params);
  emps = await applyLoanInstalments(tx, firmId, month, emps, run.params);
  await saveRun(tx, { firmId, month, params: run.params, emps, userId, runId: run.id });
  await audit(tx, { userId, firmId, action: 'payReapply', entityType: 'payroll_run', entityId: run.id, data: { month } });
  return { emps: emps.length };
}
